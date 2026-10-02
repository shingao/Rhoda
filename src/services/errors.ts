/** Kinds of disk errors reported by the backend (see src-tauri/src/error.rs). */
export type VaultErrorKind =
  | "locked"
  | "permissionDenied"
  | "diskFull"
  | "readOnly"
  | "notFound"
  | "alreadyExists"
  | "invalidName"
  | "other";

const KINDS = new Set<string>(["locked", "permissionDenied", "diskFull", "readOnly", "notFound", "alreadyExists", "invalidName", "other"]);

export function errorKind(e: unknown): VaultErrorKind {
  if (typeof e === "object" && e !== null && "kind" in e && typeof e.kind === "string" && KINDS.has(e.kind)) {
    return e.kind as VaultErrorKind;
  }
  return "other";
}

/** Readable text of a backend error (`{ kind, message }`) or any thrown value. */
export function errorMessage(e: unknown): string {
  if (typeof e === "object" && e !== null && "message" in e && typeof e.message === "string") return e.message;
  return String(e);
}
