import { useEffect, useState } from "react";
import { confirmAction } from "../../app/confirm";
import { useT } from "../../app/i18n";
import { BackupFailedError, listBackups, restoreBackup, undoAction, type BackupSummary } from "../../app/notes";
import { showToast, useApp } from "../../app/store";
import { Button } from "../../components/Button";
import s from "./Settings.module.css";

/**
 * Settings › Backups: the safety copies of `.ursa/backups/` (30 days). Restoring
 * makes the same check as the toast's "Undo" and asks first if notes were
 * edited since; the current versions are copied before, so it can be undone.
 */
export function BackupsPage() {
  const t = useT();
  const vault = useApp((st) => st.vault);
  const [list, setList] = useState<BackupSummary[] | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listBackups()
      .then((l) => alive && setList(l))
      .catch((e: unknown) => {
        console.warn("[ursa] backups not listed", e);
        if (alive) setList([]);
      });
    return () => {
      alive = false;
    };
  }, [version, vault]);

  const restore = async (b: BackupSummary) => {
    setBusy(b.name);
    try {
      let result = await restoreBackup(b.name, false);
      if (result.kind === "changed") {
        const ok = await confirmAction({
          title: t.backups.confirmTitle,
          body: t.backups.confirmBody(result.titles),
          confirmLabel: t.backups.restore,
          danger: true,
        });
        if (!ok) return;
        result = await restoreBackup(b.name, true);
      }
      if (result.kind === "restored") showToast(t.backups.restored(result.count), result.backup ? undoAction(result.backup) : undefined);
      else if (result.kind === "failed") showToast(t.backups.failed);
    } catch (e) {
      if (!(e instanceof BackupFailedError)) throw e;
      showToast(t.undo.backupFailed);
    } finally {
      setBusy(null);
      setVersion((v) => v + 1);
    }
  };

  const date = new Intl.DateTimeFormat(t.dates.locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <p className={s.hint}>{t.backups.intro}</p>
      {list?.length === 0 && <p className={s.empty}>{t.backups.empty}</p>}
      {list && list.length > 0 && (
        <ul className={s.backups}>
          {list.map((b) => (
            <li key={b.name} className={s.backup}>
              <div className={s.backupText}>
                <span className={s.backupOp}>{b.operation ? t.backups.operations[b.operation] : b.name}</span>
                <span className={s.backupMeta}>
                  {b.time !== null && date.format(b.time)} · {t.backups.notes(b.notes)}
                </span>
              </div>
              <Button size="small" disabled={busy !== null} onClick={() => void restore(b)}>
                {t.backups.restore}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
