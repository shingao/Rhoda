import { describe, expect, it } from "vitest";
import { formatBytes } from "./format";

describe("formatBytes", () => {
  const fr = ["o", "Ko", "Mo", "Go"] as const;
  it("rounds like a file manager", () => {
    expect(formatBytes(840, "fr-FR", fr)).toBe("840 o");
    expect(formatBytes(12_400, "fr-FR", fr)).toBe("12 Ko");
    expect(formatBytes(1.4 * 1024 * 1024, "fr-FR", fr)).toBe("1,4 Mo");
    expect(formatBytes(20 * 1024 * 1024, "en-US", ["B", "KB", "MB", "GB"])).toBe("20 MB");
  });
});
