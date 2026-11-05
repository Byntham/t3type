import { PanelLeftCloseIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./ui/button";

export function AppSidebarLayout({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div
      className="group/sidebar-wrapper flex h-dvh! min-h-0! w-full max-sm:[--workspace-titlebar-control-size:--spacing(8)]"
      data-sidebar-state="expanded"
      data-slot="sidebar-wrapper"
      data-panel-animations="false"
      style={{ "--sidebar-width": "16rem" } as React.CSSProperties}
    >
      <div
        className="group peer hidden text-sidebar-foreground md:block"
        data-collapsible=""
        data-side="left"
        data-slot="sidebar"
        data-state="expanded"
        data-variant="sidebar"
      >
        <div className="relative w-(--sidebar-width) bg-transparent" data-slot="sidebar-gap" />
        <div
          className="fixed inset-y-0 left-0 z-10 hidden h-svh w-(--sidebar-width) md:flex group-data-[side=left]:border-r"
          data-slot="sidebar-container"
          data-app-sidebar=""
          role="navigation"
          aria-label="Threads"
        >
          <div
            className="flex h-full w-full flex-col bg-sidebar surface-grain"
            data-sidebar="sidebar"
            data-slot="sidebar-inner"
          >
            {sidebar}
          </div>
        </div>
      </div>
      {children}
      <div
        className="pointer-events-none fixed left-[var(--workspace-controls-left)] top-[var(--workspace-controls-top)] z-50 ml-px flex h-[var(--workspace-topbar-height)] items-center"
        data-sidebar-control=""
      >
        <Button
          size="icon"
          variant="ghost"
          aria-label="Toggle main sidebar"
          aria-pressed
          tabIndex={-1}
          className="pointer-events-auto size-[var(--workspace-titlebar-control-size)]!"
          data-sidebar="trigger"
        >
          <PanelLeftCloseIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}
