import { describe, expect, it } from "vitest";
import {
  CORE_PERSONAS,
  THREADS,
  drawThreads,
  personOf,
  sourceAuthor,
  type RealPrompt,
} from "~/content/prompts";
import { correctCharsOf, wpmOf } from "~/game/store";
import { buildReply } from "~/game/reply";

describe("buildReply", () => {
  it("lists each edited file with the scripted line counts", () => {
    const reply = buildReply({ text: "Done.", tools: [["edit", "src/Sidebar.tsx"]], diff: [4, 2], seconds: 3 });
    expect(reply.text).toBe("Done.");
    expect(reply.files).toEqual([{ path: "src/Sidebar.tsx", additions: 4, deletions: 2 }]);
  });
});

describe("prompts", () => {
  it("only use characters you can type on a US keyboard, so every prompt can be finished", () => {
    for (const thread of THREADS) for (const prompt of thread.prompts) expect(prompt.text).toMatch(/^[\x20-\x7e]+$/);
  });
});

describe("typing speed", () => {
  it("counts characters that match the target at the same position", () => {
    expect(correctCharsOf("helo world", "hello world")).toBe(3);
  });

  it("uses five characters per word", () => {
    expect(wpmOf(100, 60_000)).toBe(20);
  });

  it("does not let a very short test inflate the speed", () => {
    expect(wpmOf(5, 1)).toBe(wpmOf(5, 400));
  });
});

describe("drawThreads", () => {
  it("draws the same threads for the same seed", () => {
    expect(drawThreads(7).map((t) => t.id)).toEqual(drawThreads(7).map((t) => t.id));
  });

  it("takes perCore threads from each core persona and guests from distinct mutuals", () => {
    const drawn = drawThreads(7, 2, 3);
    for (const key of CORE_PERSONAS) expect(drawn.filter((t) => t.persona === key).length).toBe(2);
    const guests = drawn.filter((t) => !CORE_PERSONAS.includes(t.persona));
    expect(guests.length).toBe(3);
    expect(new Set(guests.map((t) => t.persona)).size).toBe(3);
  });

  it("fills guest slots from core personas when there are no mutual threads", () => {
    const coreOnly = THREADS.filter((t) => CORE_PERSONAS.includes(t.persona));
    const drawn = drawThreads(7, 1, 2, coreOnly);
    expect(drawn.length).toBe(CORE_PERSONAS.length + 2);
    expect(drawn.every((t) => CORE_PERSONAS.includes(t.persona))).toBe(true);
  });
});

describe("people", () => {
  it("falls back to the persona key for an unknown person", () => {
    expect(personOf("nobody-here")).toEqual({ name: "nobody-here", handle: "@nobody-here" });
  });

  it("names the poster of a quoted x.com post", () => {
    const prompt = { sourceUrl: "https://x.com/someone/status/123" } as RealPrompt;
    expect(sourceAuthor(prompt)).toBe("@someone");
  });
});
