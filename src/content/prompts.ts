// Thread content for t3type. The source of truth is
// content/research/t3-threads.json at the repo root, imported as-is so the
// prompt text stays exactly as written. This file only adds types and helpers.
import raw from "../../content/research/t3-threads.json";

export type PersonaKey = "theo" | "julius" | "maria";
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

export type ProviderKind = "claude" | "codex";

export function threadProvider(thread: ThreadDef): ProviderKind {
  return /claude|opus|sonnet|haiku/i.test(thread.model) ? "claude" : "codex";
}

/** Projects in sidebar order, first appearance wins. */
export function projectOrder(threads: ThreadDef[]): string[] {
  return [...new Set(threads.map((thread) => thread.project))];
}
