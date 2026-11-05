import { useEffect } from "react";
import { AppSidebarLayout } from "./components/AppSidebarLayout";
import { ChatView } from "./components/ChatView";
import { ThreadSidebar } from "./components/Sidebar";
import {
  backspace,
  cycleThread,
  getState,
  nextWaitingThread,
  restart,
  send,
  typeChar,
  useGame,
} from "./game/store";
import { isMacPlatform } from "./lib/utils";

const isMac = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);

function onKeyDown(event: KeyboardEvent) {
  const mod = isMac ? event.metaKey : event.ctrlKey;
  // thread.next and thread.previous, the same chords as T3 Code (mod+shift+] and mod+shift+[).
  if (mod && event.shiftKey && (event.code === "BracketRight" || event.code === "BracketLeft")) {
    event.preventDefault();
    cycleThread(event.code === "BracketRight" ? 1 : -1);
    return;
  }
  if (event.key === "Tab" && !event.altKey && !mod) {
    event.preventDefault();
    if (event.shiftKey) cycleThread(-1);
    else nextWaitingThread();
    return;
  }
  if (getState().session.status === "ended") {
    if (event.key === "Enter") {
      event.preventDefault();
      restart();
    }
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    if (!event.shiftKey) send();
    return;
  }
  if (event.key === "Backspace") {
    event.preventDefault();
    backspace(isMac ? event.altKey : event.ctrlKey);
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key.length === 1) {
    event.preventDefault();
    typeChar(event.key);
  }
}

export function App() {
  const game = useGame();
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const forced = new URLSearchParams(location.search).get("theme");
    const syncTheme = () => {
      if (!forced) document.documentElement.classList.toggle("dark", media.matches);
    };
    media.addEventListener("change", syncTheme);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      media.removeEventListener("change", syncTheme);
    };
  }, []);
  useEffect(() => {
    document.querySelector<HTMLElement>('[data-testid="composer-editor"]')?.focus({ preventScroll: true });
  }, [game.activeId]);
  return (
    <AppSidebarLayout sidebar={<ThreadSidebar game={game} />}>
      <ChatView game={game} />
    </AppSidebarLayout>
  );
}
