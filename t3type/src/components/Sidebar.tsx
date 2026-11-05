// Static rebuild of T3 Code's thread sidebar (components/Sidebar.tsx,
// components/sidebar/SidebarChrome.tsx, SidebarThreadHeader.tsx,
// SidebarThreadRow.tsx, SidebarListMarkers.tsx). This is the default layout:
// card rows plus the Working and Settled shelves. Class strings are kept.
import {
  ChartNoAxesColumnIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  FolderPlusIcon,
  GitPullRequestIcon,
  ListFilterIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { projectOrder, threadBranch, threadProvider } from "~/content/prompts";
import {
  awaitingInput,
  isSettled,
  isWorking,
  selectThread,
  type GameState,
  type ThreadState,
} from "~/game/store";
import { compactSidebarTimeLabel, formatRelativeElapsed, formatWorkingDurationLabel } from "~/lib/time";
import { cn } from "~/lib/utils";
import { ClaudeAI, OpenAI, T3Wordmark } from "./Icons";
import { ProjectFavicon } from "./ProjectMonogram";

const sidebarMenuButton =
  "peer/menu-button flex w-full cursor-pointer items-center gap-[var(--sidebar-control-gap)] overflow-hidden text-left outline-hidden ring-ring transition-[width,height,padding] hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset active:bg-sidebar-row-active active:text-sidebar-foreground [&>span:last-child]:truncate [&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0 [&>svg]:text-[var(--sidebar-icon-color)] hover:[&>svg]:text-sidebar-foreground font-medium text-sidebar-muted-foreground/80";
const sidebarMenuButtonIcon = "size-8 justify-center rounded-[var(--control-radius)] p-0";

function SidebarBrand() {
  return (
    <a
      aria-label="T3 Code home"
      href="#"
      onClick={(event) => event.preventDefault()}
      className="relative z-10 ml-[var(--workspace-titlebar-content-left)] hidden h-7 w-fit min-w-0 shrink-0 items-center overflow-hidden rounded-md text-foreground outline-hidden ring-ring focus-visible:ring-2 focus-visible:ring-inset md:flex"
    >
      <span className="inline-flex min-w-0 items-baseline gap-1 text-sm font-medium tracking-tight">
        <T3Wordmark aria-label="T3" className="h-[1cap] w-auto shrink-0" />
        <span className="truncate text-muted-foreground [text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both_cap_alphabetic]:py-1">
          Code
        </span>
      </span>
    </a>
  );
}

function HeaderIconButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      tabIndex={-1}
      className={cn(sidebarMenuButton, sidebarMenuButtonIcon, "relative size-7 shrink-0")}
    >
      {children}
    </button>
  );
}

function SidebarThreadHeader() {
  return (
    <div className="flex items-center gap-1">
      <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground">
        <SearchIcon className="size-4 shrink-0 text-(--sidebar-icon-color)" />
        <span className="min-w-0 flex-1 truncate leading-normal text-sidebar-muted-foreground">
          Search
        </span>
      </div>
      <div className="flex shrink-0 items-center">
        <HeaderIconButton label="Filter projects">
          <ListFilterIcon />
        </HeaderIconButton>
        <HeaderIconButton label="Add project">
          <FolderPlusIcon />
        </HeaderIconButton>
        <HeaderIconButton label="New thread">
          <SquarePenIcon />
        </HeaderIconButton>
      </div>
    </div>
  );
}

function ProviderIcon({ thread }: { thread: ThreadState }) {
  const Icon = threadProvider(thread.def) === "claude" ? ClaudeAI : OpenAI;
  return <Icon aria-hidden className="size-3.5 shrink-0" />;
}

function ThreadRow(props: { thread: ThreadState; isActive: boolean; now: number }) {
  const { thread, isActive } = props;
  const working = isWorking(thread);
  const lastTurn = thread.turns.at(-1);
  const hasUnsentDraft = !isActive && thread.draft.length > 0;
  // Same status ladder as SidebarThreadRow: working, then unseen completion.
  const topStatus = working
    ? { label: "Working", Icon: CircleDashedIcon, className: "text-info-foreground" }
    : thread.unread
      ? { label: "Done", Icon: CircleCheckIcon, className: "text-success-foreground" }
      : null;
  // shouldRecedeSidebarThread: idle threads that were already read step back.
  const shouldRecede = !isActive && (working || !thread.unread);
  const diff = thread.turns.reduce(
    (sum, turn) =>
      turn.done && turn.reply.diff
        ? { add: sum.add + turn.reply.diff[0], del: sum.del + turn.reply.diff[1] }
        : sum,
    { add: 0, del: 0 },
  );
  const rowSurfaceClassName = cn(
    "group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    isActive
      ? "bg-sidebar-row-active text-sidebar-foreground light:ring-1 light:ring-inset light:ring-sidebar-border/70"
      : shouldRecede
        ? "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
        : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
    shouldRecede &&
      working &&
      "opacity-70 transition-opacity hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none",
  );
  const timeLabel = compactSidebarTimeLabel(formatRelativeElapsed(props.now - thread.updatedAt));
  const rowRef = useRef<HTMLLIElement>(null);
  // revealActiveRow: keep the open thread visible when it moves between shelves.
  useEffect(() => {
    if (isActive) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isActive, working]);
  return (
    <li
      ref={rowRef}
      data-thread-item={thread.def.id}
      className="list-none py-0.5 [content-visibility:auto] [contain-intrinsic-size:auto_78px]"
    >
      <div
        role="button"
        tabIndex={-1}
        data-sidebar-row={thread.def.id}
        data-testid="sidebar-row-card"
        data-status={
          working ? "working" : thread.unread ? "done" : awaitingInput(thread) ? "ready" : "complete"
        }
        aria-current={isActive ? "page" : undefined}
        aria-label={`${thread.def.title}${topStatus ? `, ${topStatus.label}` : ""}`}
        className={rowSurfaceClassName}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => selectThread(thread.def.id)}
      >
        <div className="relative z-10 h-[4.875rem] px-(--sidebar-row-content-inset) py-(--sidebar-content-inset)">
          <div className="flex h-5 min-w-0 items-center gap-1.5">
            {hasUnsentDraft ? (
              <span role="img" aria-label="Unsent draft" className="inline-flex shrink-0 items-center">
                <SquarePenIcon aria-hidden className="size-3 shrink-0 text-warning-foreground" />
              </span>
            ) : null}
            <ProjectFavicon name={thread.def.project} className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate font-normal text-secondary-label text-xs">
              {thread.def.project}
            </span>
            <span className="group/sidebar-status-slot relative ml-auto flex h-5 min-w-8 shrink-0 items-stretch justify-end text-xs">
              <span className="flex items-center self-center justify-self-end tabular-nums text-secondary-label">
                {topStatus ? (
                  <span className={cn("inline-flex items-center gap-1 font-medium", topStatus.className)}>
                    <topStatus.Icon
                      aria-hidden
                      className={cn("size-4 shrink-0", working && "animate-[spin_4s_linear_infinite]")}
                    />
                    {topStatus.label}
                    {working && lastTurn ? (
                      <span aria-hidden className="tabular-nums">
                        {formatWorkingDurationLabel(props.now - lastTurn.startedAt)}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  timeLabel
                )}
              </span>
            </span>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden
              className={cn(
                "min-w-0 flex-1 text-start text-sm transition-opacity motion-reduce:transition-none",
                shouldRecede ? "font-normal" : "font-medium",
                "truncate",
                shouldRecede
                  ? "text-foreground/75 group-hover/sidebar-row:text-foreground"
                  : "text-foreground",
              )}
            >
              {thread.def.title}
            </span>
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-secondary-label text-xs">
            <span className="flex min-w-0 flex-1">
              <span className="truncate">{threadBranch(thread.def)}</span>
            </span>
            {diff.add > 0 || diff.del > 0 ? (
              <span className="shrink-0 font-mono">
                <span className="text-diff-addition-foreground">+{diff.add}</span>{" "}
                <span className="text-diff-deletion-foreground">−{diff.del}</span>
              </span>
            ) : null}
            <span aria-hidden className="pointer-events-none ml-auto inline-flex shrink-0 items-center gap-1">
              <ProviderIcon thread={thread} />
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}

/** SidebarSectionHeader + CollapsibleSectionHeader: "Working 1", "Settled 0". */
function SectionHeader(props: { label: string; count: number; className?: string; testId: string }) {
  return (
    <li className={cn("relative mx-0.5 h-8 list-none", props.className)} data-testid={props.testId}>
      <button
        type="button"
        tabIndex={-1}
        aria-expanded={false}
        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-sidebar-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      >
        <span className="shrink-0">{props.label}</span>
        <span aria-hidden className="invisible h-px min-w-2 flex-1 bg-sidebar-border/50" />
        <span className="font-normal tabular-nums">{props.count}</span>
        <ChevronDownIcon aria-hidden className="size-3 shrink-0 -rotate-90 transition-transform" />
      </button>
    </li>
  );
}

function SidebarUtilityItem({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <li className="group/menu-item relative shrink-0" data-sidebar="menu-item">
      <button
        type="button"
        aria-label={label}
        title={label}
        tabIndex={-1}
        className={cn(sidebarMenuButton, sidebarMenuButtonIcon)}
      >
        {icon}
      </button>
    </li>
  );
}

export function ThreadSidebar({ game }: { game: GameState }) {
  // Default T3 Code sidebar: idle threads up top, running ones on the Working shelf.
  const ordered = projectOrder(game.threads.map((t) => t.def)).flatMap((project) =>
    game.threads.filter((t) => t.def.project === project),
  );
  // Settled threads leave the list, except the open one while navigation moves on.
  const visible = ordered.filter((t) => !isSettled(t) || t.def.id === game.activeId);
  const active = visible.filter((t) => !isWorking(t));
  const workingThreads = visible.filter(isWorking);
  const settledCount = ordered.filter(isSettled).length;
  return (
    <>
      <div className="relative flex h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center gap-2 pr-3">
        <div className="relative z-10 flex h-8 min-w-0 flex-1 flex-wrap content-start items-center gap-x-2 overflow-hidden py-0.5">
          <div className="flex shrink-0 items-center gap-1">
            <SidebarBrand />
          </div>
        </div>
      </div>
      <div className="w-full shrink-0">
        <div
          className="relative z-[1] flex w-full min-w-0 flex-col p-[var(--sidebar-content-inset)]"
          data-sidebar="group"
        >
          <SidebarThreadHeader />
        </div>
      </div>
      <div className="h-auto min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
        <div className="flex min-h-full w-full min-w-0 flex-col" data-sidebar="content">
          <div
            className="relative flex w-full min-w-0 flex-1 flex-col p-[var(--sidebar-content-inset)] pt-0"
            data-sidebar="group"
            role="presentation"
          >
            <ul role="presentation" className="relative flex flex-1 flex-col gap-px">
              {active.map((thread) => (
                <ThreadRow
                  key={thread.def.id}
                  thread={thread}
                  isActive={thread.def.id === game.activeId}
                  now={game.now}
                />
              ))}
              {workingThreads.length > 0 ? (
                <SectionHeader
                  label="Working"
                  count={workingThreads.length}
                  className="mt-auto"
                  testId="sidebar-working-header"
                />
              ) : null}
              {workingThreads.map((thread) => (
                <ThreadRow
                  key={thread.def.id}
                  thread={thread}
                  isActive={thread.def.id === game.activeId}
                  now={game.now}
                />
              ))}
              <SectionHeader
                label="Settled"
                count={settledCount}
                className={cn(workingThreads.length === 0 && "mt-auto")}
                testId="sidebar-settled-header"
              />
            </ul>
          </div>
        </div>
      </div>
      <div
        className="flex flex-col gap-2 px-[var(--sidebar-content-inset)] pt-1 pb-[var(--sidebar-content-inset)]"
        data-sidebar="footer"
      >
        <ul className="flex w-full min-w-0 flex-row items-center gap-1" data-sidebar="menu">
          <SidebarUtilityItem icon={<SettingsIcon />} label="Settings" />
          <SidebarUtilityItem icon={<GitPullRequestIcon />} label="Pull requests" />
          <SidebarUtilityItem icon={<ChartNoAxesColumnIcon />} label="Usage" />
        </ul>
      </div>
    </>
  );
}
