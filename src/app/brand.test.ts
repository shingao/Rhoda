import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { updateSettings } from "./store";
import { welcomeContent } from "./welcome";

vi.mock("./notes", () => ({ addNote: vi.fn(), selectNote: vi.fn() }));

/**
 * The app was called Ursa before 1.0: that name stays in the code (internal
 * folder `.ursa/`, keys, crate), never in what the user reads. The folder's
 * path itself may be shown (Settings › Backups): it is where the files are.
 */
const OLD_NAME = /(?<!\.)\bursa\b/i;

/** Every string of a message table, functions called with sample arguments. */
function texts(value: unknown, path = ""): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (typeof value === "function") {
    const args = Array.from({ length: value.length }, () => "x");
    try {
      return texts((value as (...a: unknown[]) => unknown)(...args), path);
    } catch {
      return [];
    }
  }
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => texts(v, path ? `${path}.${k}` : k));
  return [];
}

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

describe("the old name never reaches the user", () => {
  it.each([
    ["fr", fr],
    ["en", en],
  ])("interface texts (%s)", (_, messages) => {
    const found = texts(messages).filter(([, text]) => OLD_NAME.test(text));
    expect(found).toEqual([]);
  });

  it.each(["fr", "en"] as const)("welcome note (%s): Bullshit and #bullshit/…", (language) => {
    updateSettings((s) => ({ ...s, language }));
    const { title, content } = welcomeContent(0);
    expect(title).toMatch(/Bullshit/);
    expect(content).toMatch(/#bullshit\//);
    expect(content).not.toMatch(OLD_NAME);
  });

  it("sample notes", () => {
    const dir = join(root, "samples");
    const found = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .filter((f) => OLD_NAME.test(readFileSync(join(dir, f), "utf8")));
    expect(found).toEqual([]);
  });

  it("installer, window and page titles", () => {
    expect(read("src-tauri", "installer", "French.nsh").split("\n").filter((l) => !l.startsWith(";") && OLD_NAME.test(l))).toEqual([]);
    const conf = JSON.parse(read("src-tauri", "tauri.conf.json")) as { productName: string; app: { windows: Array<{ title: string }> }; bundle: Record<string, unknown> };
    expect(conf.productName).toBe("Bullshit");
    expect(conf.app.windows.map((w) => w.title)).toEqual(["Bullshit"]);
    expect(JSON.stringify(conf.bundle)).not.toMatch(OLD_NAME);
    expect(read("index.html")).toMatch(/<title>Bullshit<\/title>/);
  });
});
