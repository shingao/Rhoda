import { useId, useRef } from "react";
import { ArchiveRestore, PenLine, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { useT } from "../../app/i18n";
import { setState, useApp, type SettingsPage } from "../../app/store";
import { Dialog } from "../../components/Dialog";
import { CloseButton } from "../../components/Modal";
import { BackupsPage } from "./BackupsPage";
import { EditorPage } from "./EditorPage";
import { GeneralPage } from "./GeneralPage";
import s from "./Settings.module.css";

const PAGES: ReadonlyArray<{ id: SettingsPage; icon: LucideIcon }> = [
  { id: "general", icon: SlidersHorizontal },
  { id: "editor", icon: PenLine },
  { id: "backups", icon: ArchiveRestore },
];

const close = () => setState({ settingsPage: null });

/** Settings [DESIGN §2.17, maquette 09]: every change applies at once, nothing to confirm. */
export function SettingsDialog() {
  const page = useApp((st) => st.settingsPage);
  if (!page) return null;
  return <SettingsContent page={page} />;
}

function SettingsContent({ page }: { page: SettingsPage }) {
  const t = useT();
  const headingId = useId();
  // Initial focus: the current page in the nav (arrows of the content start below it with Tab).
  const current = useRef<HTMLButtonElement>(null);
  return (
    <Dialog onClose={close} labelledBy={headingId} className={s.dialog} centered initialFocus={current}>
      <nav className={s.nav} aria-label={t.settings.title}>
        <div className={s.navTitle}>{t.settings.title}</div>
        {PAGES.map(({ id, icon: Icon }) => (
          <button
            key={id}
            ref={id === page ? current : undefined}
            type="button"
            className={s.navItem}
            aria-current={id === page ? "page" : undefined}
            onClick={() => setState({ settingsPage: id })}
          >
            <Icon className={s.navIcon} aria-hidden />
            {t.settings.pages[id]}
          </button>
        ))}
      </nav>
      <div className={s.content}>
        <header className={s.header}>
          <h2 id={headingId} className={s.heading}>
            {t.settings.headings[page]}
          </h2>
          <CloseButton label={t.settings.close} onClick={close} />
        </header>
        <div className={s.page}>
          {page === "general" && <GeneralPage />}
          {page === "editor" && <EditorPage />}
          {page === "backups" && <BackupsPage />}
        </div>
      </div>
    </Dialog>
  );
}
