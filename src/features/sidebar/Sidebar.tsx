import { lazy, Suspense, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Pencil, Pin, PinOff, ScanText, Shapes, Share, Trash2 } from "lucide-react";
import { confirmAction } from "../../app/confirm";
import { useT } from "../../app/i18n";
import { noteIndex } from "../../app/noteIndex";
import { BackupFailedError, setFilter, undoAction, type BulkResult } from "../../app/notes";
import { SECTIONS, UNCOUNTED, sectionCounts } from "../../app/sections";
import { showToast, useApp } from "../../app/store";
import { deleteTag, noteIdsWithTag, notesWithTag, renameTag, updateTagSettings } from "../../app/tagOps";
import { openExport } from "../../app/export";
import { useNow } from "../../app/useNow";
import { tagKey } from "../../core/markdown/extract";
import { cleanTagName, formatTag, type TagNode } from "../../core/tags";
import { Menu, type MenuEntry } from "../../components/Menu";
import { TagIcon } from "../../components/TagIcon";
import { tagColor } from "./tagColor";
import { TagTree } from "./TagTree";
import { SECTION_ICONS } from "./sectionIcons";
import s from "./Sidebar.module.css";

const IconPicker = lazy(() => import("./IconPicker"));

type Point = { x: number; y: number };

/** Sidebar [DESIGN §2.2, §2.5]: sections, pinned tags, tag tree. */
export function Sidebar() {
  const notes = useApp((st) => st.notes);
  const filter = useApp((st) => st.filter);
  const tagConfig = useApp((st) => st.tagConfig);
  const ocrRemaining = useApp((st) => (st.settings.ocr.enabled ? st.ocr.remaining : 0));
  const t = useT();
  const now = useNow();
  const counts = useMemo(() => sectionCounts(Object.values(notes), now), [notes, now]);
  const { tags } = noteIndex(notes);
  const navRef = useRef<HTMLElement>(null);
  const [menu, setMenu] = useState<{ node: TagNode; at: Point } | null>(null);
  const [picker, setPicker] = useState<{ node: TagNode; anchor: DOMRect } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const pinned = [...tags.byKey.values()].filter((n) => tagConfig[n.key]?.pinned);
  const isSelected = (key: string) => filter.kind === "tag" && filter.key === key;

  const openMenu = (node: TagNode, e: MouseEvent) => {
    e.preventDefault();
    setMenu({ node, at: { x: e.clientX, y: e.clientY } });
  };

  const commitRename = async (node: TagNode, input: string) => {
    setRenaming(null);
    const name = cleanTagName(input);
    if (!name || tagKey(name) === node.key) return;
    const ok = await confirmAction({
      title: t.tags.renameTitle(formatTag(node.path)),
      body: `${t.tags.renameBody(notesWithTag(node.key))} ${t.tags.renameTo(formatTag(name))}`,
      confirmLabel: t.tags.renameConfirm,
    });
    if (ok) await reportBulk(renameTag(node.key, name));
  };

  /** Toast with "Annuler" after a bulk change, or why nothing was done. */
  const reportBulk = async (operation: Promise<BulkResult>) => {
    try {
      const { count, backup } = await operation;
      showToast(t.tags.renamed(count), backup ? undoAction(backup) : undefined);
    } catch (e) {
      if (!(e instanceof BackupFailedError)) throw e;
      showToast(t.undo.backupFailed);
    }
  };

  const removeTag = async (node: TagNode) => {
    const ok = await confirmAction({
      title: t.tags.removeTitle(formatTag(node.path)),
      body: t.tags.removeBody(notesWithTag(node.key)),
      confirmLabel: t.tags.removeConfirm,
      danger: true,
    });
    if (ok) await reportBulk(deleteTag(node.key));
  };

  const menuEntries = (node: TagNode): MenuEntry[] => {
    const isPinned = tagConfig[node.key]?.pinned === true;
    return [
      {
        id: "icon",
        label: t.tags.changeIcon,
        icon: Shapes,
        onSelect: () => {
          const row = document.querySelector<HTMLElement>(`nav [data-tag-key="${CSS.escape(node.key)}"]`);
          if (row) setPicker({ node, anchor: row.getBoundingClientRect() });
        },
      },
      {
        id: "pin",
        label: isPinned ? t.tags.unpin : t.tags.pin,
        icon: isPinned ? PinOff : Pin,
        onSelect: () => updateTagSettings(node.key, { pinned: !isPinned }),
      },
      { id: "rename", label: t.tags.rename, icon: Pencil, shortcut: "F2", onSelect: () => setRenaming(node.key) },
      {
        id: "export",
        label: t.exportDialog.menuTag,
        icon: Share,
        onSelect: () => {
          const ids = noteIdsWithTag(node.key);
          if (ids.length) openExport(ids, `${formatTag(node.path)} · ${t.exportDialog.notes(ids.length)}`);
        },
      },
      { kind: "separator", id: "sep" },
      { id: "delete", label: t.tags.remove, icon: Trash2, danger: true, onSelect: () => void removeTag(node) },
    ];
  };

  /** One tab stop for the sidebar, then arrows between items [DESIGN §5]. */
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...(navRef.current?.querySelectorAll<HTMLElement>("[data-nav-item]") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = items[index + (e.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      next.focus();
      e.preventDefault();
    }
  };

  return (
    <nav ref={navRef} className={s.sidebar} aria-label={t.sidebar.label} onKeyDown={onKeyDown}>
      <ul className={s.items}>
        {SECTIONS.map((id) => {
          const Icon = SECTION_ICONS[id];
          const selected = filter.kind === "section" && filter.section === id;
          return (
            <li key={id}>
              <button
                type="button"
                data-nav-item
                tabIndex={selected ? 0 : -1}
                className={[s.item, selected && s.selected].filter(Boolean).join(" ")}
                aria-current={selected ? "page" : undefined}
                onClick={() => setFilter({ kind: "section", section: id })}
              >
                <Icon className={s.icon} aria-hidden />
                <span className={s.label}>{t.sidebar.sections[id]}</span>
                {!UNCOUNTED.has(id) && <span className={s.count}>{counts[id]}</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {pinned.length > 0 && (
        <div className={s.pinned} role="group" aria-label={t.sidebar.pinnedTags}>
          {pinned.map((node) => (
            <button
              key={node.key}
              type="button"
              data-nav-item
              data-tag-key={node.key}
              tabIndex={isSelected(node.key) ? 0 : -1}
              className={[s.pill, isSelected(node.key) && s.pillSelected, picker?.node.key === node.key && s.pickerOpen].filter(Boolean).join(" ")}
              onClick={() => setFilter({ kind: "tag", key: node.key })}
              onContextMenu={(e) => openMenu(node, e)}
              title={t.sidebar.noteCount(node.noteIds.size)}
            >
              <TagIcon name={tagConfig[node.key]?.icon} className={s.pillIcon} style={{ color: tagColor(tagConfig[node.key]?.color) }} />
              {node.label}
            </button>
          ))}
        </div>
      )}

      {tags.roots.length > 0 && (
        <>
          <h3 className={s.heading}>{t.sidebar.tags}</h3>
          <TagTree
            roots={tags.roots}
            hidden={(node) => tagConfig[node.key]?.pinned === true && node.children.length === 0}
            config={tagConfig}
            selectedKey={filter.kind === "tag" ? filter.key : null}
            highlightedKey={picker?.node.key ?? null}
            renamingKey={renaming}
            onSelect={(node) => setFilter({ kind: "tag", key: node.key })}
            onToggle={(node) => updateTagSettings(node.key, { collapsed: !tagConfig[node.key]?.collapsed })}
            onContextMenu={openMenu}
            onRenameStart={(node) => setRenaming(node.key)}
            onRenameCommit={(node, value) => void commitRename(node, value)}
            onRenameCancel={() => setRenaming(null)}
          />
        </>
      )}

      {ocrRemaining > 0 && (
        // Discreet progress of the background text reading (phase 9).
        <div className={s.ocr} role="status">
          <ScanText className={s.ocrIcon} aria-hidden />
          {t.ocr.remaining(ocrRemaining)}
        </div>
      )}
      {menu && <Menu at={menu.at} label={formatTag(menu.node.path)} entries={menuEntries(menu.node)} onClose={() => setMenu(null)} />}
      {picker && (
        <Suspense fallback={null}>
          <IconPicker
            node={picker.node}
            anchor={picker.anchor}
            settings={tagConfig[picker.node.key] ?? {}}
            onChange={(patch) => updateTagSettings(picker.node.key, patch)}
            onClose={() => setPicker(null)}
          />
        </Suspense>
      )}
    </nav>
  );
}
