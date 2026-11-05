import { PenLineIcon, ShieldOffIcon } from "lucide-react";
import type { ComponentProps, ComponentType, SVGProps } from "react";
import { threadProvider, type PersonaKey, type ThreadDef } from "~/content/prompts";
import { cn } from "~/lib/utils";
import { providerIcon } from "../Icons";

export type ComposerControlSize = "sm" | "xs";

export function composerControlClassName(size: ComposerControlSize, className?: string) {
  return cn(
    "relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-(--control-radius) border border-transparent text-base outline-none hover:bg-accent data-pressed:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 data-disabled:pointer-events-none data-disabled:opacity-64 [&:active:not([aria-haspopup])]:scale-[0.97] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:-mx-0.5 [&_svg[data-composer-control-icon]]:mx-0",
    "[&_:is([data-composer-control-label],[data-chat-provider-model-picker-label])]:[text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both_cap_alphabetic]:[&_:is([data-composer-control-label],[data-chat-provider-model-picker-label])]:py-1.5",
    size === "xs"
      ? "h-7 gap-1 has-[[data-composer-label]]:gap-1.5 px-1.75 font-normal text-foreground/70 text-sm hover:text-foreground dark:text-muted-foreground sm:h-6 sm:text-xs [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5 [&_svg]:mx-0 [&_svg[data-composer-control-chevron]]:ms-0 [&_svg[data-composer-control-chevron]]:-me-1"
      : "h-7 gap-1.5 px-2 font-medium text-foreground/80 [&_svg:not([class*='text-'])]:text-muted-foreground hover:text-foreground sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4",
    "aria-pressed:bg-accent aria-pressed:text-accent-foreground aria-pressed:hover:bg-accent/80",
    className,
  );
}

export function ComposerControl({
  size = "sm",
  className,
  ...props
}: ComponentProps<"button"> & { size?: ComposerControlSize }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={(event) => event.preventDefault()}
      className={composerControlClassName(size, className)}
      {...props}
    />
  );
}

export function ComposerControlIcon({
  icon: Icon,
  className,
  opticalSize = "default",
  size = "sm",
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  className?: string;
  opticalSize?: "default" | "large";
  size?: ComposerControlSize;
}) {
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "shrink-0",
        size === "xs" ? "size-3" : opticalSize === "large" ? "size-4.5" : "size-4",
        className,
      )}
      data-composer-control-icon
    />
  );
}

function effortBarHeights(count: number, maxBar: number): number[] {
  const step = Math.max(1, Math.round(maxBar / 2 / Math.max(count - 1, 1)));
  return Array.from({ length: count }, (_, index) => maxBar - (count - 1 - index) * step);
}

export function EffortGlyph(props: { count: number; filled: number }) {
  const height = 14;
  const width = 4 * props.count - 2;
  const maxBar = height - 2;
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ width, height }}
      className="shrink-0 text-current"
      data-composer-effort-glyph
      data-composer-control-icon
    >
      {effortBarHeights(props.count, maxBar).map((barHeight, index) => (
        <rect
          key={index}
          x={index * 4}
          y={maxBar - barHeight}
          width={2}
          height={barHeight}
          fill="currentColor"
          opacity={index < props.filled ? 1 : 0.4}
        />
      ))}
    </svg>
  );
}

export function ProviderModelPicker({ thread }: { thread: ThreadDef }) {
  const Icon = providerIcon(threadProvider(thread));
  return (
    <ComposerControl
      aria-label={`${thread.model}, High effort`}
      title={`${thread.model} · High`}
      data-chat-provider-model-picker="true"
      className="group/model-trigger min-w-13 min-w-0 shrink justify-between whitespace-nowrap data-popup-open:bg-accent data-popup-open:text-foreground"
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span data-chat-provider-model-picker-icon className="contents">
          <Icon aria-hidden className="size-4" />
        </span>
        <span className="min-w-0 max-w-56 flex-1 overflow-hidden truncate" data-chat-provider-model-picker-label="true">
          {thread.model}
        </span>
        <span className="-ms-0.5 flex shrink-0 items-center gap-1.5 text-muted-foreground group-hover/model-trigger:text-foreground">
          <EffortGlyph count={4} filled={3} />
        </span>
      </span>
    </ComposerControl>
  );
}

type RuntimeMode = { label: string; description: string; icon: typeof ShieldOffIcon };
const FULL_ACCESS: RuntimeMode = { label: "Full access", description: "Allow commands and edits without prompts.", icon: ShieldOffIcon };
const RUNTIME_MODE: Record<PersonaKey, RuntimeMode> = {
  theo: { label: "Full access", description: "Allow commands and edits without prompts.", icon: ShieldOffIcon },
  julius: {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: PenLineIcon,
  },
  maria: { label: "Full access", description: "Allow commands and edits without prompts.", icon: ShieldOffIcon },
};

export function ComposerPermissionsChip({ persona }: { persona: PersonaKey }) {
  const mode = RUNTIME_MODE[persona] ?? FULL_ACCESS;
  return (
    <ComposerControl
      size="xs"
      aria-label={`Permissions: ${mode.label}`}
      title={`Permissions: ${mode.label}. ${mode.description}`}
      aria-haspopup="menu"
      data-composer-permissions-trigger
    >
      <ComposerControlIcon icon={mode.icon} size="xs" />
      <span data-composer-control-label>{mode.label}</span>
    </ComposerControl>
  );
}
