import { messagesFor, type Messages } from "../i18n";
import { getState, useApp } from "./store";

/** Strings of the current language, for React components. */
export function useT(): Messages {
  return messagesFor(useApp((s) => s.settings.language));
}

/** Strings of the current language, outside React. */
export function currentMessages(): Messages {
  return messagesFor(getState().settings.language);
}
