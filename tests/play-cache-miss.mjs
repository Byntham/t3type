import { withGame, typeText, state } from "./lib.mjs";

const until = async (page, fn, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const s = await state(page); if (fn(s)) return s; await page.waitForTimeout(50); }
  throw new Error("timeout, state: " + JSON.stringify(await state(page)));
};

async function wrongKey(page) {
  const s = await state(page);
  const want = s.text[s.pos];
  await page.keyboard.type(want === "q" ? "z" : "q");
  const s2 = await state(page);
  if (s2.pos !== s.pos || s2.keyMisses !== s.keyMisses + 1) throw new Error("wrong key was not rejected");
}

// Types the rest of the passage, with one peek partway through.
async function recall(page, text, { shot, peekAt = 0.4, misses = 0, name } = {}) {
  const split = Math.floor(text.length * peekAt);
  await typeText(page, text.slice(0, split), { delay: 8 });
  for (let k = 0; k < misses; k++) await wrongKey(page);
  if (name) { await page.waitForTimeout(40); await shot(`${name}-miss`); }
  await page.keyboard.down("Tab");
  await page.waitForTimeout(120);
  let s = await state(page);
  if (!s.peeking || s.peekShown) throw new Error("peek should be fetching: " + JSON.stringify(s));
  await page.waitForTimeout(400);
  s = await state(page);
  if (!s.peekShown || s.peeks !== 1) throw new Error("peek should be shown: " + JSON.stringify(s));
  if (name) await shot(`${name}-peek`);
  await page.keyboard.up("Tab");
  await typeText(page, text.slice(split), { delay: 8 });
}

const errors = await withGame("cache-miss", { seed: 5 }, async (page, { shot }) => {
  let s = await state(page);
  const { text } = s;
  console.log(text.length, text, "read ms", s.readLeftMs);
  await page.waitForTimeout(300);
  await shot("1-read");
  await page.keyboard.press("Space");
  s = await state(page);
  if (s.phase !== "recall") throw new Error("space did not start recall");
  await recall(page, text, { shot, misses: 2, name: "2" });
  s = await until(page, (s) => s.phase === "between");
  console.log("round 1", s.rounds);
  await shot("3-between");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  await page.keyboard.press("Space");
  await recall(page, text, { misses: 1, peekAt: 0.7 });
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
  if (s.phase !== "read" || s.round !== 1) throw new Error("play again failed");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press("Space");
  await recall(page, text, { shot, misses: 3, name: "narrow-2" });
  for (let r = 0; r < 2; r++) {
    await until(page, (s) => s.phase === "between");
    if (r === 0) await shot("narrow-3-between");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(100);
    await page.keyboard.press("Space");
    await recall(page, text, { misses: 1 });
  }
  await until(page, (s) => s.phase === "done");
  await shot("narrow-4-done");
});
console.log("errors:", errors);
if (errors.length) process.exit(1);
