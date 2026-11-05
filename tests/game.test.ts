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
import { buildReply, diffPrompt } from "~/game/typos";

describe("diffPrompt", () => {
  it("lines up a misspelled word with the word it was meant to be", () => {
    expect(diffPrompt("fix the sidbar", "fix the sidebar")).toEqual({
      typos: [{ target: "sidebar", typed: "sidbar" }],
      missing: [],
      extra: [],
    });
  });

  it("reports left-out words as missing and added words as extra", () => {
    expect(diffPrompt("fix sidebar now", "fix the sidebar")).toEqual({
      typos: [],
      missing: ["the"],
      extra: ["now"],
    });
  });

  it("ignores case and trailing punctuation", () => {
    expect(diffPrompt("Fix the sidebar", "fix the sidebar.").typos).toEqual([]);
  });
});

describe("buildReply", () => {
  const scripted = { text: "Done.", tools: [["edit", "src/Sidebar.tsx"]] as const, diff: [4, 2] as const, seconds: 3 };

  it("returns the scripted reply for a clean prompt", () => {
    const reply = buildReply({ ...scripted, tools: [...scripted.tools] }, diffPrompt("fix it", "fix it"), "theo");
    expect(reply.literal).toBe(false);
    expect(reply.text).toBe("Done.");
    expect(reply.files).toEqual([{ path: "src/Sidebar.tsx", additions: 4, deletions: 2 }]);
  });

  it("takes a typo literally", () => {
    const reply = buildReply({ ...scripted, tools: [...scripted.tools] }, diffPrompt("fix the sidbar", "fix the sidebar"), "theo");
    expect(reply.literal).toBe(true);
    expect(reply.text).toContain("`sidbar`");
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
