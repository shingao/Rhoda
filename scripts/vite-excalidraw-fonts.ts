import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Plugin } from "vite";

/**
 * Excalidraw's fonts served by the app itself (decision P12-5): under
 * `/excalidraw/fonts/…` in development, copied there in the build. Nothing is
 * fetched from a CDN (the app's CSP would block it anyway). The CJK font
 * (Xiaolai, 13 MB) is left out: Chinese, Japanese or Korean text in a drawing
 * uses the system's font.
 */
const SOURCE = join(process.cwd(), "node_modules/@excalidraw/excalidraw/dist/prod/fonts");
const BASE = "excalidraw/fonts";
const SKIP = new Set(["Xiaolai"]);

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
    configureServer(server) {
      const served = new Map(files(SOURCE).map((p) => [`/${published(p)}`, p]));
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
