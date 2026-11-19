import { useEffect } from "react";

/** Open dialogs: the app behind them is inert (no focus, no clicks, hidden from assistive tech). */
let openDialogs = 0;
function setAppInert(): void {
  const root = document.getElementById("root");
  if (root) root.inert = openDialogs > 0;
}

/** Makes the app behind a modal inert while it is shown (Dialog, and full-screen editors with their own keys). */
export function useInertApp(): void {
  useEffect(() => {
    openDialogs++;
    setAppInert();
    return () => {
      openDialogs--;
      setAppInert();
    };
  }, []);
}
