import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { openDrawingVersion } from "../../app/drawings";
import { useT } from "../../app/i18n";
import { setState, useApp } from "../../app/store";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import { drawingsApi, type DrawingVersion } from "../../services/drawings";
import s from "./DrawingVersions.module.css";

/**
 * "Previous versions…" of a drawing (decision P12-10): the 5 scenes kept
 * before each save of a modified drawing, newest first. Opening one shows it
 * in the drawing editor; saving there makes it current (the current one is
 * kept in turn).
 */
export function DrawingVersions() {
  const target = useApp((st) => st.drawingVersions);
  return target ? <List key={target.id} id={target.id} noteId={target.noteId} /> : null;
}

function List({ id, noteId }: { id: string; noteId: string }) {
  const t = useT();
  const [versions, setVersions] = useState<DrawingVersion[] | null>(null);
  useEffect(() => {
    drawingsApi
      .versions(id)
      .then(setVersions)
      .catch((e: unknown) => {
        console.warn("[ursa] drawing versions not listed", id, e);
        setVersions([]);
      });
  }, [id]);
  const date = new Intl.DateTimeFormat(t.dates.locale, { dateStyle: "medium", timeStyle: "short" });
  const close = () => setState({ drawingVersions: null });

  return (
    <Modal
      title={t.drawings.versionsTitle}
      subtitle={t.drawings.versionsHint}
      closeLabel={t.modal.close}
      onClose={close}
      footer={<Button onClick={close}>{t.modal.close}</Button>}
    >
      {versions && versions.length === 0 && <p className={s.empty}>{t.drawings.versionsNone}</p>}
      {versions && versions.length > 0 && (
        <ul className={s.list}>
          {versions.map((v) => {
            const when = date.format(v.savedAt);
            return (
              <li key={v.name} className={s.item}>
                <History className={s.icon} aria-hidden />
                <span className={s.when}>{t.drawings.versionReplaced(when)}</span>
                <Button
                  size="small"
                  aria-label={t.drawings.versionOpenLabel(when)}
                  onClick={() => {
                    // From the drawing editor, its changes were asked about before this list opened.
                    void openDrawingVersion(id, noteId, v.name, v.savedAt);
                  }}
                >
                  {t.drawings.versionOpen}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
