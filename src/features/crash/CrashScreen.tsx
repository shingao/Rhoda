import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useT } from "../../app/i18n";
import { flushAll, unsavedNotes } from "../../app/notes";
import { sanitizeStem } from "../../core/note/filename";
import { Button } from "../../components/Button";
import { appWindow } from "../../services/appWindow";
import { saveCopies } from "../../services/backup";
import { WindowControls } from "../titlebar/WindowControls";
import s from "./CrashScreen.module.css";

type Status = "saving" | "saved" | "unsaved";

/** Writes what is pending; the number of notes still unsaved afterwards. */
async function saveEverything(): Promise<number> {
  try {
    await flushAll();
  } catch {
    // flushAll never rejects; kept safe all the same.
  }
  return unsavedNotes().length;
}

/** "Un problème est survenu": shown instead of the app after a rendering error. */
export function CrashScreen({ error }: { error: Error }) {
  const t = useT();
  const [status, setStatus] = useState<Status>("saving");
  const [unsaved, setUnsaved] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void saveEverything().then((n) => {
      if (!live) return;
      setUnsaved(n);
      setStatus(n ? "unsaved" : "saved");
    });
    return () => {
      live = false;
    };
  }, []);

  const reload = async () => {
    if (status === "saving") return;
    setStatus("saving");
    const n = await saveEverything();
    if (n) {
      setUnsaved(n);
      setStatus("unsaved");
      return;
    }
    location.reload();
  };

  const saveCopy = async () => {
    const copies = unsavedNotes().map((n) => ({
      stem: sanitizeStem(n.title, t.untitled),
      content: n.content,
    }));
    try {
      if (await saveCopies(copies, t.closeDialog.saveCopyTitle)) setNotice(t.crash.copySaved);
    } catch {
      setNotice(t.closeDialog.copyFailed);
    }
  };

  return (
    <div className={s.screen}>
      {/* No titlebar here: the window must still move and close. */}
      <div className={s.bar} data-tauri-drag-region>
        <WindowControls />
      </div>
      <main className={s.center}>
        <div className={s.card} role="alertdialog" aria-labelledby="crash-title" aria-describedby="crash-body">
          <TriangleAlert className={s.icon} aria-hidden />
          <h1 id="crash-title" className={s.title}>
            {t.crash.title}
          </h1>
          <p id="crash-body" className={s.body}>
            {t.crash.body}
          </p>
          <p className={s.status} role="status">
            {status === "saving" ? t.crash.saving : status === "saved" ? t.crash.saved : t.crash.unsaved(unsaved)}
          </p>
          {notice && (
            <p className={s.status} role="status">
              {notice}
            </p>
          )}
          <div className={s.actions}>
            {status === "unsaved" && (
              <>
                <Button variant="danger" onClick={() => void appWindow.destroy()}>
                  {t.crash.quit}
                </Button>
                <Button onClick={() => void saveCopy()}>{t.closeDialog.saveCopy}</Button>
              </>
            )}
            <Button variant="primary" autoFocus onClick={() => void reload()}>
              {status === "unsaved" ? t.crash.retryReload : t.crash.reload}
            </Button>
          </div>
          <details className={s.details}>
            <summary>{t.crash.details}</summary>
            <pre>{`${error.name}: ${error.message}`}</pre>
          </details>
        </div>
      </main>
    </div>
  );
}
