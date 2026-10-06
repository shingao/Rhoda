import { useState } from "react";
import { useT } from "../../app/i18n";
import { ocrLanguages, reindexOcr } from "../../app/ocr";
import { updateSettings, useApp } from "../../app/store";
import { Button } from "../../components/Button";
import { Stepper } from "../../components/Stepper";
import { Toggle } from "../../components/Toggle";
import { PDF_PAGES, type OcrSettings } from "../../services/settings";
import { Field } from "./fields";
import s from "./Settings.module.css";

const setOcr = (patch: Partial<OcrSettings>) => updateSettings((st) => ({ ...st, ocr: { ...st.ocr, ...patch } }));

/** Settings › OCR: on/off, recognition languages installed in Windows, PDF pages, progress and Reindex. */
export function OcrPage() {
  const t = useT();
  const o = useApp((st) => st.settings.ocr);
  const { status, remaining } = useApp((st) => st.ocr);
  const [busy, setBusy] = useState(false);
  const used = status ? ocrLanguages() : [];
  const installed = status?.languages ?? [];
  const missing = ["fr", "en"].filter((p) => !installed.some((l) => l.tag.toLowerCase().startsWith(p)));

  const toggleLanguage = (tag: string, on: boolean) => {
    const next = on ? [...used, tag] : used.filter((l) => l !== tag);
    // At least one language: the last one stays.
    if (next.length) setOcr({ languages: next });
  };

  return (
    <>
      {status && !status.available && <p className={s.notice}>{t.settings.ocrUnavailable}</p>}
      <Toggle checked={o.enabled} onChange={(enabled) => setOcr({ enabled })} label={t.settings.ocrEnabled} hint={t.settings.ocrEnabledHint} />

      {status?.available && (
        <Field label={t.settings.ocrLanguages} hint={missing.length ? t.settings.ocrInstallHint : undefined}>
          {installed.length ? (
            installed.map((l) => <Toggle key={l.tag} checked={used.includes(l.tag)} onChange={(on) => toggleLanguage(l.tag, on)} label={l.name || l.tag} hint={l.tag} />)
          ) : (
            <p className={s.notice}>{t.settings.ocrNoLanguage}</p>
          )}
        </Field>
      )}

      <Field label={t.settings.ocrPdfPages} hint={t.settings.ocrPdfPagesHint}>
        <Stepper
          label={t.settings.ocrPdfPages}
          decreaseLabel={t.settings.smaller}
          increaseLabel={t.settings.larger}
          value={o.pdfPages}
          min={PDF_PAGES.min}
          max={PDF_PAGES.max}
          step={PDF_PAGES.step}
          format={(n) => String(n)}
          onChange={(pdfPages) => setOcr({ pdfPages })}
        />
      </Field>

      <Field label={t.settings.ocrProgress} value={remaining ? t.ocr.remaining(remaining) : t.settings.ocrUpToDate}>
        <div>
          <Button
            size="small"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void reindexOcr().finally(() => setBusy(false));
            }}
          >
            {t.settings.ocrReindex}
          </Button>
        </div>
      </Field>
    </>
  );
}
