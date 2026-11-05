import { type CxOptions, cx } from "class-variance-authority";
import { extendTailwindMerge } from "tailwind-merge";

// Same as T3 Code: register the extra font sizes so text-2xs is not read as a color.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["2xs", "3xs", "4xs", "5xs"] } },
});

export function cn(...inputs: CxOptions) {
  return twMerge(cx(inputs));
}

export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}
