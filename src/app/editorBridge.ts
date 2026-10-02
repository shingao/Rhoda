import { titleKey } from "../core/markdown/extract";
import { snippetAround } from "../core/note/text";
import { setEditorHooks, type Backlink } from "../editor/hooks";
import { focusEditor, refreshEditor } from "../editor/session";
import { confirmAction } from "./confirm";
import { currentMessages } from "./i18n";
import { noteIndex, resolveTitle } from "./noteIndex";
import { createNote, revealNote, setFilter } from "./notes";
import { getState, useApp } from "./store";

function resolve(target: string): string | null {
  const { notes } = getState();
  return resolveTitle(noteIndex(notes).titles, notes, target);
}

function backlinksOf(id: string | null): Backlink[] {
  if (!id) return [];
  const { notes } = getState();
  const seen = new Set<string>();
  const out: Backlink[] = [];
  for (const { sourceId, link } of noteIndex(notes).backlinks.get(id) ?? []) {
    const source = notes[sourceId];
    if (!source || seen.has(sourceId)) continue;
    seen.add(sourceId);
    out.push({ id: sourceId, title: source.title, snippet: snippetAround(source.body, link.from, link.to) });
  }
  return out.sort((a, b) => (notes[b.id]?.mtime ?? 0) - (notes[a.id]?.mtime ?? 0));
}

/** What the editor shows from other notes; a change triggers a redraw. */
function signature(): string {
  const { notes, selectedId } = getState();
  const titles = [...noteIndex(notes).titles.keys()].join("\n");
  const links = backlinksOf(selectedId)
    .map((b) => `${b.id}\t${b.title}\t${b.snippet}`)
    .join("\n");
  return `${titles}\u0000${links}`;
}

/** Connects the editor to the notes: link resolution, navigation, completion, backlinks. */
export function connectEditor(): void {
  setEditorHooks({
    linkExists: (target) => resolve(target) !== null,
    openWikiLink: (target) => {
      const id = resolve(target);
      if (id) {
        revealNote(id);
        return;
      }
      const t = currentMessages();
      void confirmAction({ title: t.links.createTitle(target), body: t.links.createBody, confirmLabel: t.links.createConfirm }).then((ok) => {
        if (ok) return createNote(target);
        focusEditor();
      });
    },
    openTag: (key) => {
      if (noteIndex(getState().notes).tags.byKey.has(key)) setFilter({ kind: "tag", key });
    },
    openNote: revealNote,
    completions: () => {
      const { notes, selectedId } = getState();
      const index = noteIndex(notes);
      const current = selectedId ? notes[selectedId] : undefined;
      const titles = [...index.titles.values()]
        .map((ids) => notes[ids[0]!]!.title)
        .filter((title) => !current || titleKey(title) !== titleKey(current.title));
      return { tags: [...index.tags.byKey.values()].map((n) => n.path), titles };
    },
    backlinks: () => backlinksOf(getState().selectedId),
    linkPreview: (target) => {
      const id = resolve(target);
      const note = id ? getState().notes[id] : undefined;
      return note ? { title: note.title, text: note.preview } : null;
    },
  });

  let last = signature();
  let frame = 0;
  useApp.subscribe((state, previous) => {
    if (state.notes === previous.notes && state.selectedId === previous.selectedId) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const next = signature();
      if (next === last) return;
      last = next;
      refreshEditor();
    });
  });
}
