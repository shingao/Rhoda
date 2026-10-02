import { useEffect, useState } from "react";
import { cssMs } from "../app/cssTokens";
import { setState, useApp } from "../app/store";
import s from "./Toast.module.css";

/**
 * Short non-blocking message at the bottom of the window ("3 liens mis à jour"),
 * with an optional action ("Annuler"). The timer pauses while the pointer or
 * the keyboard focus is on the toast.
 */
export function Toast() {
  const toast = useApp((st) => st.toast);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!toast || held) return;
    const timer = setTimeout(
      () => {
        if (useApp.getState().toast?.id === toast.id) setState({ toast: null });
      },
      cssMs(toast.action ? "--toast-action-duration" : "--toast-duration"),
    );
    return () => clearTimeout(timer);
  }, [toast, held]);
  return (
    <div className={s.region} role="status" aria-live="polite">
      {toast && (
        <div
          key={toast.id}
          className={s.toast}
          onPointerEnter={() => setHeld(true)}
          onPointerLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={() => setHeld(false)}
        >
          <span>{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              className={s.action}
              onClick={() => {
                setState({ toast: null });
                setHeld(false);
                toast.action?.run();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
