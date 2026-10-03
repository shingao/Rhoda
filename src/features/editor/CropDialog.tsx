import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { applyCrop, closeCrop, cropSource, restoreOriginal, type CropRect, type CropRequest } from "../../app/crops";
import { useT } from "../../app/i18n";
import { useApp } from "../../app/store";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import s from "./CropDialog.module.css";

/** Non-destructive crop of an image (decision P7: modal, original kept, crop saved next to it). */
export function CropDialog() {
  const req = useApp((st) => st.crop);
  if (!req) return null;
  return <CropContent key={`${req.noteId}:${req.lineFrom}:${req.src}`} req={req} />;
}

type Source = NonNullable<Awaited<ReturnType<typeof cropSource>>>;
type Drag = { mode: string; x: number; y: number; start: CropRect };

const MIN = 16;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

function clampRect(r: CropRect, w: number, h: number): CropRect {
  const width = Math.min(Math.max(MIN, r.width), w);
  const height = Math.min(Math.max(MIN, r.height), h);
  return { x: Math.min(Math.max(0, r.x), w - width), y: Math.min(Math.max(0, r.y), h - height), width, height };
}

function CropContent({ req }: { req: CropRequest }) {
  const t = useT();
  const [source, setSource] = useState<Source | null | undefined>(undefined);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [rect, setRect] = useState<CropRect | null>(null);
  const [scale, setScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    let alive = true;
    void cropSource(req).then((src) => alive && setSource(src));
    return () => {
      alive = false;
    };
  }, [req]);

  const onLoad = () => {
    const el = img.current;
    const box = stage.current;
    if (!el || !box || !source) return;
    const w = el.naturalWidth;
    const h = el.naturalHeight;
    setNatural({ w, h });
    // Room inside the stage's padding, where the handles of a full-size frame still fit.
    const pad = parseFloat(getComputedStyle(box).paddingLeft) * 2;
    setScale(Math.min((box.clientWidth - pad) / w, (box.clientHeight - pad) / h, 1));
    setRect(source.rect ? clampRect(source.rect, w, h) : { x: 0, y: 0, width: w, height: h });
  };

  const point = (e: ReactPointerEvent) => {
    const r = img.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const onDown = (e: ReactPointerEvent) => {
    if (!rect || !natural || e.button !== 0) return;
    const mode = (e.target as HTMLElement).dataset.mode ?? "new";
    const p = point(e);
    drag.current = { mode, ...p, start: mode === "new" ? { x: p.x, y: p.y, width: 0, height: 0 } : rect };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !natural) return;
    const p = point(e);
    const dx = p.x - d.x;
    const dy = p.y - d.y;
    const s0 = d.start;
    let next: CropRect;
    if (d.mode === "move") next = { ...s0, x: s0.x + dx, y: s0.y + dy };
    else if (d.mode === "new") next = { x: Math.min(d.x, p.x), y: Math.min(d.y, p.y), width: Math.abs(dx), height: Math.abs(dy) };
    else {
      const left = d.mode.includes("w") ? s0.x + dx : s0.x;
      const right = d.mode.includes("e") ? s0.x + s0.width + dx : s0.x + s0.width;
      const top = d.mode.includes("n") ? s0.y + dy : s0.y;
      const bottom = d.mode.includes("s") ? s0.y + s0.height + dy : s0.y + s0.height;
      next = { x: Math.min(left, right), y: Math.min(top, bottom), width: Math.abs(right - left), height: Math.abs(bottom - top) };
    }
    setRect(clampRect(next, natural.w, natural.h));
  };

  const onUp = () => {
    drag.current = null;
  };

  const confirm = async () => {
    const el = img.current;
    if (!el || !rect || !source) return;
    const ext = (/\.([^.]+)$/.exec(source.path)?.[1] ?? "png").toLowerCase();
    const r = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    const canvas = document.createElement("canvas");
    canvas.width = r.width;
    canvas.height = r.height;
    canvas.getContext("2d")!.drawImage(el, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
    setBusy(true);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, MIME[ext] ?? "image/png", 0.92));
    if (blob) await applyCrop(req, source.path, r, new Uint8Array(await blob.arrayBuffer()), MIME[ext] ? ext : "png");
    setBusy(false);
  };

  const full = natural !== null && rect !== null && rect.x === 0 && rect.y === 0 && rect.width === natural.w && rect.height === natural.h;

  return (
    <Modal
      wide
      title={t.crop.title}
      subtitle={t.crop.subtitle}
      closeLabel={t.crop.cancel}
      onClose={closeCrop}
      footer={
        <>
          {source?.cropped && (
            <Button className={s.restore} onClick={() => restoreOriginal(req, source.path)}>
              {t.crop.restore}
            </Button>
          )}
          <Button onClick={closeCrop}>{t.crop.cancel}</Button>
          <Button variant="primary" disabled={busy || !rect || full} onClick={() => void confirm()}>
            {t.crop.apply}
          </Button>
        </>
      }
    >
      <div ref={stage} className={s.stage}>
        {source === null && <p className={s.error}>{t.crop.unavailable}</p>}
        {source && (
          <div className={s.canvas} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            <img
              ref={img}
              src={source.url}
              crossOrigin="anonymous"
              alt=""
              draggable={false}
              onLoad={onLoad}
              style={natural ? { width: natural.w * scale, height: natural.h * scale } : undefined}
            />
            {rect && (
              <div className={s.shade} aria-hidden>
                <div
                  className={s.hole}
                  style={{ left: rect.x * scale, top: rect.y * scale, width: rect.width * scale, height: rect.height * scale }}
                />
              </div>
            )}
            {rect && (
              <div
                className={s.rect}
                data-mode="move"
                style={{ left: rect.x * scale, top: rect.y * scale, width: rect.width * scale, height: rect.height * scale }}
              >
                {["nw", "ne", "sw", "se"].map((m) => (
                  <span key={m} className={`${s.handle} ${s[m]}`} data-mode={m} />
                ))}
                <span className={s.size}>
                  {Math.round(rect.width)} × {Math.round(rect.height)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
