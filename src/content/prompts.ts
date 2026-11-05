// Thread content for t3type. The source of truth is
// content/research/t3-threads.json at the repo root, imported as-is so the
// prompt text stays exactly as written. This file only adds types and helpers.
import raw from "../../content/research/t3-threads.json";

/** Short lowercase key per person: theo, julius, maria, plus mutuals like tibo. */
export type PersonaKey = string;

/** The T3 Code team. Every session includes threads from each of them. */
export const CORE_PERSONAS: readonly PersonaKey[] = ["theo", "julius", "maria"];
export type ToolType = "read" | "edit" | "bash" | "search";
export type ToolRow = readonly [ToolType, string];

export interface ScriptedReply {
  text: string;
  tools: ToolRow[];
  /** [added, removed] lines, or null when the turn changed nothing. */
  diff: readonly [number, number] | null;
  /** Seconds of fake agent work. */
  seconds: number;
}

interface PromptBase {
  text: string;
  reply: ScriptedReply;
}

/** Verbatim from a public post. Always shown with its source. */
export interface RealPrompt extends PromptBase {
  kind: "real";
  sourceUrl: string;
  sourceId?: string;
  /** Context when the poster is not the thread's persona. */
  credit?: string;
}

/** Written for the game in the persona's style. Always labeled as parody. */
export interface ParodyPrompt extends PromptBase {
  kind: "parody";
}

export type PromptDef = RealPrompt | ParodyPrompt;

export interface ThreadDef {
  id: string;
  persona: PersonaKey;
  project: string;
  title: string;
  model: string;
  prompts: PromptDef[];
}

export interface Person {
  name: string;
  handle: string;
}

const data = raw as unknown as {
  people: Record<PersonaKey, Person>;
  threads: ThreadDef[];
};

export const PEOPLE: Record<PersonaKey, Person> = data.people;
export const THREADS: ThreadDef[] = data.threads;

/** The person behind a persona key, with a fallback so a missing entry never crashes the UI. */
export function personOf(key: PersonaKey): Person {
  return PEOPLE[key] ?? { name: key, handle: `@${key}` };
}

/** Deterministic RNG (mulberry32), so ?seed=N replays the same draw. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The threads for one session: `perCore` random threads from each of the core
 * three, plus `guests` threads from the mutuals (each from a different person
 * when possible), shuffled together. With no mutual threads, the core three
 * fill the guest slots.
 */
export function drawThreads(seed: number, perCore = 2, guests = 3): ThreadDef[] {
  const rand = rng(seed);
  const shuffle = <T,>(list: T[]) => {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  const core = CORE_PERSONAS.flatMap((key) => shuffle(THREADS.filter((t) => t.persona === key)));
  const corePicked = CORE_PERSONAS.flatMap((key) => core.filter((t) => t.persona === key).slice(0, perCore));
  const guestPool = shuffle(THREADS.filter((t) => !CORE_PERSONAS.includes(t.persona)));
  const guestPicked: ThreadDef[] = [];
  const usedGuests = new Set<PersonaKey>();
  for (const thread of guestPool) {
    if (guestPicked.length >= guests) break;
    if (usedGuests.has(thread.persona)) continue;
    usedGuests.add(thread.persona);
    guestPicked.push(thread);
  }
  for (const thread of guestPool) {
    if (guestPicked.length >= guests) break;
    if (!guestPicked.includes(thread)) guestPicked.push(thread);
  }
  const spare = core.filter((t) => !corePicked.includes(t));
  const fill = spare.slice(0, guests - guestPicked.length);
  return shuffle([...corePicked, ...guestPicked, ...fill]);
}

/** The @handle in an x.com status URL, so a quote names who actually posted it. */
export function sourceAuthor(prompt: RealPrompt): string | null {
  const match = /x\.com\/([^/]+)\/status/.exec(prompt.sourceUrl);
  return match ? `@${match[1]}` : null;
}

export function threadBranch(thread: ThreadDef): string {
  const slug = thread.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${thread.persona}/${slug}`;
}

export type ProviderKind = "claude" | "codex" | "other";

export function threadProvider(thread: ThreadDef): ProviderKind {
  if (/claude|opus|sonnet|haiku|fable/i.test(thread.model)) return "claude";
  if (/gpt|codex|sol|astra|terra|luna/i.test(thread.model)) return "codex";
  return "other";
}

/** Projects in sidebar order, first appearance wins. */
export function projectOrder(threads: ThreadDef[]): string[] {
  return [...new Set(threads.map((thread) => thread.project))];
}
