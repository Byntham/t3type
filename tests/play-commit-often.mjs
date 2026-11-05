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
    if (c === 3) {
      // Chunk 3 was typed during CI. The keys are queued, then replayed.
      const s = await state(page);
      if (s.phase !== "ci" || s.queued < 3) throw new Error("keys typed during CI were not queued: " + JSON.stringify(s));
      await shot(prefix + "3-ci");
      await typeText(page, chunks[c].slice(s.queued), { delay: 12 });
    } else if (c === 4) {
      // A typo right after a commit loses nothing, and says so.
      const s = await state(page);
      if (s.pos !== s.committed) throw new Error("expected a clean tree");
      await page.keyboard.press(s.text[s.pos] === "x" ? "z" : "x");
      const msg = await page.textContent(".cm-status");
      if (!msg.includes("Nothing was lost")) throw new Error("bad zero-loss message: " + msg);
      if ((await state(page)).lost !== s.lost) throw new Error("zero-loss typo lost chars");
      await until(page, (s) => s.phase === "type");
      await typeText(page, chunks[c], { delay: 12 });
    } else {
      await typeText(page, chunks[c], { delay: 12 });
    }
    await page.keyboard.press("Enter");
    if (c === 2) {
      // Keep typing straight into CI.
      await typeText(page, chunks[3].slice(0, 4), { delay: 12 });
      continue;
    }
    if (c >= 5 && c % 2 === 1 && c + 1 < chunks.length) continue; // more typing through CI
    await until(page, (s) => s.phase === "type" || s.phase === "done");
  }
  return until(page, (s) => s.phase === "done");
}

const errors = await withGame("commit-often", { seed: 2 }, async (page, { shot }) => {
  await shot("1-start");
  console.log(await state(page));
  // Enter mid-word should not commit.
  const { text: t0 } = await state(page);
  let mid = 1;
  while (t0[mid] === " " || t0[mid - 1] === " ") mid++;
  await page.keyboard.type(t0.slice(0, mid), { delay: 10 });
  await page.keyboard.press("Enter");
  const s1 = await state(page);
  if (s1.commits !== 0 || s1.pos !== mid) throw new Error("committed mid-word: " + JSON.stringify(s1));
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
