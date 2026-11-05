// Static rebuild of T3 Code's ChatView column: header (ChatHeader,
// WorkspaceBreadcrumb), timeline, and the composer overlay.
import { PanelBottomIcon, PanelRightIcon, SquareMenuIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { personOf } from "~/content/prompts";
import { activeThread, computeStats, isWorking, type GameState } from "~/game/store";
import { cn } from "~/lib/utils";
import { ChatComposer } from "./chat/ChatComposer";
import { MessagesTimeline } from "./chat/MessagesTimeline";
import { EndSummary } from "./EndSummary";
import { ProjectFavicon } from "./ProjectMonogram";
import { Badge } from "./ui/badge";

function BreadcrumbText({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      data-slot="workspace-breadcrumb-text"
      className={cn(
        "block min-w-0 truncate [text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both_cap_alphabetic]:py-1.5",
        className,
      )}
    >
      {children}
    </span>
  );
}

// ui/toggle.tsx, variant ghost, size sm.
const TOGGLE_CLASS =
  "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-transparent font-medium text-base text-foreground outline-none transition-shadow hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:text-sm [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg]:pointer-events-none [&_svg]:shrink-0 h-8 min-w-8 px-[calc(--spacing(1.5)-1px)] sm:h-7 sm:min-w-7";

function LiveStats({ game }: { game: GameState }) {
  const stats = computeStats(game);
  const working = game.threads.filter(isWorking).length;
  return (
    <div
      className="flex shrink-0 items-center gap-3 text-xs tabular-nums text-muted-foreground"
      data-live-stats
      aria-live="off"
    >
      {working > 0 ? (
        <span className="text-info-foreground" title="Agents running now">
          {working} running
        </span>
      ) : null}
      <span title="This prompt while you type, else the last prompt sent here">
        <span className="text-foreground/80" data-stat="live-wpm">
          {stats.liveWpm ?? "-"}
        </span>{" "}
        wpm
      </span>
      <span title="Average over every prompt you sent">
        avg{" "}
        <span className="text-foreground/80" data-stat="wpm">
          {stats.promptsSent > 0 ? stats.wpm : "-"}
        </span>
      </span>
      <span title="Fastest prompt">
        best{" "}
        <span className="text-foreground/80" data-stat="best-wpm">
          {stats.promptsSent > 0 ? stats.bestWpm : "-"}
        </span>
      </span>
      <span title="Accuracy">
        <span className="text-foreground/80" data-stat="accuracy">
          {Math.round(stats.accuracy * 100)}%
        </span>
      </span>
    </div>
  );
}

function ChatHeader({ game }: { game: GameState }) {
  const thread = activeThread(game);
  const person = personOf(thread.def.persona);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
      <nav aria-label="Thread breadcrumb" className="min-w-0 flex-1 overflow-clip [overflow-clip-margin:2px]">
        <ol className="m-0 flex min-w-0 list-none items-center gap-2 p-0 text-sm sm:gap-3">
          <li className="flex min-w-0 shrink-0 items-center font-medium text-muted-foreground">
            <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-sm text-muted-foreground transition-colors hover:text-foreground">
              <ProjectFavicon name={thread.def.project} className="size-3.5" />
              <BreadcrumbText className="max-w-40">{thread.def.project}</BreadcrumbText>
            </span>
          </li>
          <li aria-hidden="true" className="flex shrink-0 items-center text-icon-muted">
            <BreadcrumbText>/</BreadcrumbText>
          </li>
          <li aria-current="page" className="flex min-w-10 flex-1 items-center gap-2 font-medium text-foreground">
            <h2 className="min-w-0" data-thread-title>
              <BreadcrumbText>{thread.def.title}</BreadcrumbText>
            </h2>
            <span className="shrink-0 truncate text-xs font-normal text-muted-foreground">
              as {person.name}
            </span>
            <Badge
              variant="outline"
              size="sm"
              title="Prompts marked real are verbatim and linked to their posts. The rest are parody."
              data-parody-label
            >
              parody
            </Badge>
          </li>
        </ol>
      </nav>
      <LiveStats game={game} />
      <div className="flex shrink-0 items-center gap-1">
        {[
          { label: "Toggle thread details panel", Icon: SquareMenuIcon },
          { label: "Toggle terminal", Icon: PanelBottomIcon },
          { label: "Toggle right panel", Icon: PanelRightIcon },
        ].map(({ label, Icon }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={label}
            tabIndex={-1}
            className={TOGGLE_CLASS}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function ChatView({ game }: { game: GameState }) {
  const thread = activeThread(game);
  const ended = game.session.status === "ended";
  const scrollRef = useRef<HTMLDivElement>(null);
  const turnCount = thread.turns.length;
  const lastDone = thread.turns.at(-1)?.done ?? false;

  // Follow the end of the timeline when the thread changes or a turn lands.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.def.id, turnCount, lastDone, ended]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !isWorking(thread)) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  });

  return (
    <main
      className="relative flex min-w-0 w-full flex-1 flex-col bg-background surface-grain"
      data-slot="sidebar-inset"
    >
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden" data-chat-column>
          <header
            data-chat-header
            className="relative flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center bg-background pl-(--workspace-gutter-start) pr-(--workspace-gutter-end)"
          >
            <ChatHeader game={game} />
          </header>
          <div className="relative flex min-h-0 min-w-0 flex-1">
            <div className="relative flex min-h-0 flex-1 flex-col bg-background">
              <div ref={scrollRef} className="messages-timeline-scroll h-full min-h-0 overflow-y-auto pb-52">
                {ended ? <EndSummary game={game} /> : <MessagesTimeline thread={thread} now={game.now} />}
              </div>
            </div>
            <div
              data-chat-composer-overlay="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 z-20 pt-1.5 sm:pt-2"
            >
              <div className="chat-composer-lane w-full pb-3">
                <div
                  data-chat-composer-stack="true"
                  className="group/composer-stack pointer-events-auto relative z-10 mx-auto w-full max-w-(--chat-content-max-width)"
                >
                  <div className="relative z-10">
                    <ChatComposer game={game} thread={thread} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
