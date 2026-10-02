import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
import { useT } from "../../app/i18n";
import { noteIndex } from "../../app/noteIndex";
import { setFilter } from "../../app/notes";
import { useApp } from "../../app/store";
import { tagKey } from "../../core/markdown/extract";
import { TagIcon } from "../../components/TagIcon";
import { tagColor } from "../sidebar/tagColor";
import s from "./EditorPane.module.css";

/** First tag of the open note, as `icon root › child` (maquettes 04–09). Each segment filters the list. */
export function Breadcrumb() {
  const t = useT();
  const note = useApp((st) => (st.selectedId ? st.notes[st.selectedId] : undefined));
  const notes = useApp((st) => st.notes);
  const tagConfig = useApp((st) => st.tagConfig);
  const first = note?.syntax?.tags[0];
  if (!first) return null;

  const { tags } = noteIndex(notes);
  const names = first.name.split("/").filter(Boolean);
  // Spelling of the vault (first occurrence), keys for filtering.
  const segments = names.map((name, i) => {
    const key = tagKey(names.slice(0, i + 1).join("/"));
    return { key, label: tags.byKey.get(key)?.label ?? name, known: tags.byKey.has(key) };
  });
  const root = tagConfig[segments[0]!.key];

  return (
    <nav className={s.breadcrumb} aria-label={t.links.breadcrumb}>
      <TagIcon name={root?.icon} className={s.crumbIcon} style={{ color: tagColor(root?.color) }} />
      {segments.map((seg, i) => (
        <Fragment key={seg.key}>
          {i > 0 && <ChevronRight className={s.crumbChevron} aria-hidden />}
          <button
            type="button"
            className={[s.crumb, i === segments.length - 1 && s.crumbLast].filter(Boolean).join(" ")}
            disabled={!seg.known}
            aria-current={i === segments.length - 1 ? "location" : undefined}
            onClick={() => setFilter({ kind: "tag", key: seg.key })}
          >
            {seg.label}
          </button>
        </Fragment>
      ))}
    </nav>
  );
}
