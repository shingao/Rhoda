import { useRef, useState } from "react";
import { useT } from "../../app/i18n";
import { prepareClose, unsavedNotes } from "../../app/notes";
import { setState, useApp } from "../../app/store";
import { sanitizeStem } from "../../core/note/filename";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import { appWindow } from "../../services/appWindow";
import { saveCopies } from "../../services/backup";
import s from "./CloseDialog.module.css";

/** Shown when the window is closing while some text could not be saved. */
export function CloseDialog() {
  const open = useApp((st) => st.closePrompt);
  const saveErrors = useApp((st) => st.saveErrors);
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // The safe action gets the focus: Enter must never discard text.
  const retryButton = useRef<HTMLButtonElement>(null);
  if (!open) return null;

  const notes = unsavedNotes();
  const kinds = [...new Set(notes.map((n) => saveErrors[n.id]).filter((k) => k !== undefined))];
  const reason = kinds.length === 1 ? t.closeDialog.reason(t.errors.reasons[kinds[0]!]) : null;
  const dismiss = () => {
    setNotice(null);
    setState({ closePrompt: false });
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t.closeDialog.title}
      subtitle={
        <>
          {t.closeDialog.subtitle(notes.length)} {reason}
        </>
      }
      closeLabel={t.modal.close}
      onClose={dismiss}
      initialFocus={retryButton}
      footer={
        <>
          <Button variant="danger" disabled={busy} onClick={() => void appWindow.destroy()}>
            {t.closeDialog.quit}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const copies = notes.map((n) => ({ stem: sanitizeStem(n.title, t.untitled), content: n.content }));
                try {
                  if (await saveCopies(copies, t.closeDialog.saveCopyTitle)) await appWindow.destroy();
                } catch {
                  setNotice(t.closeDialog.copyFailed);
                }
              })
            }
          >
            {t.closeDialog.saveCopy}
          </Button>
          <Button
            ref={retryButton}
            variant="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (await prepareClose()) await appWindow.destroy();
                else setNotice(t.closeDialog.stillFailing);
              })
            }
          >
            {t.closeDialog.retry}
          </Button>
        </>
      }
    >
      <ul className={s.notes}>
        {notes.map((n) => (
          <li key={n.id}>{n.title || t.untitled}</li>
        ))}
      </ul>
      {notice && (
        <p role="alert" className={s.notice}>
          {notice}
        </p>
      )}
    </Modal>
  );
}
