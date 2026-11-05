import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const shots = join(here, "shots");
mkdirSync(shots, { recursive: true });

let server = null;
let base = process.env.T3TYPE_URL;
if (!base) {
  server = spawn(join(root, "node_modules/.bin/vite"), ["--port", "5180", "--strictPort", "--host", "127.0.0.1"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  base = "http://127.0.0.1:5180/";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("vite did not start")), 20000);
    server.stdout.on("data", (chunk) => {
      if (String(chunk).includes("ready in")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on("exit", (code) => reject(new Error(`vite exited with ${code}`)));
  });
}

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
};

function swapInnerLettersOfLongestWord(text) {
  const words = text.split(" ");
  let best = -1;
  words.forEach((word, index) => {
    if (/^[a-z]{5,}$/i.test(word) && (best < 0 || word.length > words[best].length)) best = index;
  });
  if (best < 0) return text;
  const w = words[best];
  words[best] = w.slice(0, 2) + w[3] + w[2] + w.slice(4);
  return words.join(" ");
}

async function openPage(browser, scheme, query) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  const errors = [];
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${base}?${query}`);
  await page.waitForFunction(() => window.__game !== undefined);
  return { page, errors };
}

const state = (page) => page.evaluate(() => window.__game.state());
const activeOf = (s) => s.threads.find((t) => t.def.id === s.activeId);
const running = (s) => s.threads.filter((t) => t.turns.length > 0 && !t.turns.at(-1).done).length;

async function playFullSessionInDark(browser) {
  const { page, errors } = await openPage(browser, "dark", "speed=2");
  await page.screenshot({ path: join(shots, "dark-start.png") });
  let sent = 0;
  let blockedTypoSends = 0;
  let switchesWhileRunning = 0;
  let midShot = false;
  const deadline = Date.now() + 180_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("session did not end in time");
    const s = await state(page);
    if (s.session.status === "ended") break;
    const thread = activeOf(s);
    const busy = thread.turns.length > 0 && !thread.turns.at(-1).done;
    const prompt = thread.def.prompts[thread.turns.length];
    if (!busy && prompt) {
      const typo = sent % 3 === 1 ? swapInnerLettersOfLongestWord(prompt.text) : prompt.text;
      if (typo !== prompt.text) {
        await page.keyboard.type(typo);
        await page.keyboard.press("Enter");
        if (activeOf(await state(page)).turns.length === thread.turns.length) blockedTypoSends += 1;
        for (let i = 0; i < typo.length; i += 1) await page.keyboard.press("Backspace");
      }
      await page.keyboard.type(prompt.text);
      if (sent === 0) {
        await page.locator("[data-prompt-done]").waitFor();
        await page.screenshot({ path: join(shots, "dark-done.png") });
      }
      await page.keyboard.press("Enter");
      sent += 1;
      const after = await state(page);
      if (running(after) >= 2 && !midShot) {
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(shots, "dark-running.png") });
        midShot = true;
      }
      await page.keyboard.press("Tab");
      const switched = await state(page);
      const previous = switched.threads.find((t) => t.def.id === thread.def.id);
      if (switched.activeId !== thread.def.id && !previous.turns.at(-1).done) switchesWhileRunning += 1;
      continue;
    }
    if (!busy && !prompt && thread.settledAt === null) {
      await page.keyboard.press("Enter");
      continue;
    }
    await page.keyboard.press("Tab");
    const next = await state(page);
    if (next.activeId === s.activeId) await page.waitForTimeout(150);
  }
  const end = await state(page);
  await page.waitForSelector("[data-end-summary]");
  await page.screenshot({ path: join(shots, "dark-end.png") });

  const totalPrompts = end.threads.reduce((sum, t) => sum + t.def.prompts.length, 0);
  check(end.session.endReason === "done", `dark run ends with every thread done (got ${end.session.endReason})`);
  check(end.stats.promptsSent === totalPrompts, `sent all ${totalPrompts} prompts (got ${end.stats.promptsSent})`);
  check(blockedTypoSends >= 3, `Enter did not send a prompt with a typo (${blockedTypoSends} times)`);
  check(switchesWhileRunning >= 5, `switched threads while an agent ran ${switchesWhileRunning} times`);
  check(end.stats.accuracy < 1 && end.stats.accuracy > 0.9, `accuracy is plausible (${(end.stats.accuracy * 100).toFixed(1)}%)`);
  check(end.stats.wpm > 0, `wpm is positive (${end.stats.wpm})`);
  const summary = await page.locator("[data-summary]").allTextContents();
  check(summary.length === 5, `end screen shows ${summary.length} stat rows`);
  check(errors.length === 0, `no console errors in dark run${errors.length ? `: ${errors.join(" | ")}` : ""}`);

  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__game.state().session.status === "ready");
  check(true, "Enter on the end screen starts a new session");
  await page.close();
}

async function checkEnterSettles(browser) {
  const { page, errors } = await openPage(browser, "dark", "speed=4");
  const s0 = await state(page);
  const first = activeOf(s0);
  const lastDone = (id) => {
    const t = window.__game.state().threads.find((x) => x.def.id === id);
    return t.turns.length === 0 || t.turns.at(-1).done;
  };
  for (const prompt of first.def.prompts) {
    await page.waitForFunction(lastDone, first.def.id);
    await page.keyboard.type(prompt.text);
    await page.keyboard.press("Enter");
  }
  await page.waitForFunction(lastDone, first.def.id, { timeout: 20_000 });
  await page.waitForTimeout(3000);
  const waited = await state(page);
  const finished = waited.threads.find((t) => t.def.id === first.def.id);
  check(waited.activeId === first.def.id, "a finished thread stays open until Enter");
  check(finished.settledAt === null, "a finished thread does not settle on its own");
  check((await page.locator("[data-assistant-message]").count()) > 0, "the final reply stays on screen");
  await page.keyboard.press("Enter");
  const s1 = await state(page);
  const settled = s1.threads.find((t) => t.def.id === first.def.id);
  check(settled.settledAt !== null, "Enter settles a finished thread");
  check(s1.activeId !== first.def.id, `Enter moves to the next thread (to ${s1.activeId})`);
  const header = await page.locator('[data-testid="sidebar-settled-header"]').textContent();
  check(/1/.test(header ?? ""), `Settled shelf shows 1 (got "${header?.trim()}")`);
  await page.keyboard.press("Tab");
  check((await state(page)).activeId !== first.def.id, "Tab never returns to a settled thread");
  await page.screenshot({ path: join(shots, "dark-settled.png") });
  check(errors.length === 0, `no console errors in settle run${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await page.close();
}

async function checkPerPromptWpmInLight(browser) {
  const { page, errors } = await openPage(browser, "light", "speed=4");
  const s0 = await state(page);
  const firstId = s0.activeId;
  const first = activeOf(s0).def.prompts[0].text;
  const msPerKeyAt120Wpm = 100;
  const timeAwayMs = 3000;
  const half = Math.floor(first.length / 2);
  await page.keyboard.type(first.slice(0, half), { delay: msPerKeyAt120Wpm });
  await page.keyboard.press("Tab");
  check((await state(page)).activeId !== firstId, "Tab leaves the thread mid-prompt");
  await page.waitForTimeout(timeAwayMs);
  await page.evaluate((id) => window.__game.select(id), firstId);
  await page.keyboard.type(first.slice(half), { delay: msPerKeyAt120Wpm });
  await page.keyboard.press("Enter");
  const s1 = await state(page);
  const result = s1.threads.find((t) => t.def.id === firstId).turns[0].result;
  check(result.wpm >= 90 && result.wpm <= 160, `per-prompt wpm ignores time away (${result.wpm} wpm, expected about 120)`);
  check(result.accuracy === 1, `per-prompt accuracy is 100% for a clean prompt (${result.accuracy})`);
  const shown = await page.locator("[data-prompt-result]").first().textContent();
  check(shown?.includes(`${result.wpm} wpm`), `user message shows its result ("${shown?.trim()}")`);
  await page.keyboard.press("Tab");
  const s2 = await state(page);
  const second = activeOf(s2).def.prompts[0].text;
  await page.keyboard.type(second.slice(0, 30));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(shots, "light-running.png") });
  await page.keyboard.type(second.slice(30));
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (id) => window.__game.state().threads.find((t) => t.def.id === id).turns[0]?.done === true,
    firstId,
    { timeout: 20000 },
  );
  await page.evaluate((id) => window.__game.select(id), firstId);
  await page.waitForSelector("[data-assistant-message]");
  await page.screenshot({ path: join(shots, "light-reply.png") });
  const sources = await page.locator("[data-prompt-kind]").count();
  check(sources > 0, "prompt kind label shows under the user message");
  check((await page.locator("[data-parody-label]").count()) === 1, "parody label shows in the header");
  await page.waitForTimeout(4000);
  const later = await state(page);
  check(later.session.status === "playing", `no session clock: still playing after idling (${later.session.status})`);
  check(later.stats.promptsSent === 2 && later.stats.bestWpm >= result.wpm, `stats track 2 prompts, best ${later.stats.bestWpm} wpm`);
  check(errors.length === 0, `no console errors in light run${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await page.close();
}

async function checkComposerFontSize(browser) {
  const { page, errors } = await openPage(browser, "dark", "speed=4");
  const editorPx = () =>
    page.locator('[data-testid="composer-editor"]').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  check((await editorPx()) === 20, `prompt text defaults to 20px (got ${await editorPx()})`);
  await page.getByRole("button", { name: "Larger prompt text" }).click();
  await page.getByRole("button", { name: "Larger prompt text" }).click();
  check((await editorPx()) === 24, `two clicks on larger give 24px (got ${await editorPx()})`);
  await page.keyboard.type("ab");
  check(activeOf(await state(page)).draft === "ab", "typing still reaches the composer after clicking the size buttons");
  await page.reload();
  await page.waitForFunction(() => window.__game !== undefined);
  check((await editorPx()) === 24, `size survives a reload (got ${await editorPx()})`);
  await page.screenshot({ path: join(shots, "dark-font-24.png") });
  for (let i = 0; i < 20; i += 1) await page.getByRole("button", { name: "Smaller prompt text" }).click({ force: true });
  check((await editorPx()) === 14, `size stops at 14px (got ${await editorPx()})`);
  check(errors.length === 0, `no console errors in font size run${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await page.close();
}

async function checkWordsStayPutWhileTyping(browser) {
  const { page, errors } = await openPage(browser, "dark", "speed=4&seed=1");
  const lineOfEachChar = () =>
    page.locator('[data-testid="composer-editor"]').evaluate((editor) => {
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      const tops = [];
      const range = document.createRange();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let i = 0; i < node.length; i += 1) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          tops.push(Math.round(range.getClientRects()[0]?.top ?? -1));
        }
      }
      return tops;
    });
  const moved = [];
  let wrapped = 0;
  for (let width = 800; width <= 1200; width += 40) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await page.waitForFunction(() => window.__game !== undefined);
    await page.evaluate(() => document.fonts.ready);
    const text = activeOf(await state(page)).def.prompts[0].text;
    const before = await lineOfEachChar();
    if (new Set(before).size > 1) wrapped += 1;
    for (let n = 1; n <= text.length; n += 1) {
      await page.keyboard.type(text[n - 1]);
      const now = await lineOfEachChar();
      const shifted = now.findIndex((top, i) => top !== before[i]);
      if (shifted >= 0) moved.push(`${width}px "${text.slice(0, n).slice(-12)}|" moved "${text.slice(shifted, shifted + 8)}"`);
    }
  }
  const shaping = await page
    .locator('[data-testid="composer-editor"]')
    .evaluate((el) => `${getComputedStyle(el).fontKerning} ${getComputedStyle(el).fontVariantLigatures}`);
  check(shaping === "none none", `composer turns off kerning and ligatures so letters keep their x position (got ${shaping})`);
  check(wrapped >= 5, `prompt wraps at ${wrapped} of 11 widths`);
  check(moved.length === 0, `no character changes line while typing${moved.length ? ` (${moved.length} keys): ${moved.slice(0, 3).join("; ")}` : ""}`);
  check(errors.length === 0, `no console errors in wrap run${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await page.close();
}

async function checkWrongKeysShowExpectedText(browser) {
  const { page, errors } = await openPage(browser, "dark", "speed=4&seed=1");
  const text = activeOf(await state(page)).def.prompts[0].text;
  const space = text.indexOf(" ");
  const wrong = (ch) => (ch === "q" ? "z" : "q");
  const typed = text.slice(0, 2) + wrong(text[2]) + text.slice(3, space) + "x" + text.slice(space + 1, space + 4);
  await page.keyboard.type(typed);
  await page.screenshot({ path: join(shots, "dark-wrong-keys.png") });
  const spans = await page
    .locator('[data-testid="composer-editor"] [data-typed]')
    .evaluateAll((els) => els.map((el) => ({ text: el.textContent, typed: el.dataset.typed })));
  const bad = spans.map((s, i) => (s.typed === "bad" ? i : -1)).filter((i) => i >= 0);
  check(bad.join(",") === `2,${space}`, `wrong keys are marked at 2 and ${space} (got ${bad.join(",")})`);
  check(spans[2]?.text === text[2], `a wrong letter shows the expected "${text[2]}" (got "${spans[2]?.text}")`);
  check(spans[space]?.text.includes("\u00b7"), `a key typed in place of a space shows a dot (got "${spans[space]?.text}")`);
  await page.addStyleTag({ content: '[data-testid="composer-editor"] { font-family: "Liberation Sans" !important; }' });
  const ghostLeft = () =>
    page.locator('[data-testid="composer-editor"] [data-ghost]').evaluate((el) => el.getClientRects()[0].left);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(" ");
  const leftAfterSpace = await ghostLeft();
  await page.keyboard.press("Backspace");
  await page.keyboard.type("x");
  const leftAfterWrong = await ghostLeft();
  check(
    Math.abs(leftAfterSpace - leftAfterWrong) < 0.01,
    `a wrong key on a space does not move the text after it (${leftAfterSpace} vs ${leftAfterWrong})`,
  );
  check(errors.length === 0, `no console errors in wrong key run${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await page.close();
}

const browser = await chromium.launch();
try {
  await checkWrongKeysShowExpectedText(browser);
  await checkWordsStayPutWhileTyping(browser);
  await playFullSessionInDark(browser);
  await checkEnterSettles(browser);
  await checkPerPromptWpmInLight(browser);
  await checkComposerFontSize(browser);
} finally {
  await browser.close();
  server?.kill();
}

console.log(failures.length === 0 ? "\nPASS" : `\nFAIL: ${failures.length} check(s)`);
console.log(`screenshots: ${shots}`);
process.exit(failures.length === 0 ? 0 : 1);
