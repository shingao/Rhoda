import { useEffect, useRef, useState } from "react";
import { Code, Download, File, FileText, FileType, Folder, Image, type LucideIcon } from "lucide-react";
import { chooseExportFolder, closeExport, exportFolder, reportExport, runExport } from "../../app/export";
import { useT } from "../../app/i18n";
import { showToast, updateSettings, useApp } from "../../app/store";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import { Segmented } from "../../components/Segmented";
import { Toggle } from "../../components/Toggle";
import { errorMessage } from "../../services/errors";
import { EXPORT_FORMATS, type ExportFormat, type ExportSettings } from "../../services/settings";
import s from "./ExportDialog.module.css";

const ICONS: Record<ExportFormat, LucideIcon> = { md: FileText, html: Code, pdf: File, docx: FileType, image: Image };

type Option = "images" | "tags" | "currentTheme" | "paper" | "stickers";
/** Options that make sense for each format [DESIGN §2.17: options contextual to the format]. */
const OPTIONS: Record<ExportFormat, readonly Option[]> = {
  md: ["images", "tags"],
  html: ["images", "tags", "stickers", "paper", "currentTheme"],
  pdf: ["images", "tags", "stickers", "paper", "currentTheme"],
  docx: ["images", "tags", "stickers"],
  image: ["images", "tags", "stickers", "paper", "currentTheme"],
};

/** Export dialog [DESIGN §2.17, maquette 08]: format tiles, options, destination. */
export function ExportDialog() {
  const request = useApp((st) => st.exportDialog);
  if (!request) return null;
  return <ExportForm noteIds={request.noteIds} subtitle={request.subtitle} />;
}

function ExportForm({ noteIds, subtitle }: { noteIds: string[]; subtitle: string }) {
  const t = useT();
  const e = t.exportDialog;
  const options = useApp((st) => st.settings.export);
  const [folder, setFolder] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    exportFolder()
      .then((dir) => live && setFolder(dir))
      .catch(() => live && setFolder(null));
    return () => {
      live = false;
    };
  }, []);

  const set = (patch: Partial<ExportSettings>) => updateSettings((st) => ({ ...st, export: { ...st.export, ...patch } }));
  const format = options.format;
  const label = e.formats[format];
  const busy = progress !== null;

  const run = async () => {
    if (!folder || busy) return;
    setProgress({ done: 0, total: noteIds.length });
    try {
      const result = await runExport(noteIds, format, options, folder, (done, total) => setProgress({ done, total }));
      closeExport();
      reportExport(result);
    } catch (err) {
      setProgress(null);
      showToast(e.failed(subtitle, errorMessage(err), 1));
    }
  };

  const hint: Partial<Record<Option, string>> = {
    currentTheme: e.currentThemeHint,
    paper: e.paperHint,
    stickers: format === "docx" ? e.docxStickersHint : e.stickersHint,
  };

  return (
    <Modal
      title={noteIds.length > 1 ? e.titleMany : e.title}
      subtitle={subtitle}
      closeLabel={t.modal.close}
      onClose={() => !busy && closeExport()}
      initialFocus={first}
      footer={
        <>
          <Button onClick={closeExport} disabled={busy}>
            {e.cancel}
          </Button>
          <Button variant="primary" icon={Download} onClick={() => void run()} disabled={!folder || busy} aria-busy={busy}>
            {progress ? e.exporting(progress.done + 1 > progress.total ? progress.total : progress.done + 1, progress.total) : e.exportAs(label)}
          </Button>
        </>
      }
    >
      <div className={s.tiles} role="radiogroup" aria-label={e.formatsLabel}>
        {EXPORT_FORMATS.map((f, i) => {
          const Icon = ICONS[f];
          const label = f === "image" ? options.image.toUpperCase() : e.formats[f];
          return (
            <button
              key={f}
              ref={f === format || (i === 0 && !EXPORT_FORMATS.includes(format)) ? first : undefined}
              type="button"
              role="radio"
              aria-checked={f === format}
              tabIndex={f === format ? 0 : -1}
              className={s.tile}
              disabled={busy}
              onClick={() => set({ format: f })}
              onKeyDown={(ev) => {
                const step = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
                if (!step) return;
                ev.preventDefault();
                const next = EXPORT_FORMATS[(i + step + EXPORT_FORMATS.length) % EXPORT_FORMATS.length]!;
                set({ format: next });
                (ev.currentTarget.parentElement?.querySelector(`[data-format="${next}"]`) as HTMLElement | null)?.focus();
              }}
              data-format={f}
            >
              <Icon className={s.tileIcon} aria-hidden />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <div className={s.options}>
        {format === "pdf" && (
          <div className={s.row}>
            <span className={s.rowLabel}>{e.pageSize}</span>
            <Segmented
              label={e.pageSize}
              value={options.page}
              options={[
                { value: "a4", label: "A4" },
                { value: "letter", label: "Letter" },
              ]}
              onChange={(page) => set({ page })}
            />
          </div>
        )}
        {format === "image" && (
          <div className={s.row}>
            <span className={s.rowLabel}>{e.imageType}</span>
            <Segmented
              label={e.imageType}
              value={options.image}
              options={[
                { value: "png", label: "PNG" },
                { value: "jpg", label: "JPG" },
              ]}
              onChange={(image) => set({ image })}
            />
          </div>
        )}
        {OPTIONS[format].map((o) => (
          <div key={o} className={s.toggle}>
            <Toggle label={e[o]} hint={hint[o]} checked={options[o]} onChange={(v) => set({ [o]: v })} />
          </div>
        ))}
        {format === "image" && <p className={s.note}>{e.imageHint}</p>}
      </div>

      <div className={s.destination}>
        <Folder className={s.folderIcon} aria-hidden />
        <span className={s.path} title={folder ?? undefined} aria-label={e.destination}>
          {folder ?? "…"}
        </span>
        <button
          type="button"
          className={s.change}
          disabled={busy}
          onClick={() => void chooseExportFolder(folder).then((dir) => dir && setFolder(dir))}
        >
          {e.change}
        </button>
      </div>
    </Modal>
  );
}
