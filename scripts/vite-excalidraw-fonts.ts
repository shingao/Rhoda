import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Plugin } from "vite";

/**
 * Excalidraw's fonts served by the app itself (decision P12-5): under
 * `/excalidraw/fonts/…` in development, copied there in the build. Nothing is
 * fetched from a CDN (the app's CSP would block it anyway).
 *
 * The CJK font (Xiaolai, 209 files, 13 MB) is not shipped: Settings › Drawings
 * downloads it on demand (decision P12-11). This plugin gives the app its
 * manifest (`virtual:excalidraw-cjk`: names, SHA-256, sizes, package version),
 * so that the download only accepts these exact files; in development the
 * in-memory vault serves them from the package (`/dev-cjk/fonts/Xiaolai/…`).
 */
const SOURCE = join(process.cwd(), "node_modules/@excalidraw/excalidraw/dist/prod/fonts");
const BASE = "excalidraw/fonts";
const SKIP = new Set(["Xiaolai"]);
const CJK = join(SOURCE, "Xiaolai");
const MANIFEST = "virtual:excalidraw-cjk";

function cjkManifest(): string {
  const version = (JSON.parse(readFileSync(join(process.cwd(), "node_modules/@excalidraw/excalidraw/package.json"), "utf8")) as { version: string }).version;
  const files = readdirSync(CJK)
    .filter((name) => name.endsWith(".woff2"))
    .sort()
    .map((name) => {
      const bytes = readFileSync(join(CJK, name));
      return { name, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
    });
  return `export default ${JSON.stringify({ version, files })};`;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return SKIP.has(name) ? [] : files(path);
    return name.endsWith(".woff2") ? [path] : [];
  });
}

const published = (path: string) => `${BASE}/${relative(SOURCE, path).split(sep).join("/")}`;

export function excalidrawFonts(): Plugin {
  return {
    name: "excalidraw-fonts",
    resolveId(id) {
      return id === MANIFEST ? `\0${MANIFEST}` : undefined;
    },
    load(id) {
      return id === `\0${MANIFEST}` ? cjkManifest() : undefined;
    },
    configureServer(server) {
      const served = new Map(files(SOURCE).map((p) => [`/${published(p)}`, p]));
      // Development only: the "downloaded" CJK font of the in-memory vault.
      for (const name of readdirSync(CJK)) served.set(`/dev-cjk/fonts/Xiaolai/${name}`, join(CJK, name));
      server.middlewares.use((req, res, next) => {
        const path = served.get(decodeURIComponent((req.url ?? "").split("?")[0]!));
        if (!path) return next();
        res.setHeader("Content-Type", "font/woff2");
        res.end(readFileSync(path));
      });
    },
    generateBundle() {
      for (const path of files(SOURCE)) this.emitFile({ type: "asset", fileName: published(path), source: readFileSync(path) });
    },
  };
}
