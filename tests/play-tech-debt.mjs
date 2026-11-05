import { withGame, typeText, state } from "./lib.mjs";

// Type text[from..to). At indices in `typos`, press a wrong key instead.
// No backspace in this game, so a typo replaces the char rather than adding one.
async function typeRange(page, text, from, to, typos = []) {
  let i = from;
  for (const t of [...typos].filter((t) => t >= from && t < to).sort((a, b) => a - b)) {
    if (t > i) await typeText(page, text.slice(i, t), { delay: 8 });
    await page.keyboard.type(text[t] === "q" ? "z" : "q", { delay: 8 });
    i = t + 1;
  }
  if (to > i) await typeText(page, text.slice(i, to), { delay: 8 });
}

async function payAll(page, shot, name) {
  let first = true;
  for (let n = 0; n < 50; n++) {
    const s = await state(page);
    if (!s.payTarget) return s;
    if (first && name) { await shot(name); first = false; }
    // One wrong key first to check it is rejected without advancing.
    if (n === 0) {
      await page.keyboard.type(s.payTarget[0] === "q" ? "z" : "q");
      const s2 = await state(page);
      if (s2.payPos !== 0) throw new Error("pay accepted a wrong key");
    }
    await typeText(page, s.payTarget, { delay: 6 });
    await page.waitForTimeout(30);
  }
  throw new Error("pay loop did not end");
}

const errors = await withGame("tech-debt", { seed: 4 }, async (page, { shot }) => {
  const { text } = await state(page);
  console.log(text.length, text);
  await shot("1-start");
  const L = text.length;
  // Early typos that we leave unpaid for a while so interest stacks up.
  await typeRange(page, text, 0, 70, [5, 22, 38, 51]);
  let s = await state(page);
  console.log("mid", { pos: s.pos, owed: s.owed, level: s.level, unpaid: s.unpaid });
  await shot("2-debt");
  // Pay one down voluntarily.
  await page.keyboard.press("Enter");
  await page.waitForTimeout(80);
  s = await state(page);
  console.log("pay prompt", s.phase, s.payTarget);
  await shot("3-pay");
  await typeText(page, s.payTarget, { delay: 6 });
  s = await state(page);
  console.log("after pay", { phase: s.phase, unpaid: s.unpaid, owed: s.owed, principal: s.principalPaid, interest: s.interestPaid });
  if (s.phase !== "type" || s.unpaid !== 3) throw new Error("voluntary pay failed");
  // Esc cancels a pay prompt without paying.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  s = await state(page);
  if (s.phase !== "type" || s.unpaid !== 3) throw new Error("esc cancel failed");
  await typeRange(page, text, 70, L, [Math.floor(L * 0.7)]);
  await page.waitForTimeout(50);
  s = await state(page);
  console.log("settle", s.phase, s.unpaid, s.payTarget);
  if (s.phase !== "settle") throw new Error("expected settle phase");
  s = await payAll(page, shot, "4-settle");
  await page.waitForTimeout(100);
  s = await state(page);
  console.log("end", s);
  if (s.phase !== "done") throw new Error("not done");
  const chart = await page.$(".td-chart");
  const box = await chart.boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  await shot("5-done");
  await page.keyboard.press("Enter");
  s = await state(page);
  if (s.phase !== "type" || s.pos !== 0 || s.owed !== 0) throw new Error("play again failed");

  await page.setViewportSize({ width: 390, height: 844 });
  await typeRange(page, text, 0, 80, [3, 10, 30]);
  await shot("narrow-2-debt");
  await typeRange(page, text, 80, L, []);
  await payAll(page, shot, "narrow-4-settle");
  await page.waitForTimeout(100);
  await shot("narrow-5-done");
  console.log("narrow end", (await state(page)).phase);
});
console.log("errors:", errors);
if (errors.length) process.exit(1);
