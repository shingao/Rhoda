import type { ReactNode } from "react";
import { clampWidth, defaultWidth, setColumnWidth } from "../../app/layout";
import { setState, useApp } from "../../app/store";
import { Resizer } from "../../components/Resizer";
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
    <div className={[s.app, resizing && s.resizing].filter(Boolean).join(" ")}>
      <Titlebar />
      <div className={s.body}>
        <Column collapsed={layout.sidebarCollapsed} width={sidebarWidth}>
          <Sidebar />
        </Column>
        {!layout.sidebarCollapsed && <Resizer label="Resize sidebar" {...resizerProps("sidebar", sidebarWidth)} />}
        <div className={s.sheet}>
          <Column collapsed={layout.listCollapsed} width={listWidth}>
            <NoteList />
          </Column>
          {!layout.listCollapsed && <Resizer label="Resize note list" {...resizerProps("list", listWidth)} />}
          <div className={s.editor}>
            <EditorPane />
          </div>
        </div>
      </div>
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
