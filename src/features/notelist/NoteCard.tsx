import { forwardRef, memo, useMemo, type MouseEvent } from "react";
import { Archive, Pin, ScanText, SquareCheck } from "lucide-react";
import { useT } from "../../app/i18n";
import { formatRelative } from "../../core/dates";
import { firstImage } from "../../core/markdown/embeds";
import { assetsApi } from "../../services/assets";
import type { Note } from "../../core/note/note";
import type { SearchQuery } from "../../core/search/query";
import { highlights, snippet } from "../../core/search/search";
import s from "./NoteCard.module.css";

interface NoteCardProps {
  domId: string;
  note: Note;
  now: number;
  dateKind: "modified" | "created";
  /** Accessible label of the todo counter; null when the note has no todos. */
  todoLabel: string | null;
  selected: boolean;
  focusable: boolean;
  onSelect: () => void;
  onContextMenu: (e: MouseEvent) => void;
  /** Active search: excerpt around the match, occurrences highlighted [DESIGN §2.3]. */
  query: SearchQuery | null;
}

/** Text with `<mark>` on the given ranges. */
function Marked({
  text,
  ranges,
}: {
  text: string;
  ranges: Array<[number, number]>;
}) {
  if (!ranges.length) return <>{text}</>;
  const parts = [];
  let at = 0;
  for (const [from, to] of ranges) {
    if (from > at) parts.push(text.slice(at, from));
    parts.push(
      <mark key={from} className={s.mark}>
        {text.slice(from, to)}
      </mark>,
    );
    at = to;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

/** First image of the note, 64×64 cover [DESIGN §2.4]; hidden if it cannot be shown. */
function Thumb({ path }: { path: string }) {
  return (
    <img
      className={s.thumb}
      src={assetsApi.thumbUrl(path)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={(e) => {
        e.currentTarget.hidden = true;
      }}
    />
  );
}

/** Note card [DESIGN §2.4]: meta line, title, two-line plain-text preview, thumbnail of the first image. */
export const NoteCard = memo(
  forwardRef<HTMLDivElement, NoteCardProps>(function NoteCard(
    {
      domId,
      note,
      now,
      dateKind,
      todoLabel,
      selected,
      focusable,
      onSelect,
      onContextMenu,
      query,
    },
    ref,
  ) {
    const t = useT();
    const found = useMemo(() => {
      if (!query) return null;
      const excerpt = snippet(note, query);
      return {
        title: highlights(note.title, query),
        excerpt: excerpt ?? {
          text: note.preview,
          ranges: highlights(note.preview, query),
          source: null,
        },
      };
    }, [note, query]);
    const time = dateKind === "created" ? note.created : note.mtime;
    const image = useMemo(
      () => firstImage(note.path, note.body),
      [note.path, note.body],
    );
    return (
      <div
        ref={ref}
        id={domId}
        role="option"
        aria-selected={selected}
        tabIndex={focusable ? 0 : -1}
        className={[s.card, selected && s.selected].filter(Boolean).join(" ")}
        onClick={onSelect}
        onFocus={onSelect}
        onContextMenu={onContextMenu}
      >
        <div className={s.text}>
          <div className={s.meta}>
            {note.pinned && (
              <Pin className={s.metaIcon} aria-label={t.list.pinned} />
            )}
            <time dateTime={new Date(time).toISOString()}>
              {formatRelative(time, now, t.dates)}
            </time>
            {query && note.archived && (
              <span className={s.archived}>
                <Archive className={s.metaIcon} aria-hidden />
                {t.search.archived}
              </span>
            )}
            {todoLabel && note.syntax && (
              <span className={s.todos} aria-label={todoLabel}>
                <SquareCheck className={s.metaIcon} aria-hidden />
                {note.syntax.todos.done}/{note.syntax.todos.total}
              </span>
            )}
            {found?.excerpt.source && (
              <span className={s.foundIn}>
                <ScanText className={s.metaIcon} aria-hidden />
                {t.search.foundIn[found.excerpt.source] ?? found.excerpt.source}
              </span>
            )}
          </div>
          <div
            className={[s.title, !note.title && s.untitled]
              .filter(Boolean)
              .join(" ")}
          >
            {note.title ? (
              <Marked text={note.title} ranges={found?.title ?? []} />
            ) : (
              t.untitled
            )}
          </div>
          {found
            ? found.excerpt.text && (
                <div className={s.preview}>
                  <Marked
                    text={found.excerpt.text}
                    ranges={found.excerpt.ranges}
                  />
                </div>
              )
            : note.preview && <div className={s.preview}>{note.preview}</div>}
        </div>
        {image && <Thumb path={image} />}
      </div>
    );
  }),
);
