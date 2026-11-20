import { useEffect } from "react";
import { CJK_BYTES, CJK_FILES, checkCjkFont, downloadCjkFont, removeCjkFont, restartNeeded } from "../../app/cjkFont";
import { useT } from "../../app/i18n";
import { useApp } from "../../app/store";
import { Button } from "../../components/Button";
import { Field } from "./fields";
import s from "./Settings.module.css";

/** Settings › Drawings: the CJK font of drawings, downloaded once on demand (decision P12-11). */
export function DrawingsPage() {
  const t = useT();
  const font = useApp((st) => st.cjkFont);
  useEffect(() => {
    if (font.kind === "unknown") void checkCjkFont();
  }, [font.kind]);
  const mb = (CJK_BYTES / 1024 / 1024).toLocaleString(t.dates.locale, { maximumFractionDigits: 0 });

  const value =
    font.kind === "ready"
      ? t.settings.cjkFontReady
      : font.kind === "downloading"
        ? t.settings.cjkFontProgress(font.done, CJK_FILES)
        : font.kind === "absent" && font.present > 0
          ? t.settings.cjkFontPartial(font.present, CJK_FILES)
          : font.kind === "absent"
            ? t.settings.cjkFontAbsent
            : undefined;

  return (
    <Field label={t.settings.cjkFont} hint={t.settings.cjkFontHint(mb)} value={value}>
      {font.kind === "downloading" && <progress className={s.progress} max={CJK_FILES} value={font.done} aria-label={t.settings.cjkFont} />}
      {font.kind === "failed" && (
        <p className={s.notice} role="alert">
          {t.settings.cjkFontFailed(font.message)}
        </p>
      )}
      {font.kind === "ready" ? (
        <>
          <p className={s.notice}>{restartNeeded() ? t.settings.cjkFontRestart : t.settings.cjkFontUsed}</p>
          <div>
            <Button onClick={() => void removeCjkFont()}>{t.settings.cjkFontRemove}</Button>
          </div>
        </>
      ) : (
        <div>
          <Button variant="primary" disabled={font.kind === "downloading" || font.kind === "unknown"} onClick={() => void downloadCjkFont()}>
            {font.kind === "failed" || (font.kind === "absent" && font.present > 0) ? t.settings.cjkFontResume : t.settings.cjkFontDownload(mb)}
          </Button>
        </div>
      )}
    </Field>
  );
}
