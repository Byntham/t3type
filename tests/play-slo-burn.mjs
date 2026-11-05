import { withGame, typeText, state } from "./lib.mjs";

async function waitPhase(page, phase, ms = 20000) {
  await page.waitForFunction((p) => window.__game?.state().phase === p, phase, { timeout: ms });
}

const errors = await withGame("slo-burn", { seed: 4 }, async (page, { shot }) => {
  await page.keyboard.press("3");
  console.log("setup", await state(page));
  await shot("1-setup");
  await page.keyboard.press("Enter");

  // Batch 1: steady with two slow words and a few typos.
  let s = await state(page);
  const words = s.text.split(" ");
  await typeText(page, s.text, { delay: 35, typoRate: 0.02, slowWords: { [words[3]]: 300, [words[8]]: 300 } });
  s = await state(page);
  console.log("after batch 1", { budget: s.budget, served: s.served, passages: s.passages, p99: s.p99 });

  // Batch 2: type a little, then stall until the in-flight request kills the budget.
  await typeText(page, s.text.slice(0, 30), { delay: 35 });
  await shot("2-run");
  await waitPhase(page, "outage");
  s = await state(page);
  console.log("outage", { cause: s.cause, served: s.served, p50: s.p50, p95: s.p95, p99: s.p99, worst: s.worst });
  await shot("3-postmortem");

  await page.keyboard.press("Enter");
  console.log("after Enter:", (await state(page)).phase);
});
console.log("errors:", errors);

const errorsMobile = await withGame("slo-burn", { seed: 7, viewport: { width: 390, height: 844 } }, async (page, { shot }) => {
  await shot("m1-setup");
  await page.keyboard.press("Enter");
  const s = await state(page);
  await typeText(page, s.text.slice(0, 20), { delay: 30, typoRate: 0.05 });
  await shot("m2-run");
  await waitPhase(page, "outage", 60000);
  await shot("m3-postmortem");
});
console.log("mobile errors:", errorsMobile);
