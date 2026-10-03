//! Link previews: the only network request of Ursa, made here and never from
//! the webview. A URL alone on its line becomes a card (title, description,
//! image, favicon) when the setting is on.
//!
//! Safety rules (nothing on the local network is ever contacted):
//! - http/https only, usual web ports only, a host name with a dot;
//! - never `localhost`, `.local`, `.lan`, `.internal`, `.corp`… nor private,
//!   loopback, link-local or otherwise non-public IP addresses, checked on the
//!   literal host AND on every address the name resolves to; the connection is
//!   then pinned to the checked address (no DNS rebinding);
//! - redirects followed by hand (3 at most), each one checked the same way;
//! - 5 s timeout, limited response sizes, no cookies, no referrer.
//!
//! Results are cached in `.ursa/previews/<key>/` (meta.json, image, favicon)
//! for 30 days; offline, the cached card is used whatever its age.

use std::fs;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::redirect::Policy;
use reqwest::{header, Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::error::{CmdError, CmdResult, ErrorKind};
use crate::vault::{atomic_write, atomic_write_bytes, current_root, VaultState, INTERNAL_DIR};

const TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REDIRECTS: usize = 3;
const MAX_HTML: usize = 1024 * 1024;
const MAX_IMAGE: usize = 3 * 1024 * 1024;
const MAX_ICON: usize = 256 * 1024;
const FRESH_FOR: u64 = 30 * 24 * 3600 * 1000;
/// Cached cards not seen for this long are deleted when a vault opens.
const KEEP_FOR: u64 = 90 * 24 * 3600 * 1000;
const PORTS: [u16; 4] = [80, 443, 8080, 8443];
const BLOCKED_SUFFIXES: [&str; 13] = [
    ".local", ".lan", ".internal", ".corp", ".localhost", ".localdomain", ".home", ".home.arpa", ".intranet", ".private", ".test", ".invalid", ".onion",
];
const USER_AGENT: &str = "Mozilla/5.0 (compatible; UrsaLinkPreview/0.1)";

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Blocked {
    Scheme,
    Port,
    Host,
    Address,
}

/// Public unicast addresses only.
pub(crate) fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => public_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return public_v4(v4);
            }
            let s = v6.segments();
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (s[0] & 0xfe00) == 0xfc00 // unique local fc00::/7
                || (s[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
                || (s[0] & 0xffc0) == 0xfec0 // site-local fec0::/10
                || (s[0] == 0x2001 && s[1] == 0x0db8) // documentation
                || (s[0] == 0x0064 && s[1] == 0xff9b) // NAT64 (could reach IPv4 private ranges)
                || (s[0] == 0x2002)) // 6to4 (embeds an IPv4)
        }
    }
}

fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_unspecified()
        || ip.is_documentation()
        || a == 0
        || (a == 100 && (64..128).contains(&b)) // carrier-grade NAT
        || (a == 192 && b == 0 && c == 0) // IETF protocol assignments
        || (a == 198 && (b == 18 || b == 19)) // benchmarking
        || a >= 240) // reserved
}

/// Checks what can be checked without DNS; returns the host and port to resolve.
pub(crate) fn check_url(url: &Url) -> Result<(String, u16), Blocked> {
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(Blocked::Scheme);
    }
    let port = url.port_or_known_default().ok_or(Blocked::Port)?;
    if !PORTS.contains(&port) {
        return Err(Blocked::Port);
    }
    match url.host() {
        Some(url::Host::Ipv4(ip)) if public_v4(ip) => Ok((ip.to_string(), port)),
        Some(url::Host::Ipv6(ip)) if public_ip(IpAddr::V6(ip)) => Ok((ip.to_string(), port)),
        Some(url::Host::Ipv4(_) | url::Host::Ipv6(_)) => Err(Blocked::Address),
        Some(url::Host::Domain(name)) => {
            let name = name.trim_end_matches('.').to_ascii_lowercase();
            let dotless = !name.contains('.');
            if dotless || name == "localhost" || BLOCKED_SUFFIXES.iter().any(|s| name.ends_with(s)) {
                return Err(Blocked::Host);
            }
            Ok((name, port))
        }
        None => Err(Blocked::Host),
    }
}

/// Every address of the name must be public; the first one is used.
async fn resolve_public(host: &str, port: u16) -> Result<SocketAddr, Blocked> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return if public_ip(ip) { Ok(SocketAddr::new(ip, port)) } else { Err(Blocked::Address) };
    }
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port)).await.map_err(|_| Blocked::Host)?.collect();
    if addrs.is_empty() || addrs.iter().any(|a| !public_ip(a.ip())) {
        return Err(Blocked::Address);
    }
    Ok(addrs[0])
}

/// A proxy would resolve names itself and defeat the address checks: never used,
/// except by the network test of this module (`URSA_TEST_NETWORK=1`).
#[cfg(not(test))]
fn allow_proxy() -> bool {
    false
}
#[cfg(test)]
fn allow_proxy() -> bool {
    std::env::var("URSA_TEST_NETWORK").is_ok()
}

fn err(message: impl std::fmt::Display) -> CmdError {
    CmdError::new(ErrorKind::Other, message.to_string())
}

/// GET with the rules above; returns the final URL, content type and (bounded) body.
async fn fetch(start: Url, max: usize, accept: &str, html: bool) -> CmdResult<(Url, String, Vec<u8>)> {
    let mut url = start;
    for _ in 0..=MAX_REDIRECTS {
        let (host, port) = check_url(&url).map_err(|b| err(format!("blocked: {b:?}")))?;
        let addr = resolve_public(&host, port).await.map_err(|b| err(format!("blocked: {b:?}")))?;
        let mut builder = Client::builder();
        if !allow_proxy() {
            builder = builder.no_proxy();
        }
        #[cfg(test)]
        if let Some(pem) = std::env::var("SSL_CERT_FILE").ok().and_then(|f| fs::read(f).ok()) {
            for cert in reqwest::Certificate::from_pem_bundle(&pem).unwrap_or_default() {
                builder = builder.add_root_certificate(cert);
            }
        }
        let client = builder
            .redirect(Policy::none())
            .timeout(TIMEOUT)
            .connect_timeout(TIMEOUT)
            .user_agent(USER_AGENT)
            .resolve(&host, addr)
            .build()
            .map_err(err)?;
        let mut resp = client.get(url.clone()).header(header::ACCEPT, accept).send().await.map_err(err)?;
        if resp.status().is_redirection() {
            let location = resp.headers().get(header::LOCATION).and_then(|v| v.to_str().ok()).ok_or_else(|| err("redirect without location"))?;
            url = url.join(location).map_err(err)?;
            continue;
        }
        if resp.status() != StatusCode::OK {
            return Err(err(format!("HTTP {}", resp.status())));
        }
        let content_type = resp.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or_default().to_ascii_lowercase();
        if resp.content_length().is_some_and(|n| n as usize > max && !html) {
            return Err(err("too large"));
        }
        let mut body = Vec::new();
        while let Some(chunk) = resp.chunk().await.map_err(err)? {
            body.extend_from_slice(&chunk);
            if body.len() > max {
                if !html {
                    return Err(err("too large"));
                }
                body.truncate(max);
                break;
            }
            // The head is all that is needed.
            if html && body.windows(7).any(|w| w.eq_ignore_ascii_case(b"</head>")) {
                break;
            }
        }
        return Ok((url, content_type, body));
    }
    Err(err("too many redirects"))
}

#[derive(Debug, Default, PartialEq)]
pub(crate) struct Head {
    pub title: Option<String>,
    pub description: Option<String>,
    pub site: Option<String>,
    pub image: Option<String>,
    pub icon: Option<String>,
}

pub(crate) fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let end = rest[..rest.len().min(12)].find(';');
        let decoded = end.and_then(|e| {
            let name = &rest[1..e];
            let c = match name {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some('\u{a0}'),
                _ if name.starts_with("#x") || name.starts_with("#X") => u32::from_str_radix(&name[2..], 16).ok().and_then(char::from_u32),
                _ if name.starts_with('#') => name[1..].parse().ok().and_then(char::from_u32),
                _ => None,
            };
            c.map(|c| (c, e))
        });
        match decoded {
            Some((c, e)) => {
                out.push(c);
                rest = &rest[e + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Attributes of a tag (`<meta property="og:title" content="…">`), keys lowercased.
fn attributes(tag: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let bytes = tag.as_bytes();
    let mut i = tag.find(|c: char| c.is_whitespace()).unwrap_or(tag.len());
    while i < bytes.len() {
        while i < bytes.len() && (bytes[i].is_ascii_whitespace() || bytes[i] == b'/') {
            i += 1;
        }
        let start = i;
        while i < bytes.len() && !bytes[i].is_ascii_whitespace() && bytes[i] != b'=' && bytes[i] != b'>' {
            i += 1;
        }
        let key = tag[start..i].to_ascii_lowercase();
        if key.is_empty() {
            i += 1;
            continue;
        }
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i < bytes.len() && bytes[i] == b'=' {
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            let value = if i < bytes.len() && (bytes[i] == b'"' || bytes[i] == b'\'') {
                let q = bytes[i];
                let from = i + 1;
                let to = tag[from..].find(q as char).map_or(tag.len(), |e| from + e);
                i = to + 1;
                &tag[from..to]
            } else {
                let from = i;
                while i < bytes.len() && !bytes[i].is_ascii_whitespace() && bytes[i] != b'>' {
                    i += 1;
                }
                &tag[from..i]
            };
            out.push((key, decode_entities(value)));
        } else {
            out.push((key, String::new()));
        }
    }
    out
}

fn clean(text: &str, max: usize) -> Option<String> {
    let text: String = decode_entities(text).split_whitespace().collect::<Vec<_>>().join(" ");
    let text: String = text.chars().take(max).collect();
    (!text.is_empty()).then_some(text)
}

/// Title, description, image and icon from the `<head>` (OpenGraph first).
pub(crate) fn parse_head(html: &str, base: &Url) -> Head {
    let lower = html.to_ascii_lowercase();
    let head_end = lower.find("</head>").unwrap_or(lower.len());
    let (html, lower) = (&html[..head_end], &lower[..head_end]);
    let mut head = Head::default();
    let mut title_tag = None;
    let absolute = |href: &str| base.join(href.trim()).ok().filter(|u| u.scheme() == "http" || u.scheme() == "https").map(|u| u.to_string());
    let mut at = 0;
    while let Some(open) = lower[at..].find('<') {
        let start = at + open;
        let Some(close) = lower[start..].find('>') else { break };
        let end = start + close;
        let tag = &html[start + 1..end];
        let name = lower[start + 1..end].split(|c: char| c.is_whitespace() || c == '/').next().unwrap_or_default();
        match name {
            "title" if title_tag.is_none() => {
                if let Some(stop) = lower[end..].find("</title") {
                    title_tag = clean(&html[end + 1..end + stop], 200);
                }
            }
            "meta" => {
                let attrs = attributes(tag);
                let get = |k: &str| attrs.iter().find(|(key, _)| key == k).map(|(_, v)| v.as_str());
                let key = get("property").or_else(|| get("name")).unwrap_or_default().to_ascii_lowercase();
                let content = get("content").unwrap_or_default();
                match key.as_str() {
                    "og:title" | "twitter:title" if head.title.is_none() => head.title = clean(content, 200),
                    "og:description" | "twitter:description" | "description" if head.description.is_none() => head.description = clean(content, 400),
                    "og:site_name" if head.site.is_none() => head.site = clean(content, 100),
                    "og:image" | "og:image:url" | "og:image:secure_url" | "twitter:image" if head.image.is_none() => head.image = absolute(content),
                    _ => {}
                }
            }
            "link" => {
                let attrs = attributes(tag);
                let get = |k: &str| attrs.iter().find(|(key, _)| key == k).map(|(_, v)| v.to_ascii_lowercase());
                let rel = get("rel").unwrap_or_default();
                if head.icon.is_none() && rel.split_whitespace().any(|r| r == "icon") {
                    head.icon = attrs.iter().find(|(k, _)| k == "href").and_then(|(_, v)| absolute(v));
                }
            }
            _ => {}
        }
        at = end + 1;
    }
    if head.title.is_none() {
        head.title = title_tag;
    }
    if head.icon.is_none() {
        head.icon = base.join("/favicon.ico").ok().map(|u| u.to_string());
    }
    head
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub url: String,
    pub domain: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub site: Option<String>,
    /// Vault-relative paths of the cached image and favicon.
    pub image: Option<String>,
    pub icon: Option<String>,
    pub fetched_at: u64,
    /// Older than 30 days and could not be refreshed (offline).
    #[serde(default)]
    pub stale: bool,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

fn cache_key(url: &str) -> String {
    Sha256::digest(url.as_bytes()).iter().take(16).map(|b| format!("{b:02x}")).collect()
}

fn image_ext(content_type: &str) -> Option<&'static str> {
    let mime = content_type.split(';').next().unwrap_or_default().trim();
    Some(match mime {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/x-icon" | "image/vnd.microsoft.icon" => "ico",
        _ => return None,
    })
}

/// Downloads an image into the card's cache folder; its vault-relative path.
async fn cache_image(root: &Path, key: &str, name: &str, url: &str, max: usize) -> Option<String> {
    let url = Url::parse(url).ok()?;
    let (_, content_type, body) = tokio::time::timeout(TIMEOUT, fetch(url, max, "image/*", false)).await.ok()?.ok()?;
    let ext = image_ext(&content_type)?;
    let rel = format!("{INTERNAL_DIR}/previews/{key}/{name}.{ext}");
    atomic_write_bytes(&root.join(&rel), &body).ok()?;
    Some(rel)
}

async fn fetch_preview(root: &Path, url: &Url, key: &str) -> CmdResult<Preview> {
    let (final_url, content_type, body) = tokio::time::timeout(TIMEOUT, fetch(url.clone(), MAX_HTML, "text/html,application/xhtml+xml", true))
        .await
        .map_err(|_| err("timeout"))??;
    if !content_type.starts_with("text/html") && !content_type.starts_with("application/xhtml") {
        return Err(err("not a web page"));
    }
    let head = parse_head(&String::from_utf8_lossy(&body), &final_url);
    fs::create_dir_all(root.join(INTERNAL_DIR).join("previews").join(key))?;
    let image = match &head.image {
        Some(u) => cache_image(root, key, "image", u, MAX_IMAGE).await,
        None => None,
    };
    let icon = match &head.icon {
        Some(u) => cache_image(root, key, "icon", u, MAX_ICON).await,
        None => None,
    };
    Ok(Preview {
        url: url.to_string(),
        domain: url.host_str().unwrap_or_default().trim_start_matches("www.").to_string(),
        title: head.title,
        description: head.description,
        site: head.site,
        image,
        icon,
        fetched_at: now_ms(),
        stale: false,
    })
}

/// The card of `url`: from the cache if fresh (unless `refresh`), else fetched;
/// offline, the cached card whatever its age. Errors (blocked, unreachable, not
/// a page) mean "show a plain link".
#[tauri::command]
pub async fn link_preview(state: State<'_, VaultState>, url: String, refresh: bool) -> CmdResult<Preview> {
    let root = current_root(&state)?;
    let parsed = Url::parse(url.trim()).map_err(err)?;
    check_url(&parsed).map_err(|b| err(format!("blocked: {b:?}")))?;
    let key = cache_key(parsed.as_str());
    let meta = root.join(INTERNAL_DIR).join("previews").join(&key).join("meta.json");
    let cached: Option<Preview> = fs::read_to_string(&meta).ok().and_then(|t| serde_json::from_str(&t).ok());
    if let Some(c) = &cached {
        if !refresh && now_ms().saturating_sub(c.fetched_at) < FRESH_FOR {
            return Ok(c.clone());
        }
    }
    match fetch_preview(&root, &parsed, &key).await {
        Ok(preview) => {
            let _ = atomic_write(&meta, &serde_json::to_string(&preview).map_err(err)?);
            Ok(preview)
        }
        Err(e) => cached.map(|c| Preview { stale: true, ..c }).ok_or(e),
    }
}

/// Removes cached cards fetched more than 90 days ago (at vault opening).
pub(crate) fn purge_previews(root: &Path) {
    let Ok(entries) = fs::read_dir(root.join(INTERNAL_DIR).join("previews")) else { return };
    for entry in entries.flatten() {
        let old = fs::read_to_string(entry.path().join("meta.json"))
            .ok()
            .and_then(|t| serde_json::from_str::<Preview>(&t).ok())
            .map_or(true, |p| now_ms().saturating_sub(p.fetched_at) > KEEP_FOR);
        if old {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn refuses_local_network_and_odd_urls() {
        for blocked in [
            "http://localhost/",
            "http://LOCALHOST./x",
            "http://intranet/",
            "http://nas.local/",
            "http://wiki.lan/",
            "http://jira.corp/",
            "http://app.internal/",
            "http://printer.home.arpa/",
            "http://127.0.0.1/",
            "http://10.1.2.3/",
            "http://172.16.0.1/",
            "http://172.31.255.255/",
            "http://192.168.1.10/",
            "http://169.254.169.254/latest/meta-data",
            "http://100.64.0.1/",
            "http://0.0.0.0/",
            "http://[::1]/",
            "http://[fd00::1]/",
            "http://[fe80::1]/",
            "http://[::ffff:192.168.0.1]/",
            "http://[64:ff9b::a00:1]/",
            "ftp://example.com/",
            "file:///C:/Windows/win.ini",
            "http://example.com:22/",
        ] {
            assert!(check_url(&url(blocked)).is_err(), "{blocked} should be refused");
        }
        for allowed in ["https://example.com/a?b=c", "http://172.32.0.1/", "https://8.8.8.8/", "https://www.rust-lang.org:443/", "http://example.org:8080/"] {
            assert!(check_url(&url(allowed)).is_ok(), "{allowed} should be allowed");
        }
    }

    #[test]
    fn classifies_addresses() {
        assert!(public_ip("93.184.216.34".parse().unwrap()));
        assert!(public_ip("2606:2800:220:1:248:1893:25c8:1946".parse().unwrap()));
        for ip in ["127.0.0.2", "10.0.0.1", "192.168.0.1", "172.20.1.1", "169.254.1.1", "224.0.0.1", "255.255.255.255", "198.18.0.1", "::1", "fc00::1", "fe80::2", "::ffff:10.0.0.1", "2002:c0a8::1"] {
            assert!(!public_ip(ip.parse().unwrap()), "{ip} should not be public");
        }
    }

    #[tokio::test]
    async fn names_resolving_to_private_addresses_are_refused() {
        // localhost.localdomain-style names are refused before DNS; this one goes through the resolver.
        assert_eq!(resolve_public("localhost", 80).await, Err(Blocked::Address));
        assert_eq!(resolve_public("10.0.0.1", 80).await, Err(Blocked::Address));
    }

    /// Real request, through the environment's proxy: `URSA_TEST_NETWORK=1 cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn fetches_a_real_page() {
        let v = tempfile::tempdir().unwrap();
        let p = fetch_preview(v.path(), &url("https://www.rust-lang.org/"), "test").await.unwrap();
        assert!(p.title.is_some_and(|t| t.contains("Rust")), "title");
        assert!(p.icon.is_some(), "favicon cached");
    }

    #[test]
    fn reads_the_head() {
        let html = r#"<!doctype html><html><head>
            <title> Titre &amp; sous-titre </title>
            <meta name="description" content="Une description &quot;courte&quot;.">
            <meta property="og:title" content="Le vrai titre">
            <meta property='og:image' content='/img/carte.png'>
            <link rel="shortcut icon" href="favicon.png">
            </head><body><meta property="og:title" content="ignoré"></body></html>"#;
        let head = parse_head(html, &url("https://example.com/articles/1"));
        assert_eq!(head.title.as_deref(), Some("Le vrai titre"));
        assert_eq!(head.description.as_deref(), Some("Une description \"courte\"."));
        assert_eq!(head.image.as_deref(), Some("https://example.com/img/carte.png"));
        assert_eq!(head.icon.as_deref(), Some("https://example.com/articles/favicon.png"));
        let bare = parse_head("<title>Seul &#233;t&#xE9;</title>", &url("https://example.org/"));
        assert_eq!(bare.title.as_deref(), Some("Seul été"));
        assert_eq!(bare.icon.as_deref(), Some("https://example.org/favicon.ico"));
        // Scripts in attributes are just text.
        assert_eq!(parse_head(r#"<meta property="og:image" content="javascript:alert(1)">"#, &url("https://e.com/")).image, None);
    }
}
