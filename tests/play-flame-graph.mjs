import { withGame, typeText, state } from "./lib.mjs";
const errors = await withGame("flame-graph", { seed: 3 }, async (page, { shot }) => {
  await shot("1-predict");
  await page.click(".fg-word >> nth=2");
  const text = await page.evaluate(() => document.querySelector(".typing").textContent);
  await typeText(page, text, { delay: 15, typoRate: 0.03, slowWords: { [text.split(" ")[5]]: 120 } });
  await page.waitForTimeout(100);
  console.log(await state(page));
  await shot("2-profile");
  await page.keyboard.press("Enter");
  const drill = await page.evaluate(() => document.querySelector(".typing").textContent);
  await typeText(page, drill, { delay: 10 });
  await page.waitForTimeout(100);
  console.log(await state(page));
  await shot("3-compare");
});
console.log("errors:", errors);
