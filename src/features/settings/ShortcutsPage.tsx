import { useState, type KeyboardEvent } from "react";
import { RotateCcw, X } from "lucide-react";
import { confirmAction } from "../../app/confirm";
import { useT } from "../../app/i18n";
import {
  checkShortcut,
  chordLabels,
  defaultChord,
  isCustomized,
  resetAllShortcuts,
  resetShortcut,
  setShortcut,
  shortcutKeys,
  type ShortcutCheck,
  type ShortcutId,
} from "../../app/shortcuts";
import { setState } from "../../app/store";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { Kbd } from "../../components/Kbd";
import { chordFromEvent, type KeyChord } from "../../core/keys";
import s from "./Settings.module.css";

/** Settings › Shortcuts, by theme (decision P10-8). */
const GROUPS: ReadonlyArray<{ id: "general" | "view" | "editor" | "list"; ids: readonly ShortcutId[] }> = [
  { id: "general", ids: ["palette.open", "note.new", "search.focus", "export.open", "settings.open", "zone.next", "zone.previous"] },
  { id: "view", ids: ["layout.toggleSidebar", "layout.toggleList", "outline.toggle", "focus.toggle", "focus.toggleKey", "stickers.drawer", "stickers.hide"] },
  { id: "editor", ids: ["find.open", "find.replace", "task.toggle", "fold.section", "unfold.section", "fold.all", "unfold.all", "section.isolate"] },
  { id: "list", ids: ["note.trash", "find.next", "find.previous"] },
];

/** A combination waiting for an answer: replace another shortcut, or a standard editing one. */
interface Pending {
  id: ShortcutId;
  chord: KeyChord;
  check: Extract<ShortcutCheck, { kind: "conflict" | "standard" }>;
}

const recording = (on: boolean) => setState({ recordingShortcut: on });

export function ShortcutsPage() {
  const t = useT();
  const p = t.shortcutsPage;
  const [active, setActive] = useState<ShortcutId | null>(null);
  const [problem, setProblem] = useState<{ id: ShortcutId; text: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const name = (id: ShortcutId) => p.names[id] ?? id;
  const keysText = (chord: KeyChord) => chordLabels(chord, t).join(" ");

  const stop = () => {
    setActive(null);
    recording(false);
  };

  const onKey = (id: ShortcutId) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (active !== id) return;
    // Tab still moves on (and ends the recording); Esc cancels.
    if (e.key === "Tab" && !e.ctrlKey && !e.altKey) {
      stop();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      stop();
      return;
    }
    const chord = chordFromEvent(e);
    if (!chord) return;
    const pressed = { key: e.key, code: e.code, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, altGraph: e.getModifierState("AltGraph") };
    const check = checkShortcut(id, chord, pressed);
    if (check.kind === "problem") {
      setProblem({ id, text: p.problems[check.problem] });
      return;
    }
    stop();
    setProblem(null);
    if (check.kind === "ok") setShortcut(id, chord);
    else setPending({ id, chord, check });
  };

  const confirmPending = () => {
    if (!pending) return;
    setShortcut(pending.id, pending.chord, pending.check.kind === "conflict" ? pending.check.other : undefined);
    setPending(null);
  };

  const pendingText = (x: Pending) =>
    x.check.kind === "standard" ? p.standardBody(keysText(x.chord)) : p.conflict(keysText(x.chord), name(x.check.other));

  return (
    <div className={s.shortcuts}>
      <div className={s.shortcutsHead}>
        <div className={s.shortcutsIntro}>
          <p className={s.hint}>{p.intro}</p>
          <p className={s.hint}>{p.widgetsHint}</p>
        </div>
        <Button
          size="small"
          icon={RotateCcw}
          onClick={() =>
            void confirmAction({ title: p.resetAllTitle, body: p.resetAllBody, confirmLabel: p.resetAllConfirm }).then((ok) => {
              if (!ok) return;
              resetAllShortcuts();
              setPending(null);
              setProblem(null);
            })
          }
        >
          {p.resetAll}
        </Button>
      </div>
      {GROUPS.map((g) => (
        <section key={g.id} className={s.shortcutGroup} aria-labelledby={`shortcuts-${g.id}`}>
          <h3 id={`shortcuts-${g.id}`} className={s.label}>
            {p.groups[g.id]}
          </h3>
          {g.ids.map((id) => {
            const keys = shortcutKeys(id, t);
            const customized = isCustomized(id);
            const isActive = active === id;
            return (
              <div key={id} className={s.shortcutItem}>
                <div className={s.shortcutRow}>
                  <span className={s.shortcutName}>
                    {name(id)}
                    {customized && <span className={s.shortcutChanged}>{p.customized}</span>}
                  </span>
                  <button
                    type="button"
                    className={[s.shortcutKeys, isActive && s.shortcutRecording].filter(Boolean).join(" ")}
                    aria-describedby={problem?.id === id ? `shortcut-problem-${id}` : undefined}
                    onClick={() => {
                      setPending(null);
                      setProblem(null);
                      setActive(id);
                      recording(true);
                    }}
                    onKeyDown={onKey(id)}
                    onBlur={() => isActive && stop()}
                  >
                    {/* The name read out ends with what is shown (WCAG 2.5.3). */}
                    <span className="u-visually-hidden">{p.record(name(id))} : </span>
                    {isActive ? <span className={s.shortcutPrompt}>{p.recording}</span> : keys.length ? <Kbd keys={keys} /> : <span className={s.shortcutNone}>{p.none}</span>}
                  </button>
                  <span className={s.shortcutActions}>
                    {customized && (
                      <IconButton
                        icon={RotateCcw}
                        label={p.resetLabel(name(id))}
                        onClick={() => {
                          setProblem(null);
                          // The default keys may belong to another shortcut now: ask, as when recording.
                          const other = resetShortcut(id);
                          setPending(other ? { id, chord: defaultChord(id), check: { kind: "conflict", other } } : null);
                        }}
                      />
                    )}
                    {keys.length > 0 && <IconButton icon={X} label={p.removeLabel(name(id))} onClick={() => setShortcut(id, null)} />}
                  </span>
                </div>
                {problem?.id === id && (
                  <p id={`shortcut-problem-${id}`} className={s.shortcutProblem} role="alert">
                    {problem.text}
                  </p>
                )}
                {pending?.id === id && (
                  <div className={s.shortcutConfirm} role="alert">
                    <span>{pendingText(pending)}</span>
                    <span className={s.shortcutConfirmActions}>
                      <Button size="small" onClick={() => setPending(null)}>
                        {p.cancel}
                      </Button>
                      <Button size="small" variant="primary" onClick={confirmPending}>
                        {pending.check.kind === "standard" ? p.standardConfirm : p.replace}
                      </Button>
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
