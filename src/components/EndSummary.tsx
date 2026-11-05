import { CircleCheckIcon, ClockIcon, KeyboardIcon, RotateCcwIcon } from "lucide-react";
import { computeStats, restart, type GameState } from "~/game/store";
import { formatDuration } from "~/lib/time";
import { ChatMarkdown } from "./chat/MessagesTimeline";
import { Button } from "./ui/button";

function verdict(stats: ReturnType<typeof computeStats>): string {
  if (stats.promptsSent === 0) return "No prompts sent. The agents enjoyed the quiet.";
  return `You sent ${stats.promptsSent === 1 ? "one clean prompt" : `${stats.promptsSent} clean prompts`}.`;
}

export function EndSummary({ game }: { game: GameState }) {
  const stats = computeStats(game);
  const rows = [
    { label: "Prompts sent", value: String(stats.promptsSent), key: "prompts" },
    { label: "Average speed", value: `${stats.wpm} wpm`, key: "wpm" },
    { label: "Fastest prompt", value: stats.best ? `${stats.best.wpm} wpm in ${stats.best.thread}` : "-", key: "best" },
    { label: "Accuracy", value: `${Math.round(stats.accuracy * 100)}%`, key: "accuracy" },
    { label: "Threads finished", value: `${stats.threadsDone} of ${game.threads.length}`, key: "threads" },
  ];
  return (
    <div className="chat-content-lane overflow-x-clip" data-end-summary>
      <div className="h-3 sm:h-4" />
      <div className="pb-1.5">
        <div className="border-b border-border/60 pb-2 pe-0.5 pt-1">
          <div className="flex items-center gap-1 px-1 text-sm leading-relaxed text-muted-foreground tabular-nums">
            All threads done in {formatDuration(stats.elapsedMs)}
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
          <p className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <KeyboardIcon className="size-3.5" /> Enter plays again
            </span>
            <span className="inline-flex items-center gap-1">
              <ClockIcon className="size-3.5" /> Each prompt is timed from its first key to its last
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
