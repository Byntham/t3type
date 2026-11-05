import { withGame, typeText, state } from "./lib.mjs";

const until = async (page, fn, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const s = await state(page); if (fn(s)) return s; await page.waitForTimeout(25); }
  throw new Error("timeout, state: " + JSON.stringify(await state(page)));
};

// A wrong key is a cache miss: it is rejected, input stalls for the fetch,
// then the word shows. A second wrong key on a shown word does not stall.
async function wrongKey(page) {
  const s = await state(page);
  const want = s.text[s.pos];
  await page.keyboard.type(want === "q" ? "z" : "q");
  let s2 = await state(page);
  if (s2.pos !== s.pos || s2.keyMisses !== s.keyMisses + 1) throw new Error("wrong key was not rejected");
  if (s.revealed == null && !s2.fetching) throw new Error("wrong key did not start a fetch: " + JSON.stringify(s2));
  if (s2.fetching) {
    // Guessing during the stall does nothing.
    await page.keyboard.type(want);
    if ((await state(page)).pos !== s.pos) throw new Error("typed through a fetch stall");
    s2 = await until(page, (x) => !x.fetching, 2000);
    if (s2.revealed == null) throw new Error("word not shown after fetch");
  }
}

// Types the passage with one peek partway through and wrong keys later.
async function recall(page, text, { shot, peekAt = 0.4, misses = 0, name } = {}) {
  const split = Math.floor(text.length * peekAt);
  await typeText(page, text.slice(0, split), { delay: 8 });
  if (name) {
    // A quick Tab tap that ends before the fetch is not a miss.
    const before = await state(page);
    await page.keyboard.down("Tab");
    await page.waitForTimeout(80);
    await page.keyboard.up("Tab");
    const after = await state(page);
    if (after.peeks !== before.peeks || after.missedWords !== before.missedWords) throw new Error("Tab tap counted as a miss");
  }
  await page.keyboard.down("Tab");
  await page.waitForTimeout(120);
  let s = await state(page);
  if (!s.peeking || s.peekShown || s.peeks !== 0) throw new Error("peek should be fetching and not counted yet: " + JSON.stringify(s));
  await page.waitForTimeout(400);
  s = await state(page);
  if (!s.peekShown || s.peeks !== 1) throw new Error("peek should be shown: " + JSON.stringify(s));
  if (name) await shot(`${name}-peek`);
  await page.keyboard.up("Tab");
  // Move a few words on, then make the wrong keys.
  const rest = text.slice(split);
  const k = Math.min(rest.length, rest.split(" ").slice(0, 3).join(" ").length + 1);
  await typeText(page, rest.slice(0, k), { delay: 8 });
  for (let m = 0; m < misses; m++) await wrongKey(page);
  if (name && misses) { await page.waitForTimeout(40); await shot(`${name}-miss`); }
  await typeText(page, rest.slice(k), { delay: 8 });
}

const errors = await withGame("cache-miss", { seed: 5 }, async (page, { shot }) => {
  let s = await state(page);
  const { text } = s;
  console.log(text.length, text);
  if (s.phase !== "ready") throw new Error("expected a ready step before round 1");
  if (text.length > 160) throw new Error("passage longer than 160 chars");
  await shot("0-ready");
  await page.keyboard.press("Space");
  s = await state(page);
  if (s.phase !== "read") throw new Error("space did not start reading");
  console.log("read ms", s.readLeftMs);
  await page.waitForTimeout(300);
  await shot("1-read");
  await page.keyboard.press("Space");
  s = await state(page);
  if (s.phase !== "recall") throw new Error("space did not start recall");
  const rate = await page.textContent(".cx-rate");
  if (rate !== "-") throw new Error("hit rate before any word should be '-', got " + rate);
  await recall(page, text, { shot, misses: 2, name: "2" });
  s = await until(page, (s) => s.phase === "between");
  console.log("round 1", s.rounds);
  await shot("3-between");
  await page.keyboard.press("Space");
  s = await state(page);
  if (s.phase !== "read" || s.round !== 2) throw new Error("space did not continue from between");
  await page.waitForTimeout(200);
  await page.keyboard.press("Space");
  await recall(page, text, { misses: 1, peekAt: 0.6 });
  await until(page, (s) => s.phase === "between");
  await page.keyboard.press("Enter");
  // Round 3: let the read timer run out on its own.
  s = await state(page);
  console.log("round 3 read ms", s.readLeftMs);
  await until(page, (s) => s.phase === "recall", s.readLeftMs + 2000);
  await recall(page, text, { peekAt: 0.2 });
  s = await until(page, (s) => s.phase === "done");
  console.log("done", s.rounds);
  await shot("4-done");
  await page.keyboard.press("Enter");
  s = await state(page);
  if (s.phase !== "ready" || s.round !== 1) throw new Error("play again failed");

  await page.setViewportSize({ width: 390, height: 844 });
  await shot("narrow-0-ready");
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await recall(page, text, { shot, misses: 3, name: "narrow-2" });
  for (let r = 0; r < 2; r++) {
    await until(page, (s) => s.phase === "between");
    if (r === 0) await shot("narrow-3-between");
    await page.keyboard.press("Space");
    await page.waitForTimeout(100);
    await page.keyboard.press("Space");
    await recall(page, text, { misses: 1 });
  }
  await until(page, (s) => s.phase === "done");
  await shot("narrow-4-done");
});
console.log("errors:", errors);
if (errors.length) process.exit(1);
