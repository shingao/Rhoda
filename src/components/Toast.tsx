import { useEffect } from "react";
import { cssMs } from "../app/cssTokens";
import { setState, useApp } from "../app/store";
import s from "./Toast.module.css";

/** Short non-blocking message at the bottom of the window ("3 liens mis à jour"). */
export function Toast() {
  const toast = useApp((st) => st.toast);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      if (useApp.getState().toast?.id === toast.id) setState({ toast: null });
    }, cssMs("--toast-duration"));
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <div className={s.region} role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className={s.toast}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
