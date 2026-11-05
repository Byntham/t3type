// Plays 6 reviews: approves the good line in most, merges two bad ones,
// backs out of a bad line once, and checks the final screen at phone width.
import { withGame, typeText, state } from "./lib.mjs";

const errors = await withGame("code-review", { seed: 2 }, async (page, { shot }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const pickBad = [false, true, false, false, true, false];
  for (let i = 0; i < pickBad.length; i++) {
    let s = await state(page);
    const good = s.lines.find((l) => l.good).text, bad = s.lines.find((l) => !l.good).text;
    console.log(`review ${s.round}: ${s.passageId}`);
    if (i === 0) {
      await shot("1-review");
      // Start on the bad line, then back out.
      await typeText(page, bad.slice(0, 4), { delay: 20 });
      s = await state(page);
      console.log("  typed bad prefix, candidates:", s.candidates);
      await shot("2-picked");
      for (let k = 0; k < 4; k++) await page.keyboard.press("Backspace");
      s = await state(page);
      console.log("  after backing out, candidates:", s.candidates, JSON.stringify(s.typed));
    }
    if (i === 3) await page.setViewportSize({ width: 390, height: 844 });
    const target = pickBad[i] ? bad : good;
    if (i === 3) {
      await typeText(page, target.slice(0, 6), { delay: 20 });
      await page.keyboard.press("x"); // a typo that stays visible
      await shot("m4-typo");
      await page.keyboard.press("Backspace");
      await typeText(page, target.slice(6), { delay: 20, typoRate: 0.05 });
    } else {
      await typeText(page, target, { delay: 20, typoRate: 0.04 });
    }
    await page.waitForTimeout(80);
    s = await state(page);
    console.log("  ->", s.phase, JSON.stringify(s.history.at(-1)));
    if (i === 0) await shot("3-merged");
    if (i === 1) await shot("4-bad");
    if (i === 3) await shot("m5-result");
    await page.keyboard.press("Enter");
  }
  const s = await state(page);
  console.log("final:", s.phase, "score", s.score);
  await shot("m6-final");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log("horizontal overflow at 390px:", overflow);
  await page.setViewportSize({ width: 1100, height: 900 });
  await shot("5-final");
  await page.keyboard.press("Enter");
  console.log("after Enter:", (await state(page)).phase, (await state(page)).round);
});
console.log("errors:", errors);
