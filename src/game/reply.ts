import type { LineCounts, ScriptedReply, ToolRow } from "~/content/prompts";

export interface AgentReply extends ScriptedReply {
  files: { path: string; additions: number; deletions: number }[];
}

function filesFor(tools: ToolRow[], diff: LineCounts | null) {
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

export function buildReply(scripted: ScriptedReply): AgentReply {
  return { ...scripted, files: filesFor(scripted.tools, scripted.diff) };
}
