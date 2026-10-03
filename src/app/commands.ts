import { getState, setState } from "./store";

/** Hooks that UI components register so global shortcuts can reach them. */
let focusSearchHandler: (() => void) | null = null;

export function registerSearchFocus(handler: (() => void) | null): void {
  focusSearchHandler = handler;
}

/** Ctrl+K: the search field is hidden in focus mode, so it leaves it first. */
export function focusSearch(): void {
  if (!getState().focusMode) {
    focusSearchHandler?.();
    return;
  }
  setState({ focusMode: false });
  // The titlebar is inert until React re-renders without focus mode.
  setTimeout(() => focusSearchHandler?.(), 0);
}
