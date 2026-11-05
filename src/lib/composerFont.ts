import { useSyncExternalStore } from "react";

export const COMPOSER_FONT_DEFAULT = 20;
export const COMPOSER_FONT_MIN = 14;
export const COMPOSER_FONT_MAX = 32;
export const COMPOSER_FONT_STEP = 2;
const STORAGE_KEY = "t3type.composerFontPx";

export function clampComposerFont(px: number): number {
  if (!Number.isFinite(px)) return COMPOSER_FONT_DEFAULT;
  return Math.min(COMPOSER_FONT_MAX, Math.max(COMPOSER_FONT_MIN, Math.round(px)));
}

function readStored(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? COMPOSER_FONT_DEFAULT : clampComposerFont(Number(raw));
  } catch {
    return COMPOSER_FONT_DEFAULT;
  }
}

let current = typeof window === "undefined" ? COMPOSER_FONT_DEFAULT : readStored();
const listeners = new Set<() => void>();

export function stepComposerFont(direction: 1 | -1) {
  const next = clampComposerFont(current + direction * COMPOSER_FONT_STEP);
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {}
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useComposerFont(): number {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => COMPOSER_FONT_DEFAULT,
  );
}
