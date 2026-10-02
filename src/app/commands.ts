/** Hooks that UI components register so global shortcuts can reach them. */
let focusSearchHandler: (() => void) | null = null;

export function registerSearchFocus(handler: (() => void) | null): void {
  focusSearchHandler = handler;
}

export function focusSearch(): void {
  focusSearchHandler?.();
}
