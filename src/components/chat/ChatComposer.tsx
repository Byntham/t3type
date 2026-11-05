import { AArrowDownIcon, AArrowUpIcon, FolderIcon, GitBranchIcon, PaperclipIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { personOf, sourceAuthor, threadBranch, type PromptDef } from "~/content/prompts";
import { isWorking, nextPrompt, type GameState, type ThreadState } from "~/game/store";
import {
  COMPOSER_FONT_MAX,
  COMPOSER_FONT_MIN,
  stepComposerFont,
  useComposerFont,
} from "~/lib/composerFont";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { ComposerControl, ComposerPermissionsChip, ProviderModelPicker } from "./ComposerControls";

const outlineClasses =
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-(--chat-composer-outline) dark:after:inset-shadow-2xs dark:after:inset-shadow-(color:--chat-composer-highlight)";

function Shell({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-shell"
      data-context-row
      className={cn(
        "@container/composer-surface group/composer-surface relative isolate mx-auto w-full max-w-(--chat-content-max-width)",
        "[--chat-composer-glass-surface:var(--card)] [--chat-composer-outline:rgb(0_0_0/8%)]",
        "dark:[--chat-composer-glass-surface:var(--surface-raised)] dark:[--chat-composer-highlight:rgb(255_255_255/3%)] dark:[--chat-composer-outline:color-mix(in_srgb,var(--color-white)_5%,transparent)]",
        className,
      )}
      {...props}
    />
  );
}

function Host({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-host"
      className={cn(
        "relative z-10 w-full rounded-2xl shadow-composer after:z-1 dark:shadow-none",
        "before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-2xl before:bg-(--chat-composer-glass-surface)/(--glass-opacity) before:backdrop-blur-(--glass-blur) before:backdrop-saturate-(--glass-saturation)",
        outlineClasses,
        className,
      )}
      {...props}
    />
  );
}

function Main({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-chat-composer-main-surface="true"
      className={cn("group relative z-10 rounded-2xl p-px", outlineClasses, "after:z-20 after:hidden", className)}
      {...props}
    />
  );
}

function GhostEditor({ draft, target, locked }: { draft: string; target: string; locked: boolean }) {
  const typed = Array.from(draft);
  const goal = Array.from(target);
  const fontPx = useComposerFont();
  return (
    <div
      className="relative flow-root font-sans"
      style={{ fontSize: fontPx }}
      data-testid="composer-editor-root"
    >
      <div
        role="textbox"
        aria-multiline="true"
        aria-label="Message"
        aria-placeholder={target}
        data-testid="composer-editor"
        tabIndex={0}
        className="composer-tiptap -m-1 block max-h-[8lh] min-h-[calc(2lh+--spacing(2))] overflow-y-auto p-1 whitespace-pre-wrap wrap-break-word bg-transparent leading-relaxed text-foreground focus:outline-none"
      >
        {typed.map((ch, index) => {
          const ok = goal[index] === ch;
          return (
            <span
              key={index}
              data-typed={ok ? "ok" : "bad"}
              className={ok ? undefined : "rounded-[2px] bg-error/12 text-error-foreground"}
            >
              {ch === " " && !ok ? "·" : ch}
            </span>
          );
        })}
        {locked ? null : <span className="t3type-caret" aria-hidden />}
        <span className="text-placeholder" data-ghost>
          {goal.slice(typed.length).join("")}
        </span>
      </div>
    </div>
  );
}

function PromptKindLabel({ thread, prompt }: { thread: ThreadState; prompt: PromptDef }) {
  const person = personOf(thread.def.persona);
  if (prompt.kind === "real") {
    const author = sourceAuthor(prompt) ?? person.handle;
    return (
      <span className="truncate text-xs text-muted-foreground" data-prompt-kind="real">
        Real prompt by{" "}
        <a
          href={prompt.sourceUrl}
          target="_blank"
          rel="noreferrer"
          tabIndex={-1}
          className="text-info-foreground hover:underline"
          onMouseDown={(event) => event.preventDefault()}
        >
          {author}
        </a>
        {prompt.credit ? <span className="text-muted-foreground/70"> · {prompt.credit}</span> : null}
      </span>
    );
  }
  return (
    <span className="truncate text-xs text-muted-foreground/80" data-prompt-kind="parody">
      Parody of {person.name} ({person.handle})
    </span>
  );
}

function FontSizeControl() {
  const fontPx = useComposerFont();
  return (
    <div className="flex shrink-0 items-center" data-composer-font-size={fontPx}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Smaller prompt text"
        title="Smaller prompt text"
        tabIndex={-1}
        disabled={fontPx <= COMPOSER_FONT_MIN}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => stepComposerFont(-1)}
      >
        <AArrowDownIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Larger prompt text"
        title="Larger prompt text"
        tabIndex={-1}
        disabled={fontPx >= COMPOSER_FONT_MAX}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => stepComposerFont(1)}
      >
        <AArrowUpIcon />
      </Button>
    </div>
  );
}

function SendButton({ enabled }: { enabled: boolean }) {
  return (
    <span className="inline-flex" title="Send (Enter)">
      <button
        type="submit"
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        className="relative isolate flex h-9 w-9 items-center justify-center overflow-hidden rounded-full shadow-xs transition-all duration-150 enabled:cursor-pointer enabled:inset-shadow-control-highlight hover:scale-105 active:inset-shadow-control-pressed active:shadow-none disabled:pointer-events-none disabled:shadow-none disabled:hover:scale-100 sm:h-8 sm:w-8 [&_svg]:pointer-events-none bg-message-action text-message-action-foreground enabled:shadow-message-action/24 hover:bg-message-action-hover disabled:opacity-64"
        disabled={!enabled}
        aria-label="Send message"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </span>
  );
}

function StopButton() {
  return (
    <span className="inline-flex" title="Interrupt">
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-destructive/90 text-white shadow-xs shadow-destructive/24 inset-shadow-control-highlight transition-colors duration-150 hover:bg-destructive active:inset-shadow-control-pressed active:shadow-none sm:h-8 sm:w-8 [&_svg]:pointer-events-none"
        aria-label="Stop generation"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <rect x="2" y="2" width="8" height="8" rx="1.5" />
        </svg>
      </button>
    </span>
  );
}

function BranchToolbar({ thread }: { thread: ThreadState }) {
  return (
    <div
      data-slot="composer-context-strip"
      className="group/composer-context relative flex w-full items-center gap-2 overflow-x-clip px-2 pt-2 text-muted-foreground gap-1 text-xs font-normal text-foreground/70 dark:text-muted-foreground"
    >
      <div className="flex min-h-7 min-w-10 flex-1 items-center gap-1 sm:min-h-6">
        <ComposerControl size="xs" className="min-w-0 shrink" aria-label="Workspace">
          <FolderIcon className="size-3" />
          <span className="truncate" data-composer-control-label>
            Current checkout
          </span>
        </ComposerControl>
      </div>
      <div className="flex min-w-0 flex-initial items-center gap-1 justify-end">
        <ComposerControl size="xs" className="min-w-0 max-w-full active:scale-100" aria-label="Branch">
          <GitBranchIcon className="size-3 shrink-0" />
          <span className="truncate" data-composer-control-label>
            {threadBranch(thread.def)}
          </span>
        </ComposerControl>
      </div>
      <ComposerPermissionsChip persona={thread.def.persona} />
    </div>
  );
}

export function ChatComposer({ game, thread }: { game: GameState; thread: ThreadState }) {
  const working = isWorking(thread);
  const prompt = nextPrompt(thread);
  const ended = game.session.status === "ended";
  const locked = working || !prompt || ended;
  const placeholder = ended
    ? "Session over. Press Enter to play again."
    : working
      ? "The agent is working. Press Tab to switch to a thread that needs you."
      : prompt
        ? prompt.text
        : "Thread finished. Settling it and moving to the next one.";
  return (
    <Shell>
      <Host>
        <div className="relative z-10">
          <form
            className="mx-auto w-full min-w-0 max-w-(--chat-content-max-width)"
            data-chat-composer-form="true"
            onSubmit={(event) => event.preventDefault()}
          >
            <div className="relative">
              <Main>
                <div data-chat-composer-surface="true" className="rounded-2xl transition-[background-color] duration-200">
                  <div data-chat-composer-body="true" className="relative px-4 pb-2 pt-3.5 sm:pt-4">
                    <div className="relative">
                      <GhostEditor draft={locked ? "" : thread.draft} target={placeholder} locked={locked} />
                    </div>
                  </div>
                  <div
                    data-chat-composer-footer="true"
                    className="flex min-w-0 flex-nowrap items-center overflow-visible px-2 pb-2"
                  >
                    <div className="me-2 flex min-w-0 shrink items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Attach files"
                        title="Attach files"
                        tabIndex={-1}
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        <PaperclipIcon className="translate-y-px" />
                      </Button>
                      {prompt && !locked ? <PromptKindLabel thread={thread} prompt={prompt} /> : null}
                    </div>
                    <div
                      data-chat-composer-actions="right"
                      className="flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-2"
                    >
                      <div
                        data-chat-composer-controls="footer"
                        className="relative flex min-w-0 flex-1 items-center justify-end gap-0.5"
                      >
                        <FontSizeControl />
                        <ProviderModelPicker thread={thread.def} />
                      </div>
                      {working ? <StopButton /> : <SendButton enabled={!locked && thread.draft.trim().length > 0} />}
                    </div>
                  </div>
                </div>
              </Main>
            </div>
          </form>
        </div>
      </Host>
      <div className="min-h-0">
        <div className="relative z-0">
          <div className="pointer-events-auto">
            <BranchToolbar thread={thread} />
          </div>
        </div>
      </div>
    </Shell>
  );
}
