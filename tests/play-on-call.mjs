// Plays a full 90 second shift with a triage bot (SEV1 first, then lowest),
// then a second short run at phone width where nobody types, to check the
// outage, shake and paged-out paths.
import { withGame, typeText, state } from "./lib.mjs";

const errors = await withGame("on-call", { seed: 7 }, async (page, { shot }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await shot("1-intro");
  await page.keyboard.press("Enter");
  const shots = [[20000, "2-early"], [60000, "3-late"]];
  for (;;) {
    let s = await state(page);
    if (s.phase !== "play") break;
    if (shots.length && s.t >= shots[0][0] && (s.incidents.length >= 3 || s.t >= shots[0][0] + 15000)) await shot(shots.shift()[1]);
    if (!s.incidents.length) { await page.waitForTimeout(100); continue; }
    const target = [...s.incidents].sort((a, b) => a.sev - b.sev || b.y - a.y)[0];
    await page.keyboard.type(target.text[0], { delay: 40 });
    s = await state(page);
    const inc = s.incidents.find((i) => i.id === s.locked);
    if (!inc) continue;
    await typeText(page, inc.text.slice(inc.pos), { delay: Number(process.env.DELAY ?? 150), typoRate: 0.03 });
  }
  const s = await state(page);
  console.log("shift 1:", JSON.stringify({ phase: s.phase, t: s.t, lives: s.lives, score: s.score, resolved: s.resolved, outages: s.outages, mistakes: s.mistakes }));
  await shot("4-end");
  await page.keyboard.press("Enter");
  const again = await state(page);
  console.log("after Enter:", again.phase);
});
console.log("errors (desktop):", errors);

const errors2 = await withGame("on-call", { seed: 7, viewport: { width: 390, height: 844 } }, async (page, { shot }) => {
  await shot("m1-intro");
  await page.click("button.primary");
  // Lock an incident, typo once, then drop it with Esc.
  for (;;) {
    const s = await state(page);
    if (s.incidents.length) { await page.keyboard.type(s.incidents[0].text.slice(0, 3)); await page.keyboard.press("z"); break; }
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(500);
  await shot("m2-locked");
  console.log("locked:", (await state(page)).locked);
  await page.keyboard.press("Escape");
  console.log("after Esc locked:", (await state(page)).locked);
  for (;;) {
    const s = await state(page);
    if (s.phase !== "play") break;
    if (s.outages === 1 && !globalThis.shook) { globalThis.shook = true; await page.waitForTimeout(80); await shot("m3-outage"); }
    await page.waitForTimeout(100);
  }
  const s = await state(page);
  console.log("mobile run:", JSON.stringify({ phase: s.phase, t: s.t, lives: s.lives, outages: s.outages }));
  await shot("m4-end");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log("horizontal overflow at 390px:", overflow);
});
console.log("errors (mobile):", errors2);
