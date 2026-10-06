import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../app/i18n";
import { ocrTextOf } from "../../app/ocr";
import { setState, showToast, useApp } from "../../app/store";
import { Button } from "../../components/Button";
import s from "./OcrText.module.css";

const close = () => setState({ ocrText: null });

/** "Text" of a selected image [DESIGN §2.12]: what OCR read in it, to copy. */
export function OcrText() {
  const request = useApp((st) => st.ocrText);
  // Re-rendered when results arrive.
  useApp((st) => st.ocr.version);
  const t = useT();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!request) return;
    root.current?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [request]);

  if (!request) return null;
  const result = ocrTextOf(request.path);
  const text = result.status === "ready" ? result.text : "";
  const message = result.status === "ready" ? (text ? null : t.ocrText.empty) : t.ocrText[result.status];

  return createPortal(
    <div
      ref={root}
      className={s.popover}
      style={{ top: request.at.y, left: request.at.x }}
      role="dialog"
      aria-label={t.ocrText.title}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          e.preventDefault();
          close();
        }
      }}
    >
      <div className={s.title}>{t.ocrText.title}</div>
      {message ? <p className={s.message}>{message}</p> : <pre className={s.text}>{text}</pre>}
      {text && (
        <div className={s.actions}>
          <Button
            size="small"
            onClick={() => {
              void navigator.clipboard.writeText(text).then(() => showToast(t.ocrText.copied));
              close();
            }}
          >
            {t.ocrText.copy}
          </Button>
        </div>
      )}
    </div>,
    document.body,
  );
}
