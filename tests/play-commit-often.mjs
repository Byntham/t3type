import { withGame, typeText, state } from "./lib.mjs";

const until = async (page, fn, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const s = await state(page); if (fn(s)) return s; await page.waitForTimeout(25); }
  throw new Error("timeout waiting, state: " + JSON.stringify(await state(page)));
};

async function playRound(page, shot, { prefix = "" } = {}) {
  const { text } = await state(page);
  // Chunks of 2 to 4 words, each committed with Enter.
  const words = text.split(" ");
  const chunks = [];
  for (let i = 0, k = 0; i < words.length; k++) {
    const n = 2 + (k % 3);
    const part = words.slice(i, i + n).join(" ");
    i += n;
    chunks.push(i < words.length ? part + " " : part);
  }
  let shotCi = false;
  for (let c = 0; c < chunks.length; c++) {
    if (c === 1) {
      // Deliberate typo halfway through chunk 2: build fails, chunk resets.
      const half = chunks[c].slice(0, Math.floor(chunks[c].length / 2));
      await typeText(page, half, { delay: 12 });
      const s = await state(page);
      const want = s.text[s.pos];
      await page.keyboard.press(want === "x" ? "z" : "x");
      await page.waitForTimeout(120);
      await shot(prefix + "2-revert");
      const after = await until(page, (s) => s.phase === "type");
      if (after.pos !== after.committed) throw new Error("revert did not reset pos");
    }
    await typeText(page, chunks[c], { delay: 12 });
    await page.keyboard.press("Enter");
    if (!shotCi && c === 2) { await page.waitForTimeout(60); await shot(prefix + "3-ci"); shotCi = true; }
    await until(page, (s) => s.phase === "type" || s.phase === "done");
  }
  return until(page, (s) => s.phase === "done");
}

const errors = await withGame("commit-often", { seed: 2 }, async (page, { shot }) => {
  await shot("1-start");
  console.log(await state(page));
  // Enter mid-word should not commit.
  const { text: t0 } = await state(page);
  await page.keyboard.type(t0.slice(0, 3), { delay: 10 });
  await page.keyboard.press("Enter");
  const s1 = await state(page);
  if (s1.commits !== 0 || s1.pos !== 3) throw new Error("committed mid-word: " + JSON.stringify(s1));
  await shot("1b-midword");
  // Reload to start clean.
  await page.reload();
  await page.waitForTimeout(200);
  const end = await playRound(page, shot);
  console.log("end", end);
  await shot("4-done");
  await page.keyboard.press("Enter");
  const again = await state(page);
  console.log("again", again.phase, again.pos, again.commits);
  if (again.phase !== "type" || again.pos !== 0) throw new Error("play again failed");

  // Narrow layout.
  await page.setViewportSize({ width: 390, height: 844 });
  const end2 = await playRound(page, shot, { prefix: "narrow-" });
  console.log("narrow end", end2.commits, end2.reverts, end2.lost);
  await shot("narrow-4-done");
});
console.log("errors:", errors);
if (errors.length) process.exit(1);
