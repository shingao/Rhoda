import { forwardRef, memo, useMemo, type MouseEvent } from "react";
import { Archive, Pin, ScanText, SquareCheck, StickyNote } from "lucide-react";
import { useT } from "../../app/i18n";
import { formatRelative } from "../../core/dates";
import { firstImage } from "../../core/markdown/embeds";
import { assetsApi } from "../../services/assets";
import type { Note } from "../../core/note/note";
import type { SearchQuery } from "../../core/search/query";
import { highlights, snippet, type Snippet } from "../../core/search/search";
import { coverOn, isOcrImage } from "../../core/ocr";
import { ocrMatches } from "../../app/ocr";
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
  /** Bumped when OCR results arrive (they change excerpts). */
  textVersion: number;
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

/**
 * First image of the note, 64×64 cover [DESIGN §2.4]; hidden if it cannot be
 * shown. A match found by OCR shows that image, with the zone framed [§2.3].
 */
function Thumb({ path, zone }: { path: string; zone?: ReturnType<typeof coverOn> | null }) {
  const img = (
    <img
      className={s.thumb}
      // Framed on the zone: the whole image (the cached thumbnail is already cropped to its centre).
      src={zone ? assetsApi.url(path) : assetsApi.thumbUrl(path)}
      style={zone ? { objectPosition: `${zone.position.x}% ${zone.position.y}%` } : undefined}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={(e) => {
        e.currentTarget.hidden = true;
      }}
    />
  );
  if (!zone) return img;
  return (
    <span className={s.thumbFrame}>
      {img}
      <span className={s.zone} style={{ left: `${zone.box.x}%`, top: `${zone.box.y}%`, width: `${zone.box.w}%`, height: `${zone.box.h}%` }} />
    </span>
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
      textVersion,
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
      // textVersion: OCR results arrived since.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [note, query, textVersion]);
    const time = dateKind === "created" ? note.created : note.mtime;
    const image = useMemo(
      () => firstImage(note.path, note.body),
      [note.path, note.body],
    );
    const excerpt = found?.excerpt as Snippet | undefined;
    // Found in an image: that image, with the zone of the first match.
    const ocrImage = excerpt?.source === "ocr" && excerpt.file && isOcrImage(excerpt.file) ? excerpt.file : null;
    const zone = useMemo(() => {
      if (!ocrImage || !query) return null;
      const hit = ocrMatches(ocrImage, query.include.map((n) => n.text));
      return hit ? coverOn(hit.boxes[0]!, hit) : null;
      // textVersion: results arrived since.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ocrImage, query, textVersion]);
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
                {found.excerpt.source === "postit" ? (
                  <StickyNote className={s.metaIcon} aria-hidden />
                ) : (
                  <ScanText className={s.metaIcon} aria-hidden />
                )}
                {excerpt?.page ? t.search.foundInPage(excerpt.page) : (t.search.foundIn[found.excerpt.source] ?? found.excerpt.source)}
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
        {(ocrImage ?? image) && <Thumb path={(ocrImage ?? image)!} zone={zone} />}
      </div>
    );
  }),
);
