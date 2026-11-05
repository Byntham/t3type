import raw from "../../content/threads.json";

export type PersonaKey = string;

export const CORE_PERSONAS: readonly PersonaKey[] = ["theo", "julius", "maria"];
export type ToolType = "read" | "edit" | "bash" | "search";
export type ToolRow = readonly [ToolType, string];
export type LineCounts = readonly [added: number, removed: number];

export interface ScriptedReply {
  text: string;
  tools: ToolRow[];
  diff: LineCounts | null;
  seconds: number;
}

interface PromptBase {
  text: string;
  reply: ScriptedReply;
}

export interface RealPrompt extends PromptBase {
  kind: "real";
  sourceUrl: string;
  sourceId?: string;
  credit?: string;
}

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

export function personOf(key: PersonaKey): Person {
  return PEOPLE[key] ?? { name: key, handle: `@${key}` };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function drawThreads(seed: number, perCore = 2, guests = 3, pool: ThreadDef[] = THREADS): ThreadDef[] {
  const rand = mulberry32(seed);
  const shuffle = <T,>(list: T[]) => {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  const core = CORE_PERSONAS.flatMap((key) => shuffle(pool.filter((t) => t.persona === key)));
  const corePicked = CORE_PERSONAS.flatMap((key) => core.filter((t) => t.persona === key).slice(0, perCore));
  const guestPool = shuffle(pool.filter((t) => !CORE_PERSONAS.includes(t.persona)));
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

export function projectOrder(threads: ThreadDef[]): string[] {
  return [...new Set(threads.map((thread) => thread.project))];
}
