import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { History, PenTool } from "lucide-react";
import { confirmAction } from "../../app/confirm";
import { openDrawingVersions, saveDrawing, setDrawingAssetPath } from "../../app/drawings";
import { checkCjkFont, noteDrawingEditorLoaded } from "../../app/cjkFont";
import { useT } from "../../app/i18n";
import { setState, useApp } from "../../app/store";
import { matchShortcut, shortcutLabel } from "../../app/shortcuts";
import { Button } from "../../components/Button";
import { Tooltip } from "../../components/Tooltip";
import { useInertApp } from "../../components/useInertApp";
import { DARK_PALETTES } from "../../services/settings";
import type { DrawingHandle } from "./DrawingEditor";
import s from "./DrawingDialog.module.css";

// Excalidraw is loaded on first use only: nothing at startup (decision P12-5).
// Its fonts come from the app itself (see scripts/vite-excalidraw-fonts.ts).
const DrawingEditor = lazy(() => {
  setDrawingAssetPath();
  noteDrawingEditorLoaded();
  return import("./DrawingEditor");
});

/** Chinese, Japanese or Korean characters. */
const CJK_TEXT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Shown when the drawing tool's code cannot load (it is part of the app: should never happen). */
class LoadBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Full-screen drawing editor (Excalidraw): a thin bar with the title, Close
 * and Save, the canvas below. Its own keys while open (the app's shortcuts
 * wait); Close asks before losing changes.
 */
export function DrawingDialog() {
  const request = useApp((st) => st.drawing);
  // A version opened in place of the drawing is a new editor.
  return request ? <Shell key={`${request.id}:${request.restoredAt ?? ""}`} /> : null;
}

function Shell() {
  const t = useT();
  const request = useApp((st) => st.drawing)!;
  const language = useApp((st) => st.settings.language);
  const handle = useRef<DrawingHandle | null>(null);
  const [saving, setSaving] = useState(false);
  const [dark] = useState(() => (DARK_PALETTES as readonly string[]).includes(document.documentElement.dataset.theme ?? ""));
  // Chinese, Japanese or Korean in the drawing, without the CJK font: say where to get it.
  const cjkFont = useApp((st) => st.cjkFont.kind);
  const hasCjk = request.scene !== null && CJK_TEXT.test(request.scene);
  useEffect(() => {
    if (hasCjk && cjkFont === "unknown") void checkCjkFont();
  }, [hasCjk, cjkFont]);
  useInertApp();

  // Focus comes back to where it was (the editor), without scrolling it.
  useEffect(() => {
    const previous = document.activeElement;
    return () => {
      if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
    };
  }, []);

  // A version being restored counts as a change: closing asks first.
  const changed = useCallback(() => request.restoredAt !== undefined || handle.current?.dirty() === true, [request]);
  const mayLeave = useCallback(
    async () => !changed() || (await confirmAction({ title: t.drawings.discardTitle, body: t.drawings.discardBody, confirmLabel: t.drawings.discardConfirm, danger: true })),
    [changed, t],
  );
  const close = useCallback(async () => {
    if (saving) return;
    if (await mayLeave()) setState({ drawing: null });
  }, [saving, mayLeave]);
  const versions = useCallback(async () => {
    if (!saving && request.scene !== null && (await mayLeave())) openDrawingVersions({ id: request.id, noteId: request.noteId });
  }, [saving, request, mayLeave]);

  const save = useCallback(async () => {
    const editor = handle.current;
    if (!editor || saving) return;
    setSaving(true);
    try {
      const out = await editor.export();
      // A new drawing left empty: nothing to keep.
      if (!out || (request.scene === null && out.empty)) {
        setState({ drawing: null });
        return;
      }
      if (await saveDrawing(request, out.source, out.svg)) setState({ drawing: null });
    } finally {
      setSaving(false);
    }
  }, [request, saving]);

  // Escape is Excalidraw's (deselect, leave a tool); Ctrl+Enter (by default) saves.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (matchShortcut(e, "drawing") === "drawing.save") {
      e.preventDefault();
      void save();
    }
  };

  return createPortal(
    <div className={s.shell} role="dialog" aria-modal="true" aria-labelledby="drawing-title" onKeyDown={onKeyDown}>
      <header className={s.bar}>
        <PenTool className={s.icon} aria-hidden />
        <h2 id="drawing-title" className={s.title}>
          {request.restoredAt !== undefined ? t.drawings.versionTitle(new Intl.DateTimeFormat(t.dates.locale, { dateStyle: "medium", timeStyle: "short" }).format(request.restoredAt)) : t.drawings.title}
        </h2>
        {request.restoredAt !== undefined && <span className={s.note}>{t.drawings.versionHint}</span>}
        {hasCjk && cjkFont === "absent" && (
          <button type="button" className={s.link} onClick={() => setState({ settingsPage: "drawings" })}>
            {t.drawings.cjkMissing}
          </button>
        )}
        <div className={s.spacer} />
        {request.scene !== null && (
          <Button size="small" icon={History} onClick={() => void versions()} disabled={saving}>
            {t.drawings.versions}
          </Button>
        )}
        <Button size="small" onClick={() => void close()} disabled={saving}>
          {t.drawings.cancel}
        </Button>
        <Tooltip label={t.drawings.save} shortcut={shortcutLabel("drawing.save", t)}>
          <Button size="small" variant="primary" onClick={() => void save()} disabled={saving}>
            {t.drawings.save}
          </Button>
        </Tooltip>
      </header>
      <div className={s.canvas}>
        <LoadBoundary fallback={<p className={s.message}>{t.drawings.loadFailed}</p>}>
          <Suspense fallback={<p className={s.message}>{t.drawings.loading}</p>}>
            <DrawingEditor scene={request.scene} dark={dark} language={language} handle={handle} />
          </Suspense>
        </LoadBoundary>
      </div>
    </div>,
    document.body,
  );
}
