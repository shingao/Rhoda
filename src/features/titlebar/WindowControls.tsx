import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { useT } from "../../app/i18n";
import { appWindow } from "../../services/appWindow";
import s from "./WindowControls.module.css";

/** Minimize / maximize / close, Windows style [DESIGN §2.1]. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);
  const t = useT();

  useEffect(() => {
    let alive = true;
    const unlisten: Array<() => void> = [];
    const refresh = () => void appWindow.isMaximized().then((m) => alive && setMaximized(m));
    refresh();
    void appWindow.onResized(refresh).then((u) => (alive ? unlisten.push(u) : u()));
    void appWindow.onFocusChanged((f) => alive && setFocused(f)).then((u) => (alive ? unlisten.push(u) : u()));
    return () => {
      alive = false;
      unlisten.forEach((u) => u());
    };
  }, []);

  return (
    <div className={[s.controls, !focused && s.inactive].filter(Boolean).join(" ")}>
      <button type="button" className={s.button} aria-label={t.titlebar.minimize} tabIndex={-1} onClick={() => void appWindow.minimize()}>
        <Minus className={s.icon} aria-hidden />
      </button>
      <button
        type="button"
        className={s.button}
        aria-label={maximized ? t.titlebar.restore : t.titlebar.maximize}
        tabIndex={-1}
        onClick={() => void appWindow.toggleMaximize()}
      >
        {maximized ? <Copy className={s.icon} aria-hidden /> : <Square className={s.icon} aria-hidden />}
      </button>
      <button type="button" className={`${s.button} ${s.close}`} aria-label={t.titlebar.close} tabIndex={-1} onClick={() => void appWindow.close()}>
        <X className={s.icon} aria-hidden />
      </button>
    </div>
  );
}
