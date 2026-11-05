import { useSyncExternalStore } from "react";
import { drawThreads, type PromptDef, type ThreadDef } from "~/content/prompts";
import { buildReply, diffPrompt, type AgentReply, type PromptDiff } from "./typos";

export type GameMs = number;
export type RealMs = number;

export interface PromptResult {
  wpm: number;
  accuracy: number;
  ms: RealMs;
  correctChars: number;
}

export interface Turn {
  id: string;
  result: PromptResult;
  promptIndex: number;
  prompt: PromptDef;
  typed: string;
  diff: PromptDiff;
  reply: AgentReply;
  startedAt: GameMs;
  durationMs: GameMs;
  done: boolean;
}

export interface ThreadState {
  def: ThreadDef;
  turns: Turn[];
  draft: string;
  draftMs: RealMs;
  draftWordsMs: RealMs;
  draftLastKeyAt: RealMs | null;
  draftKeys: number;
  draftCorrectKeys: number;
  unread: boolean;
  updatedAt: GameMs;
  settledAt: GameMs | null;
}

export interface Session {
  status: "ready" | "playing" | "ended";
  startedAt: GameMs | null;
  endedAt: GameMs | null;
  endReason: "done" | null;
  keystrokes: number;
  correctKeystrokes: number;
  promptsSent: number;
  typosLiteral: number;
}

export interface GameState {
  threads: ThreadState[];
  activeId: string;
  session: Session;
  now: GameMs;
}

const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const SPEED = Math.max(0.1, Number(params.get("speed") ?? 1) || 1);
const DRAFT_SLACK = 24;
const SETTLE_DELAY_MS = 1800;

const seedParam = params.get("seed");
let sessionSeed = seedParam !== null && seedParam !== "" ? Number(seedParam) : Math.floor(Math.random() * 1e9);
const THREADS_PER_CORE_PERSONA = Math.max(1, Number(params.get("core") ?? 2) || 2);
const GUEST_THREADS = Math.max(0, Number(params.get("guests") ?? 3));

const realStart = Date.now();
const clock = () => realStart + (Date.now() - realStart) * SPEED;

function seededThreads(now: number, defs: ThreadDef[]): ThreadState[] {
  const minutesSinceLastActivity = [12, 47, 95, 180, 300, 26 * 60, 50 * 60, 3 * 24 * 60, 6 * 24 * 60];
  return defs.map((def, index) => ({
    def,
    turns: [],
    draft: "",
    draftMs: 0,
    draftWordsMs: 0,
    draftLastKeyAt: null,
    draftKeys: 0,
    draftCorrectKeys: 0,
    unread: false,
    updatedAt: now - (minutesSinceLastActivity[index % minutesSinceLastActivity.length] ?? 60) * 60_000,
    settledAt: null,
  }));
}

function freshSession(): Session {
  return {
    status: "ready",
    startedAt: null,
    endedAt: null,
    endReason: null,
    keystrokes: 0,
    correctKeystrokes: 0,
    promptsSent: 0,
    typosLiteral: 0,
  };
}

function initialState(): GameState {
  const now = clock();
  const defs = drawThreads(sessionSeed, THREADS_PER_CORE_PERSONA, GUEST_THREADS);
  return { threads: seededThreads(now, defs), activeId: defs[0]!.id, session: freshSession(), now };
}

let state: GameState = initialState();
const listeners = new Set<() => void>();

function set(next: GameState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGame(): GameState {
  return useSyncExternalStore(subscribe, () => state);
}

export function getState(): GameState {
  return state;
}

export function isWorking(thread: ThreadState): boolean {
  const last = thread.turns.at(-1);
  return last !== undefined && !last.done;
}

export function nextPrompt(thread: ThreadState): PromptDef | null {
  return thread.def.prompts[thread.turns.length] ?? null;
}

export function isComplete(thread: ThreadState): boolean {
  return nextPrompt(thread) === null && !isWorking(thread);
}

export function awaitingInput(thread: ThreadState): boolean {
  return !isWorking(thread) && nextPrompt(thread) !== null;
}

export function isSettled(thread: ThreadState): boolean {
  return thread.settledAt !== null;
}

export function activeThread(s: GameState = state): ThreadState {
  return s.threads.find((thread) => thread.def.id === s.activeId) ?? s.threads[0]!;
}

export interface Stats {
  wpm: number;
  liveWpm: number | null;
  bestWpm: number;
  best: { wpm: number; text: string; thread: string } | null;
  accuracy: number;
  promptsSent: number;
  typosLiteral: number;
  elapsedMs: number;
  threadsDone: number;
}

const MIN_TEST_MS = 400;

export function wpmOf(correctChars: number, ms: number): number {
  return correctChars / 5 / (Math.max(ms, MIN_TEST_MS) / 60_000);
}

export function correctCharsOf(typed: string, target: string): number {
  let n = 0;
  for (let i = 0; i < typed.length && i < target.length; i++) if (typed[i] === target[i]) n++;
  return n;
}

export function computeStats(s: GameState = state): Stats {
  const session = s.session;
  const turns = s.threads.flatMap((thread) => thread.turns.map((turn) => ({ turn, thread })));
  const totalChars = turns.reduce((sum, { turn }) => sum + turn.result.correctChars, 0);
  const totalMs = turns.reduce((sum, { turn }) => sum + turn.result.ms, 0);
  const wpm = turns.length > 0 ? wpmOf(totalChars, totalMs) : 0;
  let best: Stats["best"] = null;
  for (const { turn, thread } of turns) {
    if (!best || turn.result.wpm > best.wpm) best = { wpm: turn.result.wpm, text: turn.typed, thread: thread.def.title };
  }
  const open = activeThread(s);
  const prompt = nextPrompt(open);
  let liveWpm: number | null = null;
  if (open.draft.length > 0 && prompt && open.draftWordsMs >= 1000) {
    liveWpm = Math.round(wpmOf(correctCharsOf(open.draft.trimEnd(), prompt.text), open.draftWordsMs));
  } else if (open.draft.length === 0 && open.turns.length > 0) {
    liveWpm = open.turns.at(-1)!.result.wpm;
  }
  const accuracy = session.keystrokes > 0 ? session.correctKeystrokes / session.keystrokes : 1;
  const end = session.endedAt ?? s.now;
  const elapsedMs = session.startedAt === null ? 0 : Math.max(0, end - session.startedAt);
  return {
    wpm: Math.round(wpm),
    liveWpm,
    bestWpm: best?.wpm ?? 0,
    best,
    accuracy,
    promptsSent: session.promptsSent,
    typosLiteral: session.typosLiteral,
    elapsedMs,
    threadsDone: s.threads.filter(isComplete).length,
  };
}

function advance(s: GameState, now: GameMs): GameState {
  let changed = false;
  const threads = s.threads.map((thread) => {
    const last = thread.turns.at(-1);
    if (!last || last.done || now < last.startedAt + last.durationMs) return thread;
    changed = true;
    const finishedAt = last.startedAt + last.durationMs;
    return {
      ...thread,
      turns: [...thread.turns.slice(0, -1), { ...last, done: true }],
      unread: thread.def.id !== s.activeId,
      updatedAt: finishedAt,
    };
  });
  let next: GameState = { ...s, threads: changed ? threads : s.threads, now };
  next = autoSettle(next, now);
  if (s.session.status === "playing" && next.threads.every(isComplete)) {
    next = endSession(next, "done", now);
  }
  return next;
}

function autoSettle(s: GameState, now: GameMs): GameState {
  const delay = SETTLE_DELAY_MS * SPEED;
  const ready = s.threads.filter((thread) => {
    if (isSettled(thread) || !isComplete(thread)) return false;
    const last = thread.turns.at(-1);
    return last !== undefined && now >= last.startedAt + last.durationMs + delay;
  });
  if (ready.length === 0) return s;
  const readyIds = new Set(ready.map((thread) => thread.def.id));
  let next: GameState = {
    ...s,
    threads: s.threads.map((thread) =>
      readyIds.has(thread.def.id) ? { ...thread, settledAt: now, unread: false } : thread,
    ),
  };
  if (readyIds.has(s.activeId)) {
    const target = nextThreadNeedingPlayer(next);
    if (target) next = withSelected(next, target);
  }
  return next;
}

function endSession(s: GameState, reason: "done", at: GameMs): GameState {
  return {
    ...s,
    session: { ...s.session, status: "ended", endReason: reason, endedAt: at },
  };
}

if (typeof window !== "undefined") {
  window.setInterval(() => set(advance(state, clock())), 200);
}

function updateThread(s: GameState, id: string, fn: (thread: ThreadState) => ThreadState) {
  return { ...s, threads: s.threads.map((thread) => (thread.def.id === id ? fn(thread) : thread)) };
}

function addTimeSinceLastKey(thread: ThreadState, real: RealMs): ThreadState {
  const gap = thread.draftLastKeyAt === null ? 0 : real - thread.draftLastKeyAt;
  return { ...thread, draftMs: thread.draftMs + gap, draftLastKeyAt: real };
}

function editDraft(thread: ThreadState, draft: string, real: RealMs): ThreadState {
  const timed = addTimeSinceLastKey(thread, real);
  const wordsChanged = draft.trimEnd() !== thread.draft.trimEnd();
  return { ...timed, draft, draftWordsMs: wordsChanged ? timed.draftMs : thread.draftWordsMs };
}

function canType(thread: ThreadState): boolean {
  return state.session.status !== "ended" && awaitingInput(thread);
}

function startIfReady(s: GameState, now: GameMs): GameState {
  if (s.session.status !== "ready") return s;
  return { ...s, session: { ...s.session, status: "playing", startedAt: now } };
}

export function typeChar(ch: string) {
  const thread = activeThread();
  const target = nextPrompt(thread);
  if (!target || !canType(thread)) return;
  if (thread.draft.length >= target.text.length + DRAFT_SLACK) return;
  const now = clock();
  const real = Date.now();
  let s = startIfReady(advance(state, now), now);
  const correct = target.text[thread.draft.length] === ch;
  s = {
    ...s,
    session: {
      ...s.session,
      keystrokes: s.session.keystrokes + 1,
      correctKeystrokes: s.session.correctKeystrokes + (correct ? 1 : 0),
    },
  };
  set(updateThread(s, thread.def.id, (t) => ({
    ...editDraft(t, t.draft + ch, real),
    draftKeys: t.draftKeys + 1,
    draftCorrectKeys: t.draftCorrectKeys + (correct ? 1 : 0),
  })));
}

export function backspace(word = false) {
  const thread = activeThread();
  if (!canType(thread) || thread.draft.length === 0) return;
  const draft = word ? thread.draft.replace(/\S+\s*$|\s+$/, "") : thread.draft.slice(0, -1);
  set(updateThread(state, thread.def.id, (t) => editDraft(t, draft, Date.now())));
}

export function send() {
  const thread = activeThread();
  const prompt = nextPrompt(thread);
  if (!prompt || !canType(thread) || thread.draft.trim().length === 0) return;
  const now = clock();
  let s = startIfReady(advance(state, now), now);
  const correctChars = correctCharsOf(thread.draft.trim(), prompt.text);
  const result: PromptResult = {
    wpm: Math.round(wpmOf(correctChars, thread.draftWordsMs)),
    accuracy: thread.draftKeys > 0 ? thread.draftCorrectKeys / thread.draftKeys : 1,
    ms: Math.max(thread.draftWordsMs, MIN_TEST_MS),
    correctChars,
  };
  const diff = diffPrompt(thread.draft, prompt.text);
  const reply = buildReply(prompt.reply, diff, thread.def.persona);
  const turn: Turn = {
    id: `${thread.def.id}:${thread.turns.length}`,
    result,
    promptIndex: thread.turns.length,
    prompt,
    typed: thread.draft.trim(),
    diff,
    reply,
    startedAt: now,
    durationMs: reply.seconds * 1000,
    done: false,
  };
  s = {
    ...s,
    session: {
      ...s.session,
      promptsSent: s.session.promptsSent + 1,
      typosLiteral: s.session.typosLiteral + diff.typos.length,
    },
  };
  s = updateThread(s, thread.def.id, (t) => ({
    ...t,
    turns: [...t.turns, turn],
    draft: "",
    draftMs: 0,
    draftWordsMs: 0,
    draftLastKeyAt: null,
    draftKeys: 0,
    draftCorrectKeys: 0,
    updatedAt: now,
  }));
  set(s);
}

function pauseDraftClocks(threads: ThreadState[]): ThreadState[] {
  return threads.map((t) => (t.draftLastKeyAt === null ? t : { ...t, draftLastKeyAt: null }));
}

function withSelected(s: GameState, id: string): GameState {
  const paused = { ...s, threads: pauseDraftClocks(s.threads) };
  return updateThread({ ...paused, activeId: id }, id, (t) => ({ ...t, unread: false }));
}

export function selectThread(id: string) {
  if (!state.threads.some((thread) => thread.def.id === id)) return;
  set(withSelected(state, id));
}

function unsettledIdsInSidebarOrder(s: GameState = state): string[] {
  const open = s.threads.filter((t) => !isSettled(t) || t.def.id === s.activeId);
  const projects = [...new Set(open.map((t) => t.def.project))];
  return projects.flatMap((project) =>
    open.filter((t) => t.def.project === project).map((t) => t.def.id),
  );
}

function nextThreadNeedingPlayer(s: GameState): string | null {
  const ids = unsettledIdsInSidebarOrder(s);
  const start = ids.indexOf(s.activeId);
  const rotated = [...ids.slice(start + 1), ...ids.slice(0, start + 1)].filter((id) => id !== s.activeId);
  const byId = new Map(s.threads.map((t) => [t.def.id, t]));
  const waiting = rotated.filter((id) => awaitingInput(byId.get(id)!));
  return (
    waiting.find((id) => byId.get(id)!.unread) ??
    waiting[0] ??
    rotated.find((id) => isWorking(byId.get(id)!)) ??
    null
  );
}

export function cycleThread(direction: 1 | -1) {
  const ids = unsettledIdsInSidebarOrder();
  const index = ids.indexOf(state.activeId);
  selectThread(ids[(index + direction + ids.length) % ids.length]!);
}

export function nextWaitingThread() {
  const pick = nextThreadNeedingPlayer(state);
  if (pick) selectThread(pick);
}

export function restart() {
  sessionSeed += 1;
  set(initialState());
}

declare global {
  interface Window {
    __game: {
      state: () => GameState & { stats: Stats };
      select: (id: string) => void;
      speed: number;
    };
  }
}

if (typeof window !== "undefined") {
  window.__game = {
    state: () => ({ ...state, stats: computeStats(state) }),
    select: selectThread,
    speed: SPEED,
  };
}
