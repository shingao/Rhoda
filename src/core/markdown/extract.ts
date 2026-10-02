import type { SyntaxNode } from "@lezer/common";
import { isInHeading, ursaParser } from "./syntax";

/** A `#tag` occurrence. `name` is written as in the note, without the `#` marks. */
export interface TagRef {
  name: string;
  from: number;
  to: number;
  /** True for the `#several words#` form. */
  multiWord: boolean;
}

/** A `[[target#anchor|alias]]` occurrence with the ranges needed to rewrite it. */
export interface WikiLinkRef {
  target: string;
  anchor: string | null;
  alias: string | null;
  from: number;
  to: number;
  /** Range of the title part only (before `#anchor` and `|alias`). */
  titleFrom: number;
  titleTo: number;
}

export interface NoteSyntax {
  tags: TagRef[];
  links: WikiLinkRef[];
  todos: { done: number; total: number };
}

/** Case- and accent-form-insensitive key of a tag path: `#Voyages/Japon` ≡ `#voyages/japon`. */
export function tagKey(name: string): string {
  return name.normalize("NFC").toLocaleLowerCase("fr");
}

/** Key used to match a wiki link to a note title. */
export function titleKey(title: string): string {
  return title.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
}

/** Everything the index needs from a note body, read with the shared grammar. */
export function extractSyntax(body: string): NoteSyntax {
  const tags: TagRef[] = [];
  const links: WikiLinkRef[] = [];
  const todos = { done: 0, total: 0 };
  ursaParser.parse(body).iterate({
    enter(ref) {
      switch (ref.name) {
        case "Tag": {
          if (isInHeading(ref.node)) return false;
          const raw = body.slice(ref.from, ref.to);
          const multiWord = raw.length > 2 && raw.endsWith("#");
          tags.push({ name: multiWord ? raw.slice(1, -1) : raw.slice(1), from: ref.from, to: ref.to, multiWord });
          return false;
        }
        case "WikiLink": {
          const link = readWikiLink(ref.node, body);
          if (link) links.push(link);
          return false;
        }
        case "TaskMarker":
          todos.total++;
          if (/x/i.test(body.slice(ref.from, ref.to))) todos.done++;
          return false;
        default:
          return true;
      }
    },
  });
  return { tags, links, todos };
}

function readWikiLink(node: SyntaxNode, body: string): WikiLinkRef | null {
  const target = node.getChild("WikiLinkTarget");
  if (!target) return null;
  const alias = node.getChild("WikiLinkAlias");
  const text = body.slice(target.from, target.to);
  const hash = text.indexOf("#");
  const title = (hash < 0 ? text : text.slice(0, hash)).trimEnd();
  return {
    target: title.trim(),
    anchor: hash < 0 ? null : text.slice(hash + 1).trim() || null,
    alias: alias ? body.slice(alias.from, alias.to) : null,
    from: node.from,
    to: node.to,
    titleFrom: target.from + (text.length - text.trimStart().length),
    titleTo: target.from + title.length,
  };
}
