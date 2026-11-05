// Plays 5 rounds of git blame with a mix of early, wrong, cancelled, forced
// and "don't know" guesses, then checks the final screen at desktop and phone
// width. Also checks the hidden lookahead and that a wrong guess scores 0.
import { withGame, typeText, state } from "./lib.mjs";

const typeFrac = async (page, s, from, to, opts = {}) => {
  const a = Math.floor(s.text.length * from), b = Math.floor(s.text.length * to);
  await typeText(page, s.text.slice(a, b), { delay: 12, ...opts });
};

const errors = await withGame("git-blame", { seed: 4 }, async (page, { shot }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const plans = [
    { at: 0.2, pick: "right" },
    { at: 0.5, pick: "wrong" },
    { at: null, cancel: true, pick: "right" }, // open, cancel, never guess, forced at end
    { at: 0.05, pick: "right", typos: 0.08 },
    { at: 0.3, pick: "pass" },
  ];
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    let s = await state(page);
    console.log(`round ${s.round}: ${s.passageId}, choices ${s.choices.join(" / ")}`);
    const hidden = await page.evaluate(() => document.querySelectorAll(".gb-hid").length);
    console.log(`  visible at start: ${s.visibleEnd} of ${s.text.length} chars, ${hidden} hidden`);
    if (i === 4) await page.setViewportSize({ width: 390, height: 844 });
    const choice = (st) => plan.pick === "pass" ? "0" : String(plan.pick === "right" ? st.answer : (st.answer % st.choices.length) + 1);
    const first = plan.at ?? (plan.cancel ? 0.3 : 1);
    await typeFrac(page, s, 0, first, { typoRate: plan.typos || 0 });
    if (plan.cancel) {
      await page.keyboard.press("Tab");
      if (i === 2) await shot("2-prompt-open");
      await page.keyboard.press("Escape");
      console.log("  after Esc:", (await state(page)).phase);
      s = await state(page);
      await typeFrac(page, s, 0.3, 1);
    }
    s = await state(page);
    if (s.phase === "type") {
      await page.keyboard.press("Tab");
      if (i === 0) await shot("1-prompt");
      await page.keyboard.press(choice(s));
      s = await state(page);
      if (i === 0) await shot("1b-locked");
      if (i === 4) { await shot("m5-passed"); console.log("  passed, author shown:", await page.evaluate(() => document.querySelector(".gb-who").textContent)); }
      await typeFrac(page, s, plan.at, 1, { typoRate: plan.typos || 0 });
    }
    s = await state(page);
    if (s.phase === "blame") {
      if (i === 4) await shot("m5-forced");
      console.log("  forced:", s.forced);
      await page.keyboard.press(choice(s));
    }
    await page.waitForTimeout(80);
    s = await state(page);
    console.log("  ->", s.phase, "score", s.score);
    if (i === 0) await shot("3-reveal");
    if (i === 4) await shot("m6-reveal");
    console.log("  round points:", JSON.stringify(s.history.at(-1) ?? null), "| this round:", await page.evaluate(() => [...document.querySelectorAll(".stat")].map((e) => e.textContent).join(" / ")));
    await page.keyboard.press("Enter");
  }
  const s = await state(page);
  console.log("final:", JSON.stringify(s.history), "score", s.score);
  await shot("m7-final");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log("horizontal overflow at 390px:", overflow);
  await page.setViewportSize({ width: 1100, height: 900 });
  await shot("4-final");
  await page.keyboard.press("Enter");
  console.log("after Enter:", (await state(page)).phase, (await state(page)).round);
});
console.log("errors:", errors);
