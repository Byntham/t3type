// Plays a full 90 second shift with a triage bot (SEV1 first, then lowest),
// then a second short run at phone width where nobody types, to check the
// outage, shake and paged-out paths. Both runs check that incidents never
// overlap. COMPARE=1 also races a SEV1-first bot against a shortest-first bot,
// and runs a slow (35 wpm) bot, to check the score rewards triage.
import { withGame, typeText, state } from "./lib.mjs";

const overlaps = (incs) => {
  let n = 0;
  for (let a = 0; a < incs.length; a++) for (let b = a + 1; b < incs.length; b++) {
    const A = incs[a], B = incs[b];
    if (A.x + A.w > B.x + 2 && B.x + B.w > A.x + 2 && A.y + A.h > B.y + 2 && B.y + B.h > A.y + 2) n++;
  }
  return n;
};

const msPerChar = (w) => 60000 / (w * 5);

// strategy "triage": SEV1 first, then anything in the bottom 40% of the
// field, then the one closest to prod.
// strategy "shortest": anything in the bottom 40%, then the shortest phrase.
async function bot(page, { strategy = "triage", delay = 150, typoRate = 0.03, shots = [], shot, stats }) {
  for (;;) {
    let s = await state(page);
    if (s.phase !== "play") break;
    stats.polls++;
    if (overlaps(s.incidents)) stats.overlapPolls++;
    stats.inFlight += s.incidents.length;
    if (shots.length && s.t >= shots[0][0] && (s.incidents.length >= 3 || s.t >= shots[0][0] + 15000)) await shot(shots.shift()[1]);
    if (!s.incidents.length) { await page.waitForTimeout(100); continue; }
    // Anything about to hit prod goes first. Otherwise follow the strategy.
    const fh = stats.fh ??= await page.$eval(".oc-field", (e) => e.clientHeight);
    const lowest = (list) => [...list].sort((a, b) => b.y - a.y)[0];
    const urgent = lowest(s.incidents.filter((i) => i.y + i.h > fh * 0.6));
    const sev1 = lowest(s.incidents.filter((i) => i.sev === 1));
    const pick = strategy === "shortest"
      ? urgent ?? [...s.incidents].sort((a, b) => a.text.length - b.text.length)[0]
      : sev1 ?? urgent ?? lowest(s.incidents);
    await page.keyboard.type(pick.text[0], { delay: 40 });
    s = await state(page);
    const inc = s.incidents.find((i) => i.id === s.locked);
    if (!inc) continue;
    await typeText(page, inc.text.slice(inc.pos), { delay, typoRate });
    if (!stats.lessonSeen) stats.lessonSeen = await page.$$eval(".oc-lesson", (n) => n.length);
  }
  return state(page);
}

const summary = (s, stats) => JSON.stringify({
  t: s.t, lives: s.lives, score: s.score, points: s.points, downtime: s.downtime, resolved: s.resolved, outages: s.outages,
  avgInFlight: +(stats.inFlight / Math.max(1, stats.polls)).toFixed(2), overlapPolls: stats.overlapPolls, polls: stats.polls,
});

const errors = await withGame("on-call", { seed: 7 }, async (page, { shot }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await shot("1-intro");
  await page.keyboard.press("Enter");
  const stats = { polls: 0, overlapPolls: 0, inFlight: 0 };
  const s = await bot(page, { delay: Number(process.env.DELAY ?? 150), shots: [[20000, "2-early"], [60000, "3-late"]], shot, stats });
  console.log("shift 1:", summary(s, stats));
  if (!stats.lessonSeen) throw new Error("no lesson flash after a resolve");
  if (stats.overlapPolls) throw new Error("incidents overlapped");
  if (s.score !== s.points - 5 * s.downtime) throw new Error("score is not points minus downtime");
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
  let overlapPolls = 0, shook = false, lanes = new Set();
  for (;;) {
    const s = await state(page);
    if (s.phase !== "play") break;
    if (overlaps(s.incidents)) overlapPolls++;
    for (const i of s.incidents) lanes.add(i.lane);
    if (s.outages === 1 && !shook) { shook = true; await page.waitForTimeout(80); await shot("m3-outage"); }
    await page.waitForTimeout(100);
  }
  const s = await state(page);
  console.log("mobile run:", JSON.stringify({ phase: s.phase, t: s.t, lives: s.lives, outages: s.outages, downtime: s.downtime, score: s.score, lanes: [...lanes], overlapPolls }));
  if (overlapPolls) throw new Error("incidents overlapped at 390px");
  await shot("m4-end");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log("horizontal overflow at 390px:", overflow);
  if (overflow) throw new Error("horizontal overflow at 390px");
});
console.log("errors (mobile):", errors2);

let errors3 = [];
if (process.env.COMPARE) {
  const run = (name, opts) => withGame("on-call", { seed: 7 }, async (page) => {
    await page.keyboard.press("Enter");
    const stats = { polls: 0, overlapPolls: 0, inFlight: 0 };
    const s = await bot(page, { ...opts, stats });
    console.log(`${name}:`, summary(s, stats));
  });
  const res = await Promise.all([
    run("triage 58wpm", { strategy: "triage", delay: msPerChar(58) }),
    run("shortest 58wpm", { strategy: "shortest", delay: msPerChar(58) }),
    run("triage 35wpm", { strategy: "triage", delay: msPerChar(35) }),
  ]);
  errors3 = res.flat();
  console.log("errors (compare):", errors3);
}
if (errors.length || errors2.length || errors3.length) process.exit(1);
