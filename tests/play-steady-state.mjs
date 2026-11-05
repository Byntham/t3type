import { withGame, state } from "./lib.mjs";

async function waitPhase(page, phase, ms = 90000) {
  await page.waitForFunction((p) => window.__game?.state().phase === p, phase, { timeout: ms });
}

// Plays word by word: type the word fast, wait for its beat (plus a planned
// error), then press the trailing space. Some words are deliberately early
// or late so the end screen has variety.
async function playRound(page, { jitter, shotAt, shot, stopAfter = Infinity }) {
  let typed = 0;
  for (;;) {
    const s = await state(page);
    if (s.phase !== "play") break;
    if (s.wordIndex >= s.n) { await page.waitForTimeout(100); continue; }
    if (typed >= stopAfter) break;
    const i = s.wordIndex;
    const last = i === s.n - 1;
    const word = s.word;
    const body = last ? word.slice(0, -1) : word;
    const end = last ? word.slice(-1) : " ";
    await page.keyboard.type(body, { delay: 12 });
    const s2 = await state(page);
    const wait = s2.dueIn + jitter(i);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.keyboard.type(end);
    typed++;
    if (i === shotAt) await shot("2-play");
  }
}

const jitter = (i) => (i % 7 === 3 ? 260 : i % 5 === 2 ? -320 : ((i * 37) % 80) - 40);

const errors = await withGame("steady-state", { seed: 2 }, async (page, { shot }) => {
  for (let k = 0; k < 4; k++) await page.keyboard.press("ArrowRight");
  const s0 = await state(page);
  console.log("setup", { tempo: s0.tempo, passage: s0.passageId });
  await shot("1-setup");
  await page.keyboard.press("Enter");
  await playRound(page, { jitter, shotAt: 6, shot });
  await waitPhase(page, "results");
  const s = await state(page);
  console.log("results", { counts: s.counts, maxCombo: s.maxCombo, sd: s.sd, audio: s.audio });
  await shot("3-results");
  await page.keyboard.press("Enter");
  const s3 = await state(page);
  console.log("after Enter", { phase: s3.phase, tempo: s3.tempo, passage: s3.passageId });
});
console.log("errors:", errors);

const errorsMobile = await withGame("steady-state", { seed: 5, viewport: { width: 390, height: 844 } }, async (page, { shot }) => {
  for (let k = 0; k < 20; k++) await page.keyboard.press("ArrowRight");
  await shot("m1-setup");
  await page.keyboard.press("Enter");
  // Play a few words, then stop. The rest should be judged Miss and the round should end.
  await playRound(page, { jitter, shotAt: 3, shot: (n) => shot("m" + n), stopAfter: 6 });
  await waitPhase(page, "results");
  const s = await state(page);
  console.log("mobile results", { tempo: s.tempo, counts: s.counts });
  await shot("m3-results");
});
console.log("mobile errors:", errorsMobile);
