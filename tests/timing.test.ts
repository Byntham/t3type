import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

async function typePrompt() {
  const store = await import("~/game/store");
  const thread = store.activeThread();
  const text = store.nextPrompt(thread)!.text;
  for (const ch of text) {
    store.typeChar(ch);
    vi.advanceTimersByTime(100);
  }
  return { store, id: thread.def.id, text, typedMs: (text.length - 1) * 100 };
}

function threadOf(store: typeof import("~/game/store"), id: string) {
  return store.getState().threads.find((t) => t.def.id === id)!;
}

describe("prompt timer", () => {
  it("stops at the last character, not when Enter is pressed", async () => {
    const { store, id, typedMs } = await typePrompt();
    vi.advanceTimersByTime(5_000);
    store.send();
    expect(threadOf(store, id).turns.at(-1)!.result.ms).toBe(typedMs);
  });

  it("freezes the live speed once the prompt is complete", async () => {
    const { store } = await typePrompt();
    const before = store.computeStats().liveWpm;
    vi.advanceTimersByTime(5_000);
    store.typeChar(" ");
    expect(store.computeStats().liveWpm).toBe(before);
  });
});

describe("prompt completion", () => {
  it("locks a complete prompt so keys and backspace do nothing", async () => {
    const { store, id, text } = await typePrompt();
    store.typeChar("x");
    store.backspace();
    store.backspace(true);
    expect(threadOf(store, id).draft).toBe(text);
    expect(store.isDraftComplete(threadOf(store, id))).toBe(true);
  });

  it("will not send a prompt that still has a wrong key", async () => {
    const store = await import("~/game/store");
    const thread = store.activeThread();
    const text = store.nextPrompt(thread)!.text;
    const wrong = text[0] === "q" ? "z" : "q";
    for (const ch of wrong + text.slice(1)) store.typeChar(ch);
    store.typeChar("x");
    expect(threadOf(store, thread.def.id).draft).toBe(wrong + text.slice(1));
    store.send();
    expect(threadOf(store, thread.def.id).turns).toHaveLength(0);
    while (threadOf(store, thread.def.id).draft.length > 0) store.backspace();
    for (const ch of text) store.typeChar(ch);
    store.send();
    const turn = threadOf(store, thread.def.id).turns.at(-1)!;
    expect(turn.prompt.text).toBe(text);
    expect(turn.result.accuracy).toBeLessThan(1);
  });
});
