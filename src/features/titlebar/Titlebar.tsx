import { PanelLeft, Plus } from "lucide-react";
import { useT } from "../../app/i18n";
import { shortcutLabel } from "../../app/shortcuts";
import { useApp } from "../../app/store";
import { defaultWidth, toggleColumn } from "../../app/layout";
import { createNote } from "../../app/notes";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { Tooltip } from "../../components/Tooltip";
import { SearchField } from "./SearchField";
import { WindowControls } from "./WindowControls";
import s from "./Titlebar.module.css";

/** Custom titlebar [DESIGN §2.1]. Empty areas drag the window. */
export function Titlebar() {
  const collapsed = useApp((st) => st.settings.layout.sidebarCollapsed);
  const width = useApp((st) => st.settings.layout.sidebarWidth) ?? defaultWidth("sidebar");
  const resizing = useApp((st) => st.resizing);
  const focus = useApp((st) => st.focusMode);
  const t = useT();

  return (
    <header className={[s.titlebar, focus && s.focus].filter(Boolean).join(" ")} data-tauri-drag-region data-zone="titlebar">
      <div
        className={[s.left, s.chrome, resizing && s.noTransition].filter(Boolean).join(" ")}
        style={collapsed || focus ? undefined : { width }}
        data-tauri-drag-region
        inert={focus}
      >
        <IconButton
          icon={PanelLeft}
          tone="chrome"
          label={collapsed ? t.titlebar.showSidebar : t.titlebar.hideSidebar}
          shortcut={shortcutLabel("layout.toggleSidebar", t)}
          onClick={() => toggleColumn("sidebar")}
        />
        <span className={s.appName} data-tauri-drag-region>
          Ursa
        </span>
      </div>
      <div className={s.center} data-tauri-drag-region>
        <div className={s.chrome} inert={focus}>
          <SearchField />
        </div>
        {focus && (
          <span className={s.focusHint} data-tauri-drag-region>
            {t.info.exitHint(t.keys.Escape ?? "Esc")}
          </span>
        )}
      </div>
      <div className={s.right} data-tauri-drag-region>
        <div className={s.chrome} inert={focus}>
          <Tooltip label={t.titlebar.newNote} shortcut={shortcutLabel("note.new", t)}>
            <Button variant="primary" size="titlebar" icon={Plus} className={s.newNote} onClick={() => void createNote()}>
              {t.titlebar.newNote}
            </Button>
          </Tooltip>
        </div>
        <WindowControls />
      </div>
    </header>
  );
}
