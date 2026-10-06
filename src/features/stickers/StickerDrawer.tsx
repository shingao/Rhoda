import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ImagePlus, Plus, Search, X } from "lucide-react";
import { useT } from "../../app/i18n";
import { shortcutLabel } from "../../app/shortcuts";
import { builtinAsset, importStickerImages, placeFromDrawer, stickerUrl, toggleStickerDrawer, type DrawerItem } from "../../app/stickers";
import { useApp } from "../../app/store";
import { IconButton } from "../../components/IconButton";
import { POSTIT_COLORS, STICKER_SIZE } from "../../core/stickers";
import { fold } from "../../core/search/fold";
import { CATALOG, type StickerCategory } from "./catalog";
import s from "./StickerDrawer.module.css";

type Chip = "recent" | StickerCategory | "mine";
const CHIPS: readonly Chip[] = ["recent", "nature", "food", "travel", "objects", "mine"];

interface Cell {
  asset: string;
  label: string;
}

/** Pixels before a press on a cell becomes a drag (a click places at the centre). */
const DRAG_THRESHOLD = 4;

const fileLabel = (path: string) => path.split("/").pop()!.replace(/\.[^.]+$/, "");

/**
 * Sticker drawer [DESIGN §10]: floating on the right of the note, categories,
 * search, post-its, import. A cell is placed by a click (middle of the visible
 * note) or dragged onto the note (ghost at 70 %).
 */
export function StickerDrawer() {
  const open = useApp((st) => st.stickerDrawer);
  // Kept mounted while it fades out after closing.
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  if (!shown) return null;
  return <DrawerPanel leaving={!open} onLeft={() => setShown(false)} />;
}

function DrawerPanel({ leaving, onLeft }: { leaving: boolean; onLeft: () => void }) {
  const t = useT();
  const language = useApp((st) => st.settings.language);
  const recent = useApp((st) => st.settings.stickers.recent);
  const library = useApp((st) => st.stickerLibrary);
  const [chip, setChip] = useState<Chip>(() => (recent.length ? "recent" : "nature"));
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => search.current?.focus(), []);

  const catalog = useMemo(
    () =>
      CATALOG.map((e) => {
        const words = language === "fr" ? e.fr : e.en;
        return { ...e, asset: builtinAsset(e.id), label: words.split(",")[0]!, haystack: fold(`${e.fr}, ${e.en}`) };
      }),
    [language],
  );

  const cells = useMemo((): { title: string; cells: Cell[]; empty?: string } => {
    const mine = library.map((path) => ({ asset: path, label: fileLabel(path), haystack: fold(fileLabel(path)) }));
    const needle = fold(query.trim());
    if (needle) {
      const found = [...catalog, ...mine].filter((c) => needle.split(/\s+/).every((w) => c.haystack.includes(w)));
      return { title: t.stickers.results, cells: found, empty: t.stickers.noResults };
    }
    if (chip === "mine") return { title: t.stickers.categories.mine, cells: mine, empty: t.stickers.emptyMine };
    if (chip === "recent") {
      const known = new Map<string, Cell>([...catalog, ...mine].map((c) => [c.asset, c]));
      // Imported stickers of another vault are left out.
      const cells = recent.flatMap((asset) => known.get(asset) ?? []);
      return { title: t.stickers.categories.recent, cells, empty: t.stickers.emptyRecent };
    }
    return { title: t.stickers.categories[chip], cells: catalog.filter((c) => c.category === chip) };
  }, [catalog, library, recent, chip, query, t]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      toggleStickerDrawer(false);
    }
  };

  return (
    <aside
      className={[s.drawer, leaving && s.leaving].filter(Boolean).join(" ")}
      aria-label={t.stickers.drawer}
      onKeyDown={onKeyDown}
      onAnimationEnd={(e) => leaving && e.target === e.currentTarget && onLeft()}
    >
      <header className={s.head}>
        <h2 className={s.title}>{t.stickers.drawer}</h2>
        <IconButton icon={X} label={t.stickers.close} shortcut={shortcutLabel("stickers.drawer", t)} className={s.close} onClick={() => toggleStickerDrawer(false)} />
      </header>
      <div className={s.searchRow}>
        <label className={s.search}>
          <Search className={s.searchIcon} aria-hidden />
          <input
            ref={search}
            type="search"
            value={query}
            placeholder={t.stickers.search}
            aria-label={t.stickers.search}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className={s.chips} role="tablist" aria-label={t.stickers.drawer}>
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={!query && chip === c}
            className={[s.chip, !query && chip === c && s.chipOn].filter(Boolean).join(" ")}
            onClick={() => {
              setChip(c);
              setQuery("");
            }}
          >
            {t.stickers.categories[c]}
          </button>
        ))}
      </div>
      <div className={s.scroll}>
        <div className={s.section}>{cells.title}</div>
        {cells.cells.length ? (
          <div className={s.grid}>
            {cells.cells.map((c) => (
              <DrawerCell key={c.asset} item={{ kind: "sticker", asset: c.asset }} label={c.label} url={stickerUrl(c.asset)} />
            ))}
          </div>
        ) : (
          <p className={s.empty}>{cells.empty}</p>
        )}
        <div className={[s.section, s.postitSection].join(" ")}>{t.stickers.postits}</div>
        <div className={s.postits}>
          {POSTIT_COLORS.map((color) => (
            <DrawerCell key={color} item={{ kind: "postit", color }} label={t.stickers.addPostit(t.stickers.colors[color])} url={null} />
          ))}
        </div>
      </div>
      <footer className={s.foot}>
        <button type="button" className={s.importButton} onClick={() => void importStickerImages().then((paths) => paths.length && setChip("mine"))}>
          <ImagePlus className={s.importIcon} aria-hidden />
          {t.stickers.importImage}
        </button>
        <p className={s.hint}>{t.stickers.importHint}</p>
      </footer>
    </aside>
  );
}

/** A sticker or post-it square: click = place in the middle of the note, drag = place where dropped. */
function DrawerCell({ item, label, url }: { item: DrawerItem; label: string; url: string | null }) {
  const press = useRef<{ x: number; y: number; ghost: HTMLElement | null } | null>(null);
  /** The click that follows a drag is not a placement. */
  const dragged = useRef(false);

  const ghostFor = (target: HTMLElement): HTMLElement => {
    const size = item.kind === "postit" ? target.offsetWidth : STICKER_SIZE.default;
    const ghost = (item.kind === "sticker" ? target.querySelector("img")! : target).cloneNode(true) as HTMLElement;
    ghost.className = [ghost.className, s.ghost].join(" ");
    ghost.style.width = `${size}px`;
    ghost.style.height = `${size}px`;
    document.body.appendChild(ghost);
    return ghost;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    press.current = { x: e.clientX, y: e.clientY, ghost: null };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p) return;
    if (!p.ghost && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
    p.ghost ??= ghostFor(e.currentTarget);
    p.ghost.style.left = `${e.clientX - p.ghost.offsetWidth / 2}px`;
    p.ghost.style.top = `${e.clientY - p.ghost.offsetHeight / 2}px`;
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    press.current = null;
    dragged.current = Boolean(p?.ghost);
    if (!p?.ghost) return;
    p.ghost.remove();
    // Dropped on the note (not back on the drawer): placed there.
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (target?.closest(".cm-scroller") && !target.closest("aside")) placeFromDrawer(item, { x: e.clientX, y: e.clientY });
  };

  return (
    <button
      type="button"
      className={item.kind === "postit" ? s.postit : s.cell}
      data-color={item.kind === "postit" ? item.color : undefined}
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        press.current?.ghost?.remove();
        press.current = null;
      }}
      onClick={() => {
        if (!dragged.current) placeFromDrawer(item);
        dragged.current = false;
      }}
    >
      {item.kind === "sticker" ? <img src={url ?? undefined} alt="" draggable={false} className={s.cellImg} /> : <Plus className={s.postitIcon} aria-hidden />}
    </button>
  );
}
