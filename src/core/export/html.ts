import { headingSlug, plainText, type Block, type Inline, type TextAlign } from "./model";

/**
 * A note's document as HTML (the body of an export page; styles in
 * `features/export/export.css`). Everything is escaped: raw HTML in a note is
 * shown as text, never interpreted. Classes start with `u-`.
 */

export interface ExportImage {
  /** Data URL (standalone file) or any URL the page can load. */
  src: string;
}

export interface LinkPreviewData {
  title: string;
  description?: string;
  domain: string;
  image?: string;
}

/** A sticker or post-it, placed before the block that starts at `line` (or the first one after). */
export type Decoration =
  | { kind: "sticker"; line: number; src: string; size: number; rotation: number; side: "left" | "right"; offset: number }
  | { kind: "postit"; line: number; text: string; color: string; size: number; rotation: number; side: "left" | "right" };

export interface HtmlOptions {
  /** Image of the note (`![…](src)`), or null when it cannot be included (remote, missing, option off). */
  image: (src: string) => ExportImage | null;
  /** Wiki link to another note: its link (another exported file), or null for plain text. */
  wiki: (target: string) => string | null;
  /** Card of a URL alone on its line, or null for a plain link. */
  preview?: (url: string) => LinkPreviewData | null;
  decorations?: readonly Decoration[];
  /** Labels (export language). */
  labels: { done: string; todo: string; pdf: string };
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** Links that keep working in a file opened anywhere: web, mail, and anchors of the page. */
export function safeHref(href: string): string | null {
  return /^(https?:|mailto:|#)/i.test(href.trim()) ? href.trim() : null;
}

export function renderHtml(blocks: readonly Block[], options: HtmlOptions): string {
  const ids = new HeadingIds();
  // Heading ids first, so `[[#Heading]]` written above its heading works too.
  const walkHeadings = (list: readonly Block[]) => {
    for (const b of list) {
      if (b.t === "heading") ids.add(plainText(b.children));
      else if (b.t === "quote") walkHeadings(b.blocks);
      else if (b.t === "list") b.items.forEach((i) => walkHeadings(i.blocks));
    }
  };
  walkHeadings(blocks);
  const r = new Renderer(options, ids);
  const body = r.blocks(blocks);
  return body + r.rest();
}

class HeadingIds {
  private readonly byText = new Map<string, string>();
  private readonly order: string[] = [];
  private readonly used = new Set<string>();
  private next = 0;

  add(text: string): void {
    let id = headingSlug(text) || "h";
    for (let n = 2; this.used.has(id); n++) id = `${headingSlug(text)}-${n}`;
    this.used.add(id);
    this.order.push(id);
    const key = text.trim().toLowerCase();
    if (!this.byText.has(key)) this.byText.set(key, id);
  }

  /** Ids in document order (headings are rendered in the same order). */
  take(): string {
    return this.order[this.next++] ?? "h";
  }

  find(text: string): string | null {
    return this.byText.get(text.trim().toLowerCase()) ?? null;
  }
}

class Renderer {
  private readonly pending: Decoration[];

  constructor(
    private readonly o: HtmlOptions,
    private readonly ids: HeadingIds,
  ) {
    this.pending = [...(o.decorations ?? [])].sort((a, b) => a.line - b.line);
  }

  /** Decorations anchored at or before `line`, not placed yet. */
  private decorationsUpTo(line: number): string {
    let out = "";
    while (this.pending.length && this.pending[0]!.line <= line) out += this.decoration(this.pending.shift()!);
    return out;
  }

  /** Decorations anchored after the last block (the note changed since). */
  rest(): string {
    return this.pending.splice(0).map((d) => this.decoration(d)).join("");
  }

  private decoration(d: Decoration): string {
    // Sizes and angles are the note's data; the look is in export.css.
    const turn = `--turn:${round(d.rotation)}deg`;
    if (d.kind === "sticker") {
      const style = `--size:${round(d.size)}px;--dy:${round(Math.max(0, d.offset))}px;${turn}`;
      return `<span class="u-sticker u-${d.side}" style="${style}" aria-hidden="true"><img src="${escapeHtml(d.src)}" alt=""></span>`;
    }
    const text = escapeHtml(d.text).replace(/\n/g, "<br>");
    return `<aside class="u-postit u-${d.side}" data-color="${escapeHtml(d.color)}" style="--size:${round(d.size)}px;${turn}">${text}</aside>`;
  }

  blocks(list: readonly Block[]): string {
    return list.map((b) => this.block(b)).join("");
  }

  private block(b: Block): string {
    const at = this.decorationsUpTo(b.line);
    // The blank line before a block in the note, kept as space (data-gap, see export.css).
    const line = ` data-line="${b.line}"${b.gap ? " data-gap" : ""}`;
    switch (b.t) {
      case "heading":
        return `${at}<h${b.level} id="${this.ids.take()}"${alignClass(b.textAlign)}${line}>${this.inlines(b.children)}</h${b.level}>`;
      case "paragraph":
        return `${at}<p${alignClass(b.textAlign)}${line}>${this.inlines(b.children)}</p>`;
      case "quote":
        return `${at}<blockquote${alignClass(b.textAlign)}${line}>${this.blocks(b.blocks)}</blockquote>`;
      case "code":
        return `${at}<figure class="u-code"${line}>${b.lang ? `<figcaption>${escapeHtml(b.lang)}</figcaption>` : ""}<pre><code>${escapeHtml(b.text)}</code></pre></figure>`;
      case "rule":
        return `${at}<hr${line}>`;
      case "list": {
        const tag = b.ordered ? "ol" : "ul";
        const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : "";
        const tasks = b.items.some((i) => i.checked !== null) ? ' class="u-tasks"' : "";
        const items = b.items
          .map((item) => {
            const inner = this.decorationsUpTo(item.line) + this.blocks(item.blocks);
            const aligned = item.textAlign ? ` u-align-${item.textAlign}` : "";
            if (item.checked === null) return `<li${alignClass(item.textAlign)} data-line="${item.line}">${inner}</li>`;
            const label = item.checked ? this.o.labels.done : this.o.labels.todo;
            const box = `<input type="checkbox" disabled${item.checked ? " checked" : ""} aria-label="${escapeHtml(label)}">`;
            return `<li class="u-task${item.checked ? " u-done" : ""}${aligned}" data-line="${item.line}">${box}<div>${inner}</div></li>`;
          })
          .join("");
        return `${at}<${tag}${start}${tasks}${line}>${items}</${tag}>`;
      }
      case "table": {
        const align = (i: number) => (b.align[i] ? ` style="text-align:${b.align[i]}"` : "");
        const head = b.head.length ? `<thead><tr>${b.head.map((c, i) => `<th${align(i)}>${this.inlines(c)}</th>`).join("")}</tr></thead>` : "";
        const rows = b.rows.map((row) => `<tr>${row.map((c, i) => `<td${align(i)}>${this.inlines(c)}</td>`).join("")}</tr>`).join("");
        return `${at}<figure class="u-table"${line}><table>${head}<tbody>${rows}</tbody></table></figure>`;
      }
      case "image": {
        const image = this.o.image(b.src);
        if (!image) return `${at}<p class="u-missing"${line}>${escapeHtml(b.alt || b.src)}</p>`;
        const width = b.width ? ` style="width:${b.width}px"` : "";
        return `${at}<figure class="u-image"${line}><img src="${escapeHtml(image.src)}" alt="${escapeHtml(b.alt)}"${width}></figure>`;
      }
      case "pdf":
        return (
          `${at}<div class="u-card u-pdf"${line}><span class="u-pdf-badge">${escapeHtml(this.o.labels.pdf)}</span>` +
          `<span class="u-card-text"><span class="u-card-title">${escapeHtml(b.label)}</span>` +
          `<span class="u-card-meta">${escapeHtml(decodeURIComponentSafe(b.src.split("/").pop() ?? b.src))}</span></span></div>`
        );
      case "url": {
        const href = safeHref(b.url);
        const preview = this.o.preview?.(b.url);
        if (!preview || !href) return `${at}<p${line}>${href ? `<a href="${escapeHtml(href)}">${escapeHtml(b.url)}</a>` : escapeHtml(b.url)}</p>`;
        const thumb = preview.image ? `<img class="u-card-thumb" src="${escapeHtml(preview.image)}" alt="">` : "";
        const desc = preview.description ? `<span class="u-card-desc">${escapeHtml(preview.description)}</span>` : "";
        return (
          `${at}<a class="u-card u-link" href="${escapeHtml(href)}"${line}><span class="u-card-text">` +
          `<span class="u-card-meta">${escapeHtml(preview.domain)}</span><span class="u-card-title">${escapeHtml(preview.title)}</span>${desc}</span>${thumb}</a>`
        );
      }
    }
  }

  inlines(runs: readonly Inline[]): string {
    return runs.map((r) => this.inline(r)).join("");
  }

  private inline(r: Inline): string {
    switch (r.t) {
      case "text":
        return escapeHtml(r.text);
      case "strong":
        return `<strong>${this.inlines(r.children)}</strong>`;
      case "em":
        return `<em>${this.inlines(r.children)}</em>`;
      case "strike":
        return `<s>${this.inlines(r.children)}</s>`;
      case "highlight":
        return `<mark>${this.inlines(r.children)}</mark>`;
      case "underline":
        return `<u>${this.inlines(r.children)}</u>`;
      case "code":
        return `<code>${escapeHtml(r.text)}</code>`;
      case "break":
        return "<br>";
      case "tag":
        return `<span class="u-tag">#${escapeHtml(r.name)}</span>`;
      case "image": {
        const image = this.o.image(r.src);
        return image ? `<img class="u-inline-image" src="${escapeHtml(image.src)}" alt="${escapeHtml(r.alt)}">` : escapeHtml(r.alt);
      }
      case "link": {
        const href = safeHref(r.href);
        const inner = this.inlines(r.children);
        return href ? `<a href="${escapeHtml(href)}">${inner}</a>` : `<span class="u-link-text">${inner}</span>`;
      }
      case "wiki": {
        const hash = r.target.indexOf("#");
        // `[[#Heading]]`: a heading of this note.
        const local = hash === 0 ? this.ids.find(r.target.slice(1)) : null;
        const href = local ? `#${local}` : this.o.wiki(r.target);
        const label = escapeHtml(r.label.replace(/^#/, ""));
        return href ? `<a class="u-wiki" href="${escapeHtml(href)}">${label}</a>` : `<span class="u-wiki">${label}</span>`;
      }
    }
  }
}

const round = (n: number) => Math.round(n * 10) / 10;

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Class of a block aligned in the note (export.css: .u-align-*); none when left. */
function alignClass(align: TextAlign | undefined): string {
  return align ? ` class="u-align-${align}"` : "";
}
