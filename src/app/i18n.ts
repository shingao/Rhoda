import { messagesFor, type Messages } from "../i18n";
import { getState, useApp } from "./store";

/**
 * Strings of the current language, for React components. Also re-renders them
 * when the shortcuts change, so every label built with `shortcutLabel` follows.
 */
export function useT(): Messages {
  useApp((s) => s.shortcutsVersion);
  return messagesFor(useApp((s) => s.settings.language));
}

/** Strings of the current language, outside React. */
export function currentMessages(): Messages {
  return messagesFor(getState().settings.language);
}
