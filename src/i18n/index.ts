import { en } from "./en";
import { fr, type Messages } from "./fr";

export type { Messages };
export type Language = "fr" | "en";

export const LANGUAGES: Record<Language, Messages> = { fr, en };
export const DEFAULT_LANGUAGE: Language = "fr";

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && value in LANGUAGES;
}

export function messagesFor(language: Language): Messages {
  return LANGUAGES[language];
}
