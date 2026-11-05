// Helpers for automated play-testing. Usage in a script:
//   import { withGame, typeText } from "./lib.mjs";
//   await withGame("flame-graph", { seed: 1 }, async (page) => { ... });
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const outDir = path.join(root, "tests/out");
mkdirSync(outDir, { recursive: true });

export async function startServer(port = 5000 + Math.floor(Math.random() * 3000)) {
  const proc = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: root, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  return { url: `http://127.0.0.1:${port}`, stop: () => proc.kill() };
}

export async function withGame(game, { seed = 1, viewport = { width: 1100, height: 900 } } = {}, fn) {
  const server = await startServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  try {
    await page.goto(`${server.url}/games/${game}/index.html?seed=${seed}`);
    await page.waitForTimeout(200);
    await fn(page, { errors, shot: (name) => page.screenshot({ path: path.join(outDir, `${game}-${name}.png`), fullPage: true }) });
  } finally {
    await browser.close();
    server.stop();
  }
  return errors;
}

// Types text with a per-key delay. typoRate inserts a wrong key then fixes it.
// slowWords: {word: extraMsPerChar} to simulate hesitation on specific words.
export async function typeText(page, text, { delay = 40, typoRate = 0, fix = true, slowWords = {} } = {}) {
  const words = text.split(" ");
  for (let wi = 0; wi < words.length; wi++) {
    const w = words[wi] + (wi < words.length - 1 ? " " : "");
    const extra = slowWords[words[wi]] || 0;
    for (const c of w) {
      if (typoRate && Math.random() < typoRate && c !== " ") {
        await page.keyboard.press(c === "x" ? "z" : "x");
        if (fix) await page.keyboard.press("Backspace");
      }
      await page.keyboard.type(c, { delay: delay + extra });
    }
  }
}

export const state = (page) => page.evaluate(() => window.__game?.state());
