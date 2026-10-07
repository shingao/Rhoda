import type { ReactNode } from "react";
import { useT } from "../../app/i18n";
import { clampWidth, defaultWidth, setColumnWidth } from "../../app/layout";
import { setState, useApp } from "../../app/store";
import { ConfirmHost } from "../../components/ConfirmHost";
import { Resizer } from "../../components/Resizer";
import { Toast } from "../../components/Toast";
import { CloseDialog } from "../close/CloseDialog";
import { SettingsDialog } from "../settings/SettingsDialog";
import { CropDialog } from "../editor/CropDialog";
import { ExportDialog } from "../export/ExportDialog";
import { CommandPalette } from "../palette/CommandPalette";
import { CardMenu } from "../editor/CardMenu";
import { StickerMenu } from "../stickers/StickerMenu";
import { OcrText } from "../editor/OcrText";
import { EditorPane } from "../editor/EditorPane";
import { NoteList } from "../notelist/NoteList";
import { Sidebar } from "../sidebar/Sidebar";
import { Titlebar } from "../titlebar/Titlebar";
import s from "./AppLayout.module.css";

type Column = "sidebar" | "list";

/** Titlebar over three columns: sidebar on the app background, list + editor on a raised "sheet" [DESIGN 1b « Atelier »]. */
export function AppLayout() {
  const layout = useApp((st) => st.settings.layout);
  const resizing = useApp((st) => st.resizing);
  const focus = useApp((st) => st.focusMode);
  const t = useT();
  const sidebarWidth = layout.sidebarWidth ?? defaultWidth("sidebar");
  const listWidth = layout.listWidth ?? defaultWidth("list");

  const resizerProps = (column: Column, width: number) => ({
    width,
    onResizeStart: () => setState({ resizing: true }),
    onResize: (next: number) => setColumnWidth(column, clampWidth(column, next)),
    onResizeEnd: () => setState({ resizing: false }),
    onReset: () => setColumnWidth(column, null),
  });

  return (
    <div className={[s.app, resizing && s.resizing, focus && s.focus].filter(Boolean).join(" ")}>
      <Titlebar />
      <div className={s.body}>
        <Column collapsed={layout.sidebarCollapsed || focus} width={sidebarWidth}>
          <Sidebar />
        </Column>
        {!layout.sidebarCollapsed && !focus && <Resizer label={t.layout.resizeSidebar} {...resizerProps("sidebar", sidebarWidth)} />}
        <div className={s.sheet}>
          <Column collapsed={layout.listCollapsed || focus} width={listWidth}>
            <NoteList />
          </Column>
          {!layout.listCollapsed && !focus && <Resizer label={t.layout.resizeList} {...resizerProps("list", listWidth)} />}
          <div className={s.editor}>
            <EditorPane />
          </div>
        </div>
      </div>
      <SettingsDialog />
      <CropDialog />
      <ExportDialog />
      <CommandPalette />
      <CardMenu />
      <StickerMenu />
      <OcrText />
      <CloseDialog />
      <ConfirmHost />
      <Toast />
    </div>
  );
}

/** Collapsible column: the outer box animates its width, the inner one keeps its size so content never reflows mid-animation. */
function Column({ collapsed, width, children }: { collapsed: boolean; width: number; children: ReactNode }) {
  return (
    <div className={s.column} style={{ width: collapsed ? 0 : width }} aria-hidden={collapsed || undefined} inert={collapsed}>
      <div className={s.columnInner} style={{ width }}>
        {children}
      </div>
    </div>
  );
}
