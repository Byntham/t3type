// Plays Flame Graph end to end: keyboard guess, full pass with a slow word,
// an uncorrected typo at the end, drill, re-profile, compare, then Escape.
// Checks the graph fits at phone width.
import { withGame, typeText, state } from "./lib.mjs";
const errors = await withGame("flame-graph", { seed: 3 }, async (page, { shot }) => {
  await shot("1-predict");
  for (let k = 0; k < 3; k++) await page.keyboard.press("ArrowRight");
  const hl = (await state(page)).highlighted;
  await shot("1b-highlight");
  await page.keyboard.press("Enter");
  let s = await state(page);
  console.log("highlighted", hl, "-> guess", s.guess, "phase", s.phase);

  const text = await page.evaluate(() => document.querySelector(".typing").textContent);
  const words = text.split(" ");
  const slow = words.find((w, i) => i > 3 && w.replace(/\W/g, "").length >= 6) || words[5];
  const short = words.find((w) => w.length <= 2);
  console.log("slow word:", slow, "| slow short word:", short);
  await typeText(page, text.slice(0, -1), { delay: 15, typoRate: 0.03, slowWords: { [slow]: 120, ...(short ? { [short]: 200 } : {}) } });

  // Fill the last slot with a typo, then keep typing. pos must not pass the end.
  const last = text.at(-1);
  await page.keyboard.type(last === "x" ? "z" : "x");
  await page.keyboard.type("abc", { delay: 10 });
  s = await state(page);
  const note = await page.evaluate(() => document.querySelector(".fg-note")?.textContent);
  console.log(`overflow check: pos ${s.pos} of ${s.len}, full ${s.full}, done ${s.done}, note "${note}"`);
  if (s.pos > s.len) throw new Error("cursor ran past the end of the passage");
  await shot("2a-full");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(last);
  await page.waitForTimeout(100);
  s = await state(page);
  console.log("profile:", s.phase, "hottest", s.hottest);
  await shot("2-profile");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  const fit = await page.evaluate(() => ({
    pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
    rowOverflow: [...document.querySelectorAll(".fg-row")].some((r) => r.scrollWidth > r.clientWidth + 1),
    clipped: [...document.querySelectorAll(".fg-words .fg-box span")].filter((sp) => sp.textContent && sp.getBoundingClientRect().width > sp.parentElement.clientWidth).length,
    labels: [...document.querySelectorAll(".fg-words .fg-box span")].filter((sp) => sp.textContent).length,
  }));
  console.log("390px:", JSON.stringify(fit));
  await shot("m2-profile");
  await page.setViewportSize({ width: 1100, height: 900 });

  await page.keyboard.press("Enter");
  const drill = await page.evaluate(() => document.querySelector(".typing").textContent);
  await typeText(page, drill, { delay: 10 });
  await page.waitForTimeout(100);
  s = await state(page);
  console.log("after drill:", s.phase);
  await shot("3-reprofile");
  await typeText(page, text, { delay: 12 });
  await page.waitForTimeout(100);
  s = await state(page);
  console.log("compare:", s.phase, JSON.stringify(s.result, (k, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v)));
  await shot("4-compare");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("m4-compare");
  console.log("compare overflow at 390px:", await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
  const before = s.passageId;
  await page.keyboard.press("Escape");
  s = await state(page);
  console.log("after Esc:", s.phase, "new passage:", s.passageId !== before);
  await page.keyboard.press("Space");
  console.log("Space on predict:", (await state(page)).phase, "guess", (await state(page)).guess);
});
console.log("errors:", errors);
