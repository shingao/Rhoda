import { syntaxTree } from "@codemirror/language";
import { hoverTooltip, type Tooltip } from "@codemirror/view";
import { cssMs } from "../app/cssTokens";
import { currentMessages } from "../app/i18n";
import { editorHooks } from "./hooks";

/** Floating preview of the note behind a wiki link, after a short hover [DESIGN §3]. */
export function linkPreview() {
  return hoverTooltip(
    (view, pos, side): Tooltip | null => {
      for (let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(view.state).resolveInner(pos, side); node; node = node.parent) {
        if (node.name !== "WikiLink") continue;
        const target = node.getChild("WikiLinkTarget");
        if (!target) return null;
        const title = view.state.sliceDoc(target.from, target.to).split("#")[0]!.trim();
        const preview = editorHooks().linkPreview(title);
        if (!preview) return null;
        return {
          pos: node.from,
          end: node.to,
          above: false,
          create: () => {
            const dom = document.createElement("div");
            dom.className = "cm-link-preview";
            const h = document.createElement("div");
            h.className = "cm-link-preview-title";
            h.textContent = preview.title || currentMessages().untitled;
            const p = document.createElement("div");
            p.className = "cm-link-preview-text";
            p.textContent = preview.text;
            dom.append(h, p);
            return { dom };
          },
        };
      }
      return null;
    },
    { hoverTime: cssMs("--link-preview-delay") },
  );
}
