// Static rebuild of T3 Code's chat timeline rows: TimelineUserMessageRow,
// TimelineAssistantRows, WorkLog, TimelineWorkGroupRows and ChangedFilesTree.
// Class strings are kept from the source.
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  EyeIcon,
  FileDiffIcon,
  FileIcon,
  HammerIcon,
  SearchIcon,
  SquarePenIcon,
  TerminalIcon,
} from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import { personOf, sourceAuthor, type ToolRow, type ToolType } from "~/content/prompts";
import type { ThreadState, Turn } from "~/game/store";
import { formatDuration, formatTimeOfDay, formatWorkingDurationLabel } from "~/lib/time";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

// Inline markdown: paragraphs, `code` and **bold**. Enough for scripted replies.
function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 1 ? (
          <code key={index}>{part.slice(1, -1)}</code>
        ) : part.startsWith("**") && part.endsWith("**") ? (
          <strong key={index}>{part.slice(2, -2)}</strong>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export function ChatMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={cn(
        "chat-markdown w-full min-w-0 [overflow-wrap:anywhere] [word-break:break-word]",
        "text-sm leading-relaxed text-foreground/[calc(90%+var(--appearance-contrast-boost)/10)]",
        className,
      )}
    >
      {text.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index}>
          <InlineMarkdown text={paragraph} />
        </p>
      ))}
    </div>
  );
}

// User message

function TypedWithTypos({ turn }: { turn: Turn }) {
  const typoWords = new Set(turn.diff.typos.map((typo) => typo.typed.toLowerCase()));
  const pieces = turn.typed.split(/(\s+)/);
  return (
    <>
      {pieces.map((piece, index) => {
        const bare = piece.replace(/^[^\p{L}\p{N}@`$/._-]+|[^\p{L}\p{N}`/_-]+$/gu, "").toLowerCase();
        return typoWords.has(bare) && bare.length > 0 ? (
          <span
            key={index}
            className="underline decoration-error-foreground/70 decoration-wavy decoration-1 underline-offset-[3px]"
            title="The agent took this literally"
          >
            {piece}
          </span>
        ) : (
          <Fragment key={index}>{piece}</Fragment>
        );
      })}
    </>
  );
}

function PromptSource({ turn, thread }: { turn: Turn; thread: ThreadState }) {
  const prompt = turn.prompt;
  const person = personOf(thread.def.persona);
  if (prompt.kind === "parody") {
    return (
      <p className="me-1 text-2xs text-muted-foreground/70" data-prompt-kind="parody">
        Parody of {person.name}
      </p>
    );
  }
  const author = sourceAuthor(prompt) ?? person.handle;
  return (
    <p
      className="me-1 flex max-w-[80%] flex-wrap justify-end gap-x-1 text-right text-2xs text-muted-foreground/70"
      data-prompt-kind="real"
    >
      {prompt.credit ? <span>{prompt.credit}.</span> : null}
      <span>
        Real prompt by{" "}
        <a
          href={prompt.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="text-info-foreground hover:underline"
          onMouseDown={(event) => event.preventDefault()}
        >
          {author}
        </a>
      </span>
    </p>
  );
}

function UserMessageRow({ turn, thread }: { turn: Turn; thread: ThreadState }) {
  return (
    <div className="group @container flex flex-col items-end gap-1" data-user-message>
      <div className="relative min-w-0 max-w-[80%] rounded-2xl bg-message p-3 text-message-foreground">
        <h3 className="sr-only select-none">You</h3>
        <div className="chat-markdown w-full min-w-0 text-sm leading-relaxed whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
          <p>
            <TypedWithTypos turn={turn} />
          </p>
        </div>
      </div>
      <div className="flex max-w-[80%] flex-wrap items-baseline justify-end gap-x-2">
        <PromptSource turn={turn} thread={thread} />
        <p className="me-1 text-2xs tabular-nums text-muted-foreground" data-prompt-result>
          <span className="text-foreground/80">{turn.result.wpm} wpm</span> · {Math.round(turn.result.accuracy * 100)}%
        </p>
      </div>
      <div className="flex w-full max-w-[80%] items-center justify-end pe-1 text-xs tabular-nums opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <p className="text-muted-foreground text-xs tabular-nums">{formatTimeOfDay(turn.startedAt)}</p>
      </div>
    </div>
  );
}

// Work log

const TOOL_ICON: Record<ToolType, typeof EyeIcon> = {
  read: EyeIcon,
  edit: SquarePenIcon,
  bash: TerminalIcon,
  search: SearchIcon,
};

function toolLabel([type, label]: ToolRow): ReactNode {
  switch (type) {
    case "read":
      return <>Read {label}</>;
    case "edit":
      return <>{label}</>;
    case "bash":
      return <>{label}</>;
    case "search":
      return <>Searched {label}</>;
  }
}

/** summarizeToolGroup from T3 Code's client-runtime work-log presentation. */
export function summarizeTools(tools: ToolRow[]): string {
  const order: ToolType[] = [];
  const counts = new Map<ToolType, number>();
  for (const [type] of tools) {
    if (!counts.has(type)) order.push(type);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const label = (type: ToolType, count: number) =>
    type === "read"
      ? `Read ${count} ${count === 1 ? "file" : "files"}`
      : type === "edit"
        ? `Changed ${count} ${count === 1 ? "file" : "files"}`
        : type === "bash"
          ? `Ran ${count} ${count === 1 ? "command" : "commands"}`
          : `Searched code ${count} ${count === 1 ? "time" : "times"}`;
  const selected = order.slice(0, 2);
  const labels = selected.map((type) => label(type, counts.get(type)!));
  const remaining = tools.length - selected.reduce((sum, type) => sum + counts.get(type)!, 0);
  if (remaining > 0) labels.push(`Performed ${remaining} other ${remaining === 1 ? "action" : "actions"}`);
  const sentence = labels.map((l, i) => (i === 0 ? l : l.charAt(0).toLowerCase() + l.slice(1)));
  return sentence.length < 3
    ? sentence.join(" and ")
    : `${sentence.slice(0, -1).join(", ")}, and ${sentence.at(-1)}`;
}

function WorkLogLine({ icon, label, trailing }: { icon?: ReactNode; label: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex min-h-6 min-w-0 items-center gap-1.5 text-sm leading-relaxed select-none [&_*]:select-none">
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
        {icon ? (
          <span className="relative w-6 shrink-0 leading-0">
            <span className="inline-block size-6 overflow-hidden align-[calc(0.5cap_-_0.75rem)]">
              <span className="flex size-full items-center justify-center">{icon}</span>
            </span>
          </span>
        ) : null}
        <div className="min-w-0 flex-1 truncate text-secondary-label [&_*]:whitespace-nowrap">{label}</div>
      </div>
      {trailing}
    </div>
  );
}

function WorkEntryRow({
  tool,
  active = false,
  grouped = false,
  stat,
}: {
  tool: ToolRow;
  active?: boolean;
  grouped?: boolean;
  stat?: { additions: number; deletions: number } | undefined;
}) {
  const Icon = TOOL_ICON[tool[0]];
  return (
    <div
      className={cn(
        "group/timeline-row relative w-full min-w-0 rounded-md px-0.5 text-left transition-colors",
        grouped ? "py-0" : "py-0.5",
      )}
      data-work-entry={tool[0]}
    >
      <WorkLogLine
        icon={
          <span className="flex size-4 items-center justify-center text-icon-muted">
            <Icon aria-hidden className="block size-4 shrink-0 stroke-2" />
          </span>
        }
        label={<span className={cn("block truncate", active && "live-tool-shine")}>{toolLabel(tool)}</span>}
        trailing={
          <>
            {stat ? <DiffStatLabel {...stat} layout="inline" className="text-xs" /> : null}
            <span className={cn("flex size-4 shrink-0 items-center justify-center", active && "invisible")} aria-hidden>
              <ChevronRightIcon className="size-3 shrink-0 text-icon-muted opacity-70 transition-transform duration-200" />
            </span>
          </>
        }
      />
    </div>
  );
}

function DiffStatLabel({
  additions,
  deletions,
  className,
  layout = "aligned",
}: {
  additions: number;
  deletions: number;
  className?: string;
  layout?: "aligned" | "inline";
}) {
  return (
    <span
      role="group"
      aria-label={`${additions} additions, ${deletions} deletions`}
      className={cn(
        layout === "inline"
          ? "inline-flex items-center gap-1 tabular-nums align-middle"
          : "inline-grid grid-cols-[4ch_4ch] gap-2 text-right tabular-nums align-middle",
        className,
      )}
    >
      <span aria-hidden="true" className="font-mono text-diff-addition-foreground">
        +{additions}
      </span>
      <span aria-hidden="true" className="font-mono text-diff-deletion-foreground">
        -{deletions}
      </span>
    </span>
  );
}

function ChangedFilesCard({ turn }: { turn: Turn }) {
  const files = turn.reply.files;
  if (files.length === 0 || !turn.reply.diff) return null;
  const [additions, deletions] = turn.reply.diff;
  return (
    <div className="@container/changed-files mt-4 rounded-lg bg-secondary dark:bg-input/20" data-changed-files>
      <div className="sticky top-2 z-10 flex items-center justify-between gap-2 rounded-t-lg bg-secondary px-3 py-2 dark:bg-background dark:bg-linear-to-b dark:from-input/20 dark:to-input/20">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-foreground">
          <span>
            {files.length} changed file{files.length === 1 ? "" : "s"}
          </span>
          <DiffStatLabel additions={additions} deletions={deletions} layout="inline" className="text-xs leading-4" />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="icon-xs" variant="ghost-muted" aria-label="Collapse all folders" tabIndex={-1}>
            <ChevronsDownUpIcon className="size-3" />
          </Button>
          <Button size="xs" variant="ghost-muted" aria-label="Open diff" tabIndex={-1}>
            <FileDiffIcon className="size-3" />
            <span className="hidden @[24rem]/changed-files:inline">Open diff</span>
          </Button>
        </div>
      </div>
      <div className="p-2">
        {files.map((file) => (
          <div
            key={file.path}
            className="group flex h-7 w-full cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 text-left transition-colors hover:bg-accent/60"
            style={{ paddingLeft: 8 }}
          >
            <span aria-hidden="true" className="size-3.5 shrink-0" />
            <FileIcon className="size-3.5 text-muted-foreground/70" />
            <span className="flex min-w-0 font-mono text-xs text-foreground/85 group-hover:text-foreground">
              <span className="truncate">{file.path}</span>
            </span>
            <span className="ml-auto shrink-0 font-mono text-3xs tabular-nums">
              <DiffStatLabel additions={file.additions} deletions={file.deletions} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TurnFoldRow({
  label,
  expanded,
  onToggle,
  time,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  time: number;
}) {
  const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon;
  return (
    <div className="group/timeline-row border-b border-border/60 pb-2 pe-0.5 pt-1" data-turn-fold>
      <div className="relative flex items-center gap-1">
        <button
          type="button"
          aria-expanded={expanded}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onToggle}
          className="flex cursor-pointer select-none items-center gap-1 rounded-md px-1 text-sm leading-relaxed text-muted-foreground tabular-nums transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
        >
          <span>{label}</span>
          <Chevron className="size-3.5" />
        </button>
        <span className="pointer-events-none absolute me-1 ms-auto shrink-0 whitespace-nowrap rounded-md text-muted-foreground text-xs tabular-nums opacity-0 group-hover/timeline-row:pointer-events-auto group-hover/timeline-row:static group-hover/timeline-row:opacity-100">
          {formatTimeOfDay(time)}
        </span>
      </div>
    </div>
  );
}

function WorkGroupToggle({
  tools,
  expanded,
  onToggle,
  time,
}: {
  tools: ToolRow[];
  expanded: boolean;
  onToggle: () => void;
  time?: number;
}) {
  const kinds = new Set(tools.map(([type]) => type));
  const Icon = kinds.size === 1 ? TOOL_ICON[tools[0]![0]] : HammerIcon;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggle}
      className="group/timeline-row relative w-full min-w-0 cursor-pointer rounded-md px-0.5 py-0.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
    >
      <WorkLogLine
        icon={<Icon aria-hidden className="size-4 shrink-0 stroke-2 text-icon-muted" />}
        label={<span className="block truncate">{summarizeTools(tools)}</span>}
        trailing={
          time !== undefined ? (
            <span className="pointer-events-none absolute me-1 shrink-0 whitespace-nowrap rounded-md text-muted-foreground text-xs tabular-nums opacity-0 group-hover/timeline-row:pointer-events-auto group-hover/timeline-row:static group-hover/timeline-row:opacity-100">
              {formatTimeOfDay(time)}
            </span>
          ) : null
        }
      />
    </button>
  );
}

function fileStat(turn: Turn, tool: ToolRow) {
  if (tool[0] !== "edit") return undefined;
  return turn.reply.files.find((file) => file.path === tool[1]);
}

function TurnRows({
  turn,
  thread,
  now,
}: {
  turn: Turn;
  thread: ThreadState;
  now: number;
}) {
  const [foldOverride, setFoldOverride] = useState<boolean | null>(null);
  const [groupOverride, setGroupOverride] = useState<boolean | null>(null);
  const tools = turn.reply.tools;
  const elapsed = Math.max(0, now - turn.startedAt);

  if (!turn.done) {
    // Live: "Working for" sits under the prompt, finished tools fold into one
    // summary row, and the tool in flight shines below it.
    const step = turn.durationMs / (tools.length + 1);
    const revealed = tools.filter((_, index) => elapsed >= step * (index + 0.4));
    const finished = revealed.slice(0, -1);
    const live = revealed.at(-1);
    return (
      <>
        <div className="pb-4">
          <UserMessageRow turn={turn} thread={thread} />
        </div>
        <div className="pb-1.5" data-working-row>
          <div className="border-b border-border/60 pb-2 pt-1">
            <div className="flex h-6 min-w-0 items-baseline gap-2 px-1 text-sm leading-relaxed text-muted-foreground tabular-nums">
              <span className="relative shrink-0 overflow-hidden whitespace-nowrap">
                Working for <span className="tabular-nums">{formatWorkingDurationLabel(elapsed)}</span>
              </span>
            </div>
          </div>
        </div>
        {revealed.length > 0 ? (
          <div className="pb-2">
            {finished.length > 0 ? (
              <WorkGroupToggle
                tools={finished}
                expanded={groupOverride ?? false}
                onToggle={() => setGroupOverride(!(groupOverride ?? false))}
              />
            ) : null}
            {groupOverride && finished.length > 0 ? (
              <div className="flex min-w-0 flex-col">
                {finished.map((tool, index) => (
                  <WorkEntryRow key={index} tool={tool} grouped stat={fileStat(turn, tool)} />
                ))}
              </div>
            ) : null}
            {live ? <WorkEntryRow tool={live} active /> : null}
          </div>
        ) : null}
      </>
    );
  }

  // T3 Code folds a finished turn's work under "Worked for" by default.
  // Opening the fold shows the tool group expanded.
  const foldExpanded = foldOverride ?? false;
  const groupExpanded = groupOverride ?? true;
  return (
    <>
      <div className="pb-4">
        <UserMessageRow turn={turn} thread={thread} />
      </div>
      <div className="pb-1.5">
        <TurnFoldRow
          label={`Worked for ${formatDuration(turn.durationMs)}`}
          expanded={foldExpanded}
          onToggle={() => setFoldOverride(!foldExpanded)}
          time={turn.startedAt}
        />
      </div>
      {foldExpanded && tools.length > 0 ? (
        <div className="pb-2">
          {tools.length > 1 ? (
            <WorkGroupToggle
              tools={tools}
              expanded={groupExpanded}
              onToggle={() => setGroupOverride(!groupExpanded)}
              time={turn.startedAt + turn.durationMs}
            />
          ) : null}
          {tools.length === 1 || groupExpanded ? (
            <div className="flex min-w-0 flex-col">
              {tools.map((tool, index) => (
                <WorkEntryRow key={index} tool={tool} grouped stat={fileStat(turn, tool)} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="group/assistant pb-4" data-assistant-message data-literal={turn.reply.literal || undefined}>
        <div className="relative min-w-0 px-1 py-0.5">
          <h3 className="sr-only select-none">T3 Code</h3>
          <ChatMarkdown text={turn.reply.text} />
          <ChangedFilesCard turn={turn} />
          <div className="mt-1.5 flex items-center gap-2 text-xs tabular-nums opacity-0 transition-opacity duration-200 group-hover/assistant:opacity-100">
            <p className="text-muted-foreground text-xs tabular-nums">
              {formatTimeOfDay(turn.startedAt + turn.durationMs)}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

export function MessagesTimeline({ thread, now }: { thread: ThreadState; now: number }) {
  if (thread.turns.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 pb-40">
        <p className="text-sm text-muted-foreground">Send a message to start the conversation.</p>
        <p className="text-xs text-muted-foreground/70">
          Type the gray prompt below. Enter sends it, typos included.
        </p>
      </div>
    );
  }
  return (
    <div className="chat-content-lane overflow-x-clip" data-timeline-root="true">
      <div className="h-3 sm:h-4" />
      {thread.turns.map((turn) => (
        <TurnRows
          key={turn.id}
          turn={turn}
          thread={thread}
          now={now}
        />
      ))}
    </div>
  );
}
