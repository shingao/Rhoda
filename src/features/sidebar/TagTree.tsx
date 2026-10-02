import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useT } from "../../app/i18n";
import type { TagSettings } from "../../app/store";
import type { TagNode } from "../../core/tags";
import { TagIcon } from "../../components/TagIcon";
import { tagColor } from "./tagColor";
import s from "./Sidebar.module.css";

interface TagTreeProps {
  roots: TagNode[];
  /** Nodes left out of the tree (pinned tags without sub-tags: shown as pills only). */
  hidden: (node: TagNode) => boolean;
  config: Record<string, TagSettings>;
  selectedKey: string | null;
  highlightedKey: string | null;
  renamingKey: string | null;
  onSelect: (node: TagNode) => void;
  onToggle: (node: TagNode) => void;
  onContextMenu: (node: TagNode, e: MouseEvent) => void;
  onRenameStart: (node: TagNode) => void;
  onRenameCommit: (node: TagNode, value: string) => void;
  onRenameCancel: () => void;
}

/** Nested, collapsible tag tree [DESIGN §2.5]; `tree` role with keyboard support. */
export function TagTree(props: TagTreeProps) {
  return (
    <ul className={s.tree} role="tree" aria-label={useT().sidebar.tags}>
      {props.roots.filter((n) => !props.hidden(n)).map((node) => (
        <TagRow key={node.key} node={node} {...props} />
      ))}
    </ul>
  );
}

function TagRow({ node, ...p }: TagTreeProps & { node: TagNode }) {
  const t = useT();
  const settings = p.config[node.key];
  const children = node.children.filter((c) => !p.hidden(c));
  const expanded = children.length > 0 && !settings?.collapsed;
  const selected = p.selectedKey === node.key;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "F2") p.onRenameStart(node);
    else if (e.key === "ArrowRight" && children.length && !expanded) p.onToggle(node);
    else if (e.key === "ArrowLeft" && expanded) p.onToggle(node);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <li role="treeitem" aria-level={node.depth + 1} aria-expanded={children.length ? expanded : undefined} aria-selected={selected}>
      {p.renamingKey === node.key ? (
        <RenameField node={node} onCommit={(v) => p.onRenameCommit(node, v)} onCancel={p.onRenameCancel} />
      ) : (
        <button
          type="button"
          data-nav-item
          data-tag-key={node.key}
          tabIndex={selected ? 0 : -1}
          className={[s.treeItem, node.depth > 0 && s.treeChild, selected && s.selected, p.highlightedKey === node.key && s.pickerOpen]
            .filter(Boolean)
            .join(" ")}
          style={{ ["--depth" as string]: node.depth }}
          onClick={() => p.onSelect(node)}
          onContextMenu={(e) => p.onContextMenu(node, e)}
          onKeyDown={onKeyDown}
        >
          <span
            className={s.chevron}
            aria-label={children.length ? (expanded ? t.sidebar.collapse : t.sidebar.expand) : undefined}
            onClick={(e) => {
              if (!children.length) return;
              e.stopPropagation();
              p.onToggle(node);
            }}
          >
            {children.length > 0 && (expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />)}
          </span>
          {node.depth === 0 && <TagIcon name={settings?.icon} className={s.treeIcon} style={{ color: tagColor(settings?.color) }} />}
          <span className={s.label}>{node.label}</span>
          <span className={s.treeCount} aria-label={t.sidebar.noteCount(node.noteIds.size)}>
            {node.noteIds.size}
          </span>
        </button>
      )}
      {expanded && (
        <ul role="group" className={s.tree}>
          {children.map((child) => (
            <TagRow key={child.key} node={child} {...p} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Inline rename [DESIGN §2.5]: Enter confirms (with a confirmation dialog), Escape cancels. */
function RenameField({ node, onCommit, onCancel }: { node: TagNode; onCommit: (v: string) => void; onCancel: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <input
      ref={input}
      className={s.renameField}
      defaultValue={node.path}
      aria-label={useT().tags.rename}
      style={{ ["--depth" as string]: node.depth }}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(e.currentTarget.value);
        else if (e.key === "Escape") onCancel();
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onBlur={onCancel}
    />
  );
}
