import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

async function typePrompt(trailing = "") {
  const store = await import("~/game/store");
  const thread = store.activeThread();
  const text = store.nextPrompt(thread)!.text;
  for (const ch of text + trailing) {
    store.typeChar(ch);
    vi.advanceTimersByTime(100);
  }
  return { store, id: thread.def.id, typedMs: (text.length - 1) * 100 };
}

function lastResult(store: typeof import("~/game/store"), id: string) {
  return store.getState().threads.find((t) => t.def.id === id)!.turns.at(-1)!.result;
}

describe("prompt timer", () => {
  it("stops at the last character, not when Enter is pressed", async () => {
    const { store, id, typedMs } = await typePrompt();
    vi.advanceTimersByTime(5_000);
    store.send();
    expect(lastResult(store, id).ms).toBe(typedMs);
  });

  it("ignores a trailing space typed after the last word", async () => {
    const { store, id, typedMs } = await typePrompt(" ");
    vi.advanceTimersByTime(5_000);
    store.send();
    expect(lastResult(store, id).ms).toBe(typedMs);
  });

  it("freezes the live speed once the last word is typed", async () => {
    const { store } = await typePrompt();
    const before = store.computeStats().liveWpm;
    store.typeChar(" ");
    expect(store.computeStats().liveWpm).toBe(before);
  });
});
