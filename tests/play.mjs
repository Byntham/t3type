// Plays a full t3type session in Chromium.
//
//   node tests/play.mjs              starts its own Vite dev server on port 5180
//   T3TYPE_URL=http://host:5179/ node tests/play.mjs   uses a running server
//
// Run 1 (dark): types every prompt, with typos in some, switches threads with
// Tab while agents run, and plays until all threads are done.
// Run 2 (light): a short timed session that ends when the clock runs out.
// Both runs fail on any console error. Screenshots go to tests/shots/.
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

/** Swap two inner letters of the longest word, so the agent has a typo to take literally. */
function withTypo(text) {
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

const browser = await chromium.launch();
try {
  // Run 1: dark, full session until every thread is done.
  {
    const { page, errors } = await openPage(browser, "dark", "speed=2");
    await page.screenshot({ path: join(shots, "dark-start.png") });
    let sent = 0;
    let typoPrompts = 0;
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
        const typo = sent % 3 === 1;
        const text = typo ? withTypo(prompt.text) : prompt.text;
        if (typo && text !== prompt.text) typoPrompts += 1;
        // A backspace on the first prompt checks that corrections work.
        if (sent === 0) {
          await page.keyboard.type(text.slice(0, 5) + "x");
          await page.keyboard.press("Backspace");
          await page.keyboard.type(text.slice(5));
        } else {
          await page.keyboard.type(text);
        }
        await page.keyboard.press("Enter");
        sent += 1;
        const after = await state(page);
        if (running(after) >= 2 && !midShot) {
          await page.waitForTimeout(250);
          await page.screenshot({ path: join(shots, "dark-running.png") });
          midShot = true;
        }
        // Switch away while this agent works, like running parallel agents.
        await page.keyboard.press("Tab");
        const switched = await state(page);
        const previous = switched.threads.find((t) => t.def.id === thread.def.id);
        if (switched.activeId !== thread.def.id && !previous.turns.at(-1).done) switchesWhileRunning += 1;
        continue;
      }
      // Nothing to type here: Tab to a thread waiting on input, or wait for agents.
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
    check(end.stats.typosLiteral >= typoPrompts, `typos taken literally: ${end.stats.typosLiteral} for ${typoPrompts} typo prompts`);
    check(switchesWhileRunning >= 5, `switched threads while an agent ran ${switchesWhileRunning} times`);
    check(end.stats.parallelism > 1, `parallelism above 1 (got ${end.stats.parallelism.toFixed(2)})`);
    check(end.stats.accuracy < 1 && end.stats.accuracy > 0.9, `accuracy is plausible (${(end.stats.accuracy * 100).toFixed(1)}%)`);
    check(end.stats.wpm > 0, `wpm is positive (${end.stats.wpm})`);
    const literal = end.threads.flatMap((t) => t.turns).filter((turn) => turn.reply.literal);
    const quotesTypo = literal.every((turn) => turn.diff.typos.length === 0 || turn.reply.text.includes(turn.diff.typos[0].typed));
    check(literal.length > 0 && quotesTypo, `${literal.length} literal replies quote the typo as typed`);
    const summary = await page.locator("[data-summary]").allTextContents();
    check(summary.length === 6, `end screen shows ${summary.length} stat rows`);
    check(errors.length === 0, `no console errors in dark run${errors.length ? `: ${errors.join(" | ")}` : ""}`);

    // The timeline shows a real prompt's source and the parody label.
    await page.keyboard.press("Enter"); // play again
    await page.waitForFunction(() => window.__game.state().session.status === "ready");
    check(true, "Enter on the end screen starts a new session");
    await page.close();
  }

  // Run 3: auto-settle. Finish one thread without pressing Tab. It should move
  // to the Settled shelf and navigation should move forward on its own.
  {
    const { page, errors } = await openPage(browser, "dark", "speed=4");
    const s0 = await state(page);
    const first = activeOf(s0);
    for (const prompt of first.def.prompts) {
      await page.waitForFunction((id) => {
        const t = window.__game.state().threads.find((x) => x.def.id === id);
        return t.turns.length === 0 || t.turns.at(-1).done;
      }, first.def.id);
      await page.keyboard.type(prompt.text);
      await page.keyboard.press("Enter");
    }
    await page.waitForFunction((id) => window.__game.state().activeId !== id, first.def.id, { timeout: 15_000 });
    const s1 = await state(page);
    const settled = s1.threads.find((t) => t.def.id === first.def.id);
    check(settled.settledAt !== null, "finished thread auto-settles");
    check(s1.activeId !== first.def.id, `navigation moved forward on its own (to ${s1.activeId})`);
    const header = await page.locator('[data-testid="sidebar-settled-header"]').textContent();
    check(/1/.test(header ?? ""), `Settled shelf shows 1 (got "${header?.trim()}")`);
    await page.keyboard.press("Tab");
    check((await state(page)).activeId !== first.def.id, "Tab never returns to a settled thread");
    await page.screenshot({ path: join(shots, "dark-settled.png") });
    check(errors.length === 0, `no console errors in settle run${errors.length ? `: ${errors.join(" | ")}` : ""}`);
    await page.close();
  }

  // Run 2: light, short timed session that ends on the clock.
  {
    const { page, errors } = await openPage(browser, "light", "speed=4&duration=40");
    const s0 = await state(page);
    const first = activeOf(s0).def.prompts[0].text;
    await page.keyboard.type(withTypo(first));
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    const s1 = await state(page);
    const second = activeOf(s1).def.prompts[0].text;
    await page.keyboard.type(second.slice(0, 30));
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(shots, "light-running.png") });
    await page.keyboard.type(second.slice(30));
    await page.keyboard.press("Enter");
    // Back to the first thread once its agent is done, and check the reply.
    await page.waitForFunction(
      (id) => window.__game.state().threads.find((t) => t.def.id === id).turns[0]?.done === true,
      s0.activeId,
      { timeout: 20000 },
    );
    await page.evaluate((id) => window.__game.select(id), s0.activeId);
    await page.waitForSelector("[data-assistant-message]");
    await page.screenshot({ path: join(shots, "light-reply.png") });
    const sources = await page.locator("[data-prompt-kind]").count();
    check(sources > 0, "prompt kind label shows under the user message");
    check((await page.locator("[data-parody-label]").count()) === 1, "parody label shows in the header");
    await page.waitForFunction(() => window.__game.state().session.status === "ended", null, { timeout: 30000 });
    await page.waitForSelector("[data-end-summary]");
    await page.screenshot({ path: join(shots, "light-end.png") });
    const end = await state(page);
    check(end.session.endReason === "time", `light run ends on the clock (got ${end.session.endReason})`);
    check(end.stats.promptsSent === 2, `light run sent 2 prompts (got ${end.stats.promptsSent})`);
    check(errors.length === 0, `no console errors in light run${errors.length ? `: ${errors.join(" | ")}` : ""}`);
    await page.close();
  }
} finally {
  await browser.close();
  server?.kill();
}

console.log(failures.length === 0 ? "\nPASS" : `\nFAIL: ${failures.length} check(s)`);
console.log(`screenshots: ${shots}`);
process.exit(failures.length === 0 ? 0 : 1);
