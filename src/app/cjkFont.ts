import manifest from "virtual:excalidraw-cjk";
import { cjkFontApi } from "../services/fonts";
import { errorMessage } from "../services/errors";
import { getState, setState } from "./store";

/**
 * Excalidraw's CJK font (Xiaolai), downloaded once on demand from Settings ›
 * Drawings (decision P12-11): file after file, each checked by Rust against
 * the SHA-256 of the installed package. Chinese, Japanese and Korean text in
 * drawings is then drawn and embedded with it, the same everywhere.
 */

export type CjkFontState =
  | { kind: "unknown" }
  | { kind: "absent" | "ready"; present: number }
  | { kind: "downloading"; done: number }
  | { kind: "failed"; done: number; message: string };

export const CJK_FILES = manifest.files.length;
export const CJK_BYTES = manifest.files.reduce((sum, f) => sum + f.bytes, 0);

/** Whether Excalidraw's code ran this session (it reads where its fonts are once). */
let editorLoaded = false;
export const noteDrawingEditorLoaded = () => {
  editorLoaded = true;
};
export const restartNeeded = () => editorLoaded;

export async function checkCjkFont(): Promise<void> {
  try {
    const present = await cjkFontApi.present(manifest.files);
    setState({ cjkFont: { kind: present === CJK_FILES ? "ready" : "absent", present } });
  } catch (e) {
    console.warn("[ursa] CJK font state unknown", e);
    setState({ cjkFont: { kind: "absent", present: 0 } });
  }
}

/** Downloads the missing files (those already there and intact are skipped by Rust). */
export async function downloadCjkFont(): Promise<void> {
  if (getState().cjkFont.kind === "downloading") return;
  let done = 0;
  setState({ cjkFont: { kind: "downloading", done } });
  try {
    for (const file of manifest.files) {
      await cjkFontApi.fetch(file.name, file.sha256);
      done++;
      setState({ cjkFont: { kind: "downloading", done } });
    }
    if (import.meta.env.DEV) localStorage.setItem("ursa-dev-cjk", "1");
    setState({ cjkFont: { kind: "ready", present: CJK_FILES } });
  } catch (e) {
    console.warn("[ursa] CJK font download stopped", done, e);
    setState({ cjkFont: { kind: "failed", done, message: errorMessage(e) } });
  }
}

export async function removeCjkFont(): Promise<void> {
  try {
    await cjkFontApi.remove();
  } finally {
    await checkCjkFont();
  }
}
