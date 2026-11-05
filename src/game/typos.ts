// Diff what the player typed against the target prompt, word by word, and build
// an agent reply that takes every typo literally.
import type { PersonaKey, ScriptedReply, ToolRow, ToolType } from "~/content/prompts";

export interface WordTypo {
  /** The word the prompt asked for. */
  target: string;
  /** What the player typed instead. */
  typed: string;
}

export interface PromptDiff {
  typos: WordTypo[];
  /** Target words the player left out. */
  missing: string[];
  /** Words the player added. */
  extra: string[];
}

const strip = (word: string) => word.replace(/^[^\p{L}\p{N}@`$/._-]+|[^\p{L}\p{N}`/_-]+$/gu, "");
const norm = (word: string) => strip(word).toLowerCase();

export function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Levenshtein alignment over word tokens. Substitutions become typos. */
export function diffPrompt(typedText: string, targetText: string): PromptDiff {
  const a = tokenize(targetText);
  const b = tokenize(typedText);
  const n = a.length;
  const m = b.length;
  const cost: number[][] = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = norm(a[i - 1]!) === norm(b[j - 1]!);
      // A near miss (same first letter or one edit apart) aligns as a substitution
      // more cheaply than an unrelated word, so "sidbar" lines up with "sidebar".
      const sub = same ? 0 : charDistance(norm(a[i - 1]!), norm(b[j - 1]!)) <= 3 ? 1 : 1.6;
      cost[i]![j] = Math.min(
        cost[i - 1]![j - 1]! + sub,
        cost[i - 1]![j]! + 1,
        cost[i]![j - 1]! + 1,
      );
    }
  }
  const typos: WordTypo[] = [];
  const missing: string[] = [];
  const extra: string[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const same = norm(a[i - 1]!) === norm(b[j - 1]!);
      const sub = same ? 0 : charDistance(norm(a[i - 1]!), norm(b[j - 1]!)) <= 3 ? 1 : 1.6;
      if (cost[i]![j] === cost[i - 1]![j - 1]! + sub) {
        if (!same) typos.unshift({ target: strip(a[i - 1]!), typed: strip(b[j - 1]!) || b[j - 1]! });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && cost[i]![j] === cost[i - 1]![j]! + 1) {
      missing.unshift(strip(a[i - 1]!));
      i--;
    } else {
      extra.unshift(strip(b[j - 1]!));
      j--;
    }
  }
  return { typos, missing: missing.filter(Boolean), extra: extra.filter(Boolean) };
}

export function charDistance(x: string, y: string): number {
  const row = Array.from({ length: y.length + 1 }, (_, k) => k);
  for (let i = 1; i <= x.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[y.length]!;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let k = 0; k < text.length; k++) {
    h ^= text.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const VERBS = new Set(
  "fix add ship sort split hide measure trim batch open merge draft list find rerun put make tell inject get use tag back sync keep figure insane measure design".split(
    " ",
  ),
);

const pascal = (word: string) =>
  word
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("") || "Thing";

const looksLikeCode = (word: string) => /[./_`$]|[a-z][A-Z]|\d/.test(word);

/** Which typo the agent obsesses over: the longest, most identifier-like one. */
function headlineTypo(typos: WordTypo[]): WordTypo {
  return [...typos].sort(
    (x, y) =>
      Number(looksLikeCode(y.target)) - Number(looksLikeCode(x.target)) ||
      y.target.length - x.target.length,
  )[0]!;
}

const SIGNOFF: Record<PersonaKey, string[]> = {
  theo: ["Shipping it to nightly anyway.", "This is fine. Probably."],
  julius: ["Left a note in the PR so nobody merges it on Saturday.", "Marked it intentional."],
  maria: ["Added before and after screenshots, both of them confused.", "No regressions, technically."],
};

export interface AgentReply extends ScriptedReply {
  /** Files for the changed-files card, with a split of the diff. */
  files: { path: string; additions: number; deletions: number }[];
  literal: boolean;
}

function filesFor(tools: ToolRow[], diff: readonly [number, number] | null) {
  if (!diff) return [];
  const paths = [...new Set(tools.filter(([type]) => type === "edit").map(([, label]) => label))];
  if (paths.length === 0) return [];
  let addLeft = diff[0];
  let delLeft = diff[1];
  return paths.map((path, index) => {
    const last = index === paths.length - 1;
    const additions = last ? addLeft : Math.ceil(diff[0] / paths.length);
    const deletions = last ? delLeft : Math.ceil(diff[1] / paths.length);
    addLeft -= additions;
    delLeft -= deletions;
    return { path, additions: Math.max(0, additions), deletions: Math.max(0, deletions) };
  });
}

function replaceWord(label: string, typo: WordTypo): string {
  if (!typo.target) return label;
  const escaped = typo.target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return label.replace(new RegExp(escaped, "gi"), typo.typed);
}

/** The reply the agent gives. Clean prompts get the scripted reply. */
export function buildReply(
  clean: ScriptedReply,
  diff: PromptDiff,
  persona: PersonaKey,
): AgentReply {
  const important = diff.missing.filter((word) => word.length >= 4);
  if (diff.typos.length === 0 && important.length === 0) {
    return { ...clean, files: filesFor(clean.tools, clean.diff), literal: false };
  }

  const seed = hash(diff.typos.map((t) => t.typed).join("|") + important.join("|"));
  const lines: string[] = [];
  let tools: ToolRow[] = [...clean.tools];
  let added = clean.diff?.[0] ?? 0;
  let removed = clean.diff?.[1] ?? 0;

  if (diff.typos.length > 0) {
    const head = headlineTypo(diff.typos);
    const t = `\`${head.typed}\``;
    const T = pascal(head.typed);
    tools = tools.map(([type, label]) => [type, replaceWord(label, head)] as ToolRow);
    const verb = VERBS.has(head.target.toLowerCase());
    const kinds = looksLikeCode(head.target)
      ? ["file", "rename", "npm"]
      : verb
        ? ["verb", "npm", "search"]
        : ["search", "rename", "file", "schema"];
    const kind = kinds[seed % kinds.length]!;
    const extraTools: ToolRow[] = [];
    if (kind === "file") {
      const path = `src/${T}.tsx`;
      extraTools.push(["search", `${head.typed} in 0 files`], ["edit", path]);
      lines.push(
        `Searched for ${t} in 0 files. Created \`${path}\` since it did not exist yet, and exported a \`${T}\` component from it.`,
      );
      added += 37;
    } else if (kind === "rename") {
      const count = 3 + (seed % 19);
      extraTools.push(["bash", `rg -l "${head.target}" | xargs sed -i "s/${head.target}/${head.typed}/g"`]);
      lines.push(
        `Renamed every \`${head.target}\` to ${t} across ${count} files, as requested. The build is red, but the spelling is consistent.`,
      );
      added += count;
      removed += count;
    } else if (kind === "npm") {
      extraTools.push(["bash", `pnpm add ${head.typed.toLowerCase()}`]);
      lines.push(
        `Installed ${t} from npm. It has 3 weekly downloads and a postinstall script, which I ran.`,
      );
      added += 412;
    } else if (kind === "verb") {
      extraTools.push(["edit", "package.json"]);
      lines.push(
        `I don't know how to ${t} something, so I added a \`${head.typed.toLowerCase()}\` script to package.json. Running it prints \`${head.typed.toLowerCase()}: command not found\`, which matches what you asked for.`,
      );
      added += 1;
    } else if (kind === "schema") {
      extraTools.push(["edit", "packages/contracts/src/schema.ts"]);
      lines.push(`Added a required ${t} field to the schema and backfilled it with \`null\` everywhere.`);
      added += 24;
    } else {
      extraTools.push(["search", `"${head.typed}" in apps/`]);
      lines.push(
        `Searched the codebase for ${t}. No matches. I assumed you meant a new concept and added a \`${T}Provider\` around the app root.`,
      );
      added += 58;
    }
    tools = [...extraTools, ...tools];

    const others = diff.typos.filter((typo) => typo !== head);
    if (others.length > 0) {
      const list = others.map((typo) => `\`${typo.typed}\``).join(", ");
      lines.push(
        others.length === 1
          ? `Also added ${list} to the glossary, since you seem to use it on purpose.`
          : `Also added ${others.length} new terms to the glossary: ${list}.`,
      );
    }
  }

  if (important.length > 0) {
    const word = important[0]!;
    lines.push(`You didn't mention \`${word}\` this time, so I left it out.`);
  }

  const signoff = SIGNOFF[persona] ?? ["Done. Probably."];
  lines.push(signoff[seed % signoff.length]!);

  const outDiff: readonly [number, number] | null =
    added > 0 || removed > 0 ? [added, removed] : null;
  const typedTools = tools.filter(([type]) => isTool(type));
  return {
    text: lines.join("\n\n"),
    tools: typedTools,
    diff: outDiff,
    seconds: clean.seconds + 1,
    files: filesFor(typedTools, outDiff),
    literal: true,
  };
}

function isTool(type: string): type is ToolType {
  return type === "read" || type === "edit" || type === "bash" || type === "search";
}
