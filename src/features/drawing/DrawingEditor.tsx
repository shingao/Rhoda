import { useImperativeHandle, useMemo, useRef, type Ref } from "react";
import { Excalidraw, exportToSvg, getNonDeletedElements, hashElementsVersion, MainMenu, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import type { Language } from "../../i18n";
import s from "./DrawingEditor.module.css";

/** What the dialog asks of the editor. */
export interface DrawingHandle {
  /** Changed since it was opened. */
  dirty(): boolean;
  /** The scene (Excalidraw JSON) and its picture; null before the editor is ready. */
  export(): Promise<{ source: string; svg: string; empty: boolean } | null>;
}

const LANGS: Record<Language, string> = { fr: "fr-FR", en: "en" };
/** Margin around the drawing in its picture, px. */
const PICTURE_PADDING = 16;

/**
 * Excalidraw (MIT), loaded on demand. The picture is always made for a light
 * page with no background (the editor turns it for dark palettes): one file
 * whatever the theme, readable in any Markdown viewer.
 */
export default function DrawingEditor({ scene, dark, language, handle }: { scene: string | null; dark: boolean; language: Language; handle: Ref<DrawingHandle> }) {
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const initial = useMemo<ExcalidrawInitialDataState | null>(() => {
    if (!scene) return null;
    try {
      const data = JSON.parse(scene) as ExcalidrawInitialDataState;
      return { ...data, scrollToContent: true };
    } catch {
      return null;
    }
  }, [scene]);
  // Version of the elements as opened: "dirty" compares with it.
  const opened = useRef<number | null>(initial?.elements ? hashElementsVersion(getNonDeletedElements(initial.elements as never)) : 0);

  useImperativeHandle(handle, () => ({
    dirty: () => {
      const a = api.current;
      if (!a) return false;
      const now = hashElementsVersion(getNonDeletedElements(a.getSceneElements()));
      return opened.current !== null && now !== opened.current && !(scene === null && a.getSceneElements().length === 0);
    },
    export: async () => {
      const a = api.current;
      if (!a) return null;
      const elements = a.getSceneElements();
      const appState = a.getAppState();
      const files = a.getFiles();
      const source = serializeAsJSON(elements, appState, files, "local");
      const picture = await exportToSvg({
        elements: getNonDeletedElements(elements),
        appState: { ...appState, exportBackground: false, exportWithDarkMode: false, exportEmbedScene: false },
        files,
        exportPadding: PICTURE_PADDING,
      });
      // Fonts Excalidraw could not embed are referenced by their CDN address: left
      // out, so that the picture never points outside (decision P12-11).
      for (const style of picture.querySelectorAll("style")) {
        style.textContent = (style.textContent ?? "").replace(/@font-face\s*\{[^}]*\}/g, (rule: string) => (/url\(\s*["']?data:/.test(rule) ? rule : ""));
      }
      return { source, svg: picture.outerHTML, empty: getNonDeletedElements(elements).length === 0 };
    },
  }), [scene]);

  return (
    <div className={s.host}>
      <Excalidraw
        excalidrawAPI={(a) => {
          api.current = a;
          // Restored on load (versions may move): the baseline is what the editor shows first.
          requestAnimationFrame(() => {
            opened.current = hashElementsVersion(getNonDeletedElements(a.getSceneElements()));
          });
        }}
        initialData={initial}
        theme={dark ? "dark" : "light"}
        langCode={LANGS[language]}
        autoFocus
        UIOptions={{
          canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false, changeViewBackgroundColor: true, clearCanvas: true },
        }}
      >
        <MainMenu>
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>
    </div>
  );
}
