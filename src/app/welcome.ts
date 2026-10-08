import { stringify } from "yaml";
import { joinFrontmatter } from "../core/note/frontmatter";
import { isoLocal } from "../core/dates";
import { uuidv7 } from "../core/id";
import { blockKey, blocksOf, serializeStickers, stickerId, type Sticker } from "../core/stickers";
import { currentMessages } from "./i18n";
import { addNote, selectNote } from "./notes";
import { shortcutLabel } from "./shortcuts";
import { getState, updateSettings } from "./store";

/** The text of the welcome note, with the current shortcuts. */
export function welcomeContent(now = Date.now()): { title: string; content: string } {
  const t = currentMessages();
  const key = (id: Parameters<typeof shortcutLabel>[0]) => shortcutLabel(id, t);
  const body = t.welcome.body({
    newNote: key("note.new"),
    palette: key("palette.open"),
    search: key("search.focus"),
    find: key("find.open"),
    task: key("task.toggle"),
    stickers: key("stickers.drawer"),
    focus: key("focus.toggle"),
    export: key("export.open"),
    settings: key("settings.open"),
  });
  const blocks = blocksOf(body.split("\n"));
  const heading = (n: number) => blocks.findIndex((b, i) => b.type === "heading" && blocks.slice(0, i + 1).filter((x) => x.type === "heading").length === n);
  // `dx` in % of the text column: beside the title, and in the right margin of "backgrounds and stickers".
  const stickers: Sticker[] = [
    { id: stickerId(), kind: "sticker", asset: "fluent/sparkles", anchor: blockKey(blocks, 0), dx: 72, dy: -10, rotation: 6, size: 72, z: 0 },
    { id: stickerId(), kind: "postit", text: t.welcome.postit, color: "yellow", anchor: blockKey(blocks, heading(5)), dx: 102, dy: 0, rotation: -2, size: 168, z: 1 },
  ];
  const frontmatter = stringify({ id: uuidv7(now), created: isoLocal(now), paper: "lined", stickers: serializeStickers(stickers) });
  return { title: t.welcome.title, content: joinFrontmatter(frontmatter, body) };
}

/** Very first launch: a note that presents the app, deletable like any other. */
export async function welcomeOnFirstLaunch(): Promise<void> {
  if (getState().settings.welcomed) return;
  updateSettings((s) => ({ ...s, welcomed: true }));
  const { title, content } = welcomeContent();
  if (Object.values(getState().notes).some((n) => n.title === title)) return;
  try {
    const note = await addNote(title, content);
    selectNote(note.id);
  } catch (e) {
    console.warn("[ursa] the welcome note could not be created", e);
  }
}
