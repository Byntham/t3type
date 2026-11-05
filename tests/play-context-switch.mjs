import { withGame, state } from "./lib.mjs";

// Types whichever task is active. After each switch it pauses and types the
// first keys slowly, like a person reloading context.
async function playRound(page, { shot, delay = 110, shots = true } = {}) {
  let lastSwitches = 1;
  let shotToast = false;
  for (;;) {
    const s = await state(page);
    if (s.phase !== "work") break;
    if (s.switches.length !== lastSwitches) {
      lastSwitches = s.switches.length;
      if (shots && !shotToast && s.switches.at(-1).kind === "interrupt") {
        shotToast = true;
        await page.waitForTimeout(150);
        await shot("2-interrupt");
      }
      await page.waitForTimeout(500);
    }
    const t = s.tasks[s.activeIdx];
    const warming = s.warm != null && s.warm < 8 && s.switches.length > 1;
    await page.keyboard.type(t.text[t.pos], { delay: 0 });
    await page.waitForTimeout(warming ? delay + 90 : delay);
  }
}

const errors = await withGame("context-switch", { seed: 3 }, async (page, { shot }) => {
  console.log("intro", (await state(page)).passages);
  await shot("1-intro");
  await page.keyboard.press("Enter");
  await playRound(page, { shot });
  const s = await state(page);
  console.log("report", { phase: s.phase, interrupts: s.interrupts, lostMs: s.lostMs, steadyMs: s.steadyMs, switches: s.switches });
  await shot("3-report");
  await page.keyboard.press("Enter");
  const s2 = await state(page);
  console.log("after Enter", { phase: s2.phase, passages: s2.passages });
});
console.log("errors:", errors);

const errorsMobile = await withGame("context-switch", { seed: 8, viewport: { width: 390, height: 844 } }, async (page, { shot }) => {
  await shot("m1-intro");
  await page.keyboard.press("Enter");
  await playRound(page, { shot: (n) => shot("m" + n), delay: 90 });
  await shot("m3-report");
});
console.log("mobile errors:", errorsMobile);
