import s from "./Kbd.module.css";

/** Keys of a shortcut, one chip per key [DESIGN §2.16]: ["Ctrl", "Maj", "E"]. */
export function Kbd({ keys, className }: { keys: readonly string[]; className?: string }) {
  if (!keys.length) return null;
  return (
    <span className={[s.keys, className].filter(Boolean).join(" ")}>
      {keys.map((k, i) => (
        <kbd key={i} className={s.kbd}>
          {k}
        </kbd>
      ))}
    </span>
  );
}
