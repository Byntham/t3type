// The end screen, drawn as one more agent turn in the timeline.
import { CircleCheckIcon, ClockIcon, KeyboardIcon, RotateCcwIcon, SpellCheckIcon } from "lucide-react";
import { computeStats, restart, type GameState } from "~/game/store";
import { formatDuration } from "~/lib/time";
import { ChatMarkdown } from "./chat/MessagesTimeline";
import { Button } from "./ui/button";

function verdict(stats: ReturnType<typeof computeStats>): string {
  if (stats.promptsSent === 0) return "No prompts sent. The agents enjoyed the quiet.";
  if (stats.typosLiteral === 0) return "Every prompt was clean. The agents had nothing to misread, which they found disappointing.";
  if (stats.typosLiteral <= 3) return `The agents took ${stats.typosLiteral === 1 ? "one typo" : `${stats.typosLiteral} typos`} literally. Nightly will be fine. Probably.`;
  return `The agents took ${stats.typosLiteral} typos literally and shipped all of them.`;
}

export function EndSummary({ game }: { game: GameState }) {
  const stats = computeStats(game);
  const literal = game.threads
    .flatMap((thread) => thread.turns.flatMap((turn) => turn.diff.typos.map((typo) => ({ typo, thread }))))
    .slice(0, 8);
  const rows = [
    { label: "Prompts sent", value: String(stats.promptsSent), key: "prompts" },
    { label: "Speed", value: `${stats.wpm} wpm`, key: "wpm" },
    { label: "Accuracy", value: `${Math.round(stats.accuracy * 100)}%`, key: "accuracy" },
    { label: "Typos taken literally", value: String(stats.typosLiteral), key: "typos" },
    {
      label: "Parallelism",
      value: `${stats.parallelism.toFixed(1)} agents on average, ${stats.peakAgents} at peak`,
      key: "parallelism",
    },
    { label: "Threads finished", value: `${stats.threadsDone} of ${game.threads.length}`, key: "threads" },
  ];
  return (
    <div className="chat-content-lane overflow-x-clip" data-end-summary>
      <div className="h-3 sm:h-4" />
      <div className="pb-1.5">
        <div className="border-b border-border/60 pb-2 pe-0.5 pt-1">
          <div className="flex items-center gap-1 px-1 text-sm leading-relaxed text-muted-foreground tabular-nums">
            {game.session.endReason === "time" ? "Time is up after" : "All threads done in"}{" "}
            {formatDuration(stats.elapsedMs)}
          </div>
        </div>
      </div>
      <div className="pb-4">
        <div className="relative min-w-0 px-1 py-0.5">
          <ChatMarkdown text={`**Session summary.** ${verdict(stats)}`} />
          <div className="@container/changed-files mt-4 rounded-lg bg-secondary dark:bg-input/20">
            <div className="flex items-center justify-between gap-2 rounded-t-lg bg-secondary px-3 py-2 dark:bg-background dark:bg-linear-to-b dark:from-input/20 dark:to-input/20">
              <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                <CircleCheckIcon className="size-3.5 text-success-foreground" />
                Results
              </div>
              <Button size="xs" variant="ghost-muted" onClick={restart} data-play-again>
                <RotateCcwIcon className="size-3" />
                Play again
              </Button>
            </div>
            <div className="p-2">
              {rows.map((row) => (
                <div
                  key={row.key}
                  data-summary={row.key}
                  className="flex h-7 w-full items-center gap-2 rounded-md py-1.5 pr-2 pl-2 text-left"
                >
                  <span className="text-xs text-muted-foreground">{row.label}</span>
                  <span className="ml-auto font-mono text-xs tabular-nums text-foreground/85">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
          {literal.length > 0 ? (
            <div className="mt-4">
              <p className="px-0.5 pb-1 text-xs font-medium text-muted-foreground">What the agents read</p>
              {literal.map(({ typo, thread }, index) => (
                <div key={index} className="flex min-h-6 min-w-0 items-center gap-1.5 px-0.5 text-sm leading-relaxed">
                  <span className="flex w-6 shrink-0 justify-center">
                    <SpellCheckIcon className="size-4 text-icon-muted" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-secondary-label">
                    <span className="font-mono text-[0.92em] text-error-foreground">{typo.typed}</span> instead of{" "}
                    <span className="font-mono text-[0.92em]">{typo.target}</span>
                    <span className="text-muted-foreground/70"> · {thread.def.title}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <p className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <KeyboardIcon className="size-3.5" /> Enter plays again
            </span>
            <span className="inline-flex items-center gap-1">
              <ClockIcon className="size-3.5" /> Sessions last {formatDuration(game.session.durationMs)}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
