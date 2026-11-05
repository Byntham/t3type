import { describe, expect, it } from "vitest";
import { compactSidebarTimeLabel, formatRelativeElapsed } from "~/lib/time";
import { cn } from "~/lib/utils";

describe("compactSidebarTimeLabel", () => {
  it("drops the ago suffix for sidebar rows", () => {
    expect(compactSidebarTimeLabel(formatRelativeElapsed(5_000))).toBe("now");
    expect(compactSidebarTimeLabel(formatRelativeElapsed(3 * 60_000))).toBe("3m");
    expect(compactSidebarTimeLabel(formatRelativeElapsed(2 * 3_600_000))).toBe("2h");
  });
});

describe("cn", () => {
  it("treats text-2xs as a font size, so it does not replace a text color", () => {
    expect(cn("text-2xs", "text-red-500")).toBe("text-2xs text-red-500");
  });

  it("still lets a later font size replace text-2xs", () => {
    expect(cn("text-2xs", "text-sm")).toBe("text-sm");
  });
});
