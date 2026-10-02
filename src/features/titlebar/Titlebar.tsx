import { PanelLeft, Plus } from "lucide-react";
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

  return (
    <header className={s.titlebar} data-tauri-drag-region>
      <div
        className={[s.left, resizing && s.noTransition].filter(Boolean).join(" ")}
        style={collapsed ? undefined : { width }}
        data-tauri-drag-region
      >
        <IconButton
          icon={PanelLeft}
          tone="chrome"
          label={collapsed ? "Show sidebar" : "Hide sidebar"}
          shortcut="Ctrl \"
          onClick={() => toggleColumn("sidebar")}
        />
        <span className={s.appName} data-tauri-drag-region>
          Ursa
        </span>
      </div>
      <div className={s.center} data-tauri-drag-region>
        <SearchField />
      </div>
      <div className={s.right} data-tauri-drag-region>
        <Tooltip label="New note" shortcut="Ctrl N">
          <Button variant="primary" size="titlebar" icon={Plus} className={s.newNote} onClick={() => void createNote()}>
            New note
          </Button>
        </Tooltip>
        <WindowControls />
      </div>
    </header>
  );
}
