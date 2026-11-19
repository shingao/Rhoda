import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PenTool } from "lucide-react";
import { confirmAction } from "../../app/confirm";
import { saveDrawing } from "../../app/drawings";
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
  (window as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = new URL("excalidraw/", document.baseURI).href;
  return import("./DrawingEditor");
});

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
  return request ? <Shell key={request.id} /> : null;
}

function Shell() {
  const t = useT();
  const request = useApp((st) => st.drawing)!;
  const language = useApp((st) => st.settings.language);
  const handle = useRef<DrawingHandle | null>(null);
  const [saving, setSaving] = useState(false);
  const [dark] = useState(() => (DARK_PALETTES as readonly string[]).includes(document.documentElement.dataset.theme ?? ""));
  useInertApp();

  // Focus comes back to where it was (the editor), without scrolling it.
  useEffect(() => {
    const previous = document.activeElement;
    return () => {
      if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
    };
  }, []);

  const close = useCallback(async () => {
    if (saving) return;
    if (handle.current?.dirty()) {
      const ok = await confirmAction({ title: t.drawings.discardTitle, body: t.drawings.discardBody, confirmLabel: t.drawings.discardConfirm, danger: true });
      if (!ok) return;
    }
    setState({ drawing: null });
  }, [saving, t]);

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
          {t.drawings.title}
        </h2>
        <div className={s.spacer} />
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
