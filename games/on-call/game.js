// On-Call: incidents fall toward prod. Type one to resolve it.
// The mechanic teaches triage: SEV1s fall fastest and cost the most, so
// they come first even when a SEV3 looks easier.
import { listenKeys, loop } from "../../shared/engine.js";
import { PASSAGES, phrases, rng, getSeed, shuffle } from "../../shared/content.js";
import { mountShell, h, render, lessonCard, statsRow, fmt, pct, exposeState } from "../../shared/ui.js";

const main = mountShell({ title: "On-Call", tagline: "Triage first. Then fix." });

const SHIFT_MS = 90_000;
const LIVES = 3;
const SEV = {
  1: { label: "SEV1", points: 100, fall: 15, downtime: 45 },
  2: { label: "SEV2", points: 30, fall: 18, downtime: 15 },
  3: { label: "SEV3", points: 10, fall: 22, downtime: 5 },
};

const rand = rng(getSeed());

// Build the incident pool once. Each phrase keeps a link to its passage so
// the end screen can show the lessons behind what you fixed.
const POOL = { 1: [], 2: [], 3: [] };
for (const p of shuffle(PASSAGES, rand)) {
  for (let text of phrases(p.text, { maxLen: 40 })) {
    text = text.replace(/[,;:(]+$/, "").trim();
    if (text.length < 10) continue;
    const sev = text.length >= 31 ? 1 : text.length >= 19 ? 2 : 3;
    POOL[sev].push({ text, passage: p });
  }
}
// Fall back to a neighbor bucket if a small library leaves one empty.
for (const s of [1, 2, 3]) if (!POOL[s].length) POOL[s] = POOL[1].length ? POOL[1] : POOL[2].length ? POOL[2] : POOL[3];

let phase = "intro"; // intro | play | end
let g = null; // per-shift state
let stopLoop = null;
let els = {};

exposeState("on-call", () => ({
  phase,
  t: g ? Math.round(g.t) : 0,
  lives: g?.lives,
  score: g?.score,
  locked: g?.locked?.id ?? null,
  incidents: g ? g.incidents.map((i) => ({ id: i.id, sev: i.sev, text: i.text, pos: i.pos, y: Math.round(i.y), passageId: i.passage.id })) : [],
  resolved: g ? { 1: g.resolved[1].length, 2: g.resolved[2].length, 3: g.resolved[3].length } : null,
  outages: g?.outages.length,
  outageSevs: g?.outages.map((o) => o.sev),
  seen: g?.seen,
  mistakes: g?.mistakes,
}));

function newShift() {
  return {
    t: 0, nextSpawn: 400, nextId: 1,
    lives: LIVES, score: 0,
    incidents: [], locked: null, errFlag: false,
    resolved: { 1: [], 2: [], 3: [] }, // {passage, ttr}
    seen: { 1: 0, 2: 0, 3: 0 },
    outages: [], // {sev}
    keystrokes: 0, mistakes: 0,
    bag: { 1: [], 2: [], 3: [] },
  };
}

// ---------- intro ----------
function showIntro() {
  phase = "intro";
  render(main,
    h("div", { class: "panel stack oc-intro" },
      h("div", {}, h("span", { class: "pill" }, "90 second shift"), " ", h("b", {}, "You are on call.")),
      h("p", {}, "Incidents fall toward prod. Type the first letter of one to take it, then finish typing it to resolve it."),
      h("div", { class: "oc-legend" },
        legendRow(1, "Long, fast, worth 100. Costs 45 min of downtime."),
        legendRow(2, "Medium. Worth 30. Costs 15 min."),
        legendRow(3, "Short and slow. Worth 10. Costs 5 min."),
      ),
      h("p", { class: "muted" }, "Anything that reaches prod costs a life. Three outages and you are paged out. Press ", h("kbd", {}, "Esc"), " to drop an incident, but you lose its progress."),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: startShift }, "Start shift"),
        h("span", { class: "muted" }, "or press ", h("kbd", {}, "Enter")),
      ),
    ),
  );
}

function legendRow(sev, text) {
  return h("div", { class: "oc-legend-row" }, h("span", { class: `oc-tag sev${sev}` }, SEV[sev].label), h("span", {}, text));
}

// ---------- play ----------
function startShift() {
  phase = "play";
  g = newShift();
  els.hud = h("div", { class: "oc-hud" });
  els.field = h("div", { class: "oc-field" },
    h("div", { class: "oc-prod" }, h("span", {}, "prod")),
  );
  els.status = h("div", { class: "oc-status muted" });
  render(main,
    h("div", { class: "stack" },
      els.hud,
      els.field,
      els.status,
    ),
  );
  paintHud();
  paintStatus();
  stopLoop?.();
  stopLoop = loop(tick);
}

function progress() { return Math.min(1, g.t / SHIFT_MS); }

function pickSeverity() {
  const p = progress();
  const w1 = 0.15 + 0.17 * p, w2 = 0.3 + 0.05 * p;
  const r = rand();
  return r < w1 ? 1 : r < w1 + w2 ? 2 : 3;
}

function drawPhrase(sev) {
  // Take from a shuffled bag so phrases do not repeat until the bucket runs out.
  // Skip phrases whose first letter is already on screen, so a key press
  // never has to guess which incident you meant.
  if (!g.bag[sev].length) g.bag[sev] = shuffle(POOL[sev], rand);
  const taken = new Set(g.incidents.map((i) => i.text[0].toLowerCase()));
  const k = g.bag[sev].findIndex((c) => !taken.has(c.text[0].toLowerCase()));
  if (k === -1) return null;
  return g.bag[sev].splice(k, 1)[0];
}

function spawn() {
  const sev = pickSeverity();
  const pick = drawPhrase(sev);
  if (!pick) return;
  const inc = {
    id: g.nextId++, sev, text: pick.text, passage: pick.passage,
    pos: 0, y: 0, born: g.t,
    speed: 0, // px per ms, set after measuring
  };
  inc.el = h("div", { class: `oc-inc sev${sev}` },
    h("span", { class: `oc-tag sev${sev}` }, SEV[sev].label),
    inc.textEl = h("span", { class: "oc-text" }),
  );
  paintIncident(inc);
  els.field.appendChild(inc.el);
  const fw = els.field.clientWidth, fh = els.field.clientHeight;
  const w = inc.el.offsetWidth, ch = inc.el.offsetHeight;
  // Pick the x slot farthest from incidents near the top.
  let best = 0, bestGap = -1;
  for (let k = 0; k < 4; k++) {
    const x = rand() * Math.max(0, fw - w - 16) + 8;
    const near = g.incidents.filter((o) => o.y < 140);
    const gap = near.length ? Math.min(...near.map((o) => Math.abs(o.x + o.w / 2 - (x + w / 2)))) : 999;
    if (gap > bestGap) { best = x; bestGap = gap; }
  }
  inc.x = best;
  inc.w = w;
  inc.h = ch;
  inc.y = -ch;
  const fallSec = SEV[sev].fall * (1 - 0.25 * progress());
  inc.speed = (fh + ch) / (fallSec * 1000);
  g.incidents.push(inc);
  g.seen[sev]++;
  place(inc);
}

function place(inc) {
  inc.el.style.transform = `translate(${inc.x}px, ${inc.y}px)`;
}

function paintIncident(inc) {
  const { text, pos } = inc;
  render(inc.textEl,
    pos ? h("span", { class: "oc-done" }, text.slice(0, pos)) : null,
    h("span", { class: "oc-cur" + (inc === g?.locked ? " on" : "") }, text[pos] ?? ""),
    h("span", {}, text.slice(pos + 1)),
  );
  inc.el.classList.toggle("locked", inc === g?.locked);
}

function tick(dt) {
  if (phase !== "play") return;
  g.t += dt;
  if (g.t >= g.nextSpawn && g.incidents.length < 8) {
    spawn();
    const gap = 5200 - 2400 * progress();
    g.nextSpawn = g.t + gap * (0.8 + 0.4 * rand());
  }
  const fh = els.field.clientHeight;
  for (const inc of [...g.incidents]) {
    inc.y += inc.speed * dt;
    if (inc.y + inc.h >= fh) outage(inc);
    else place(inc);
  }
  paintHud();
  if (g.lives <= 0 || g.t >= SHIFT_MS) endShift();
}

function removeIncident(inc) {
  g.incidents = g.incidents.filter((i) => i !== inc);
  if (g.locked === inc) { g.locked = null; g.errFlag = false; }
}

function outage(inc) {
  removeIncident(inc);
  g.lives--;
  g.outages.push({ sev: inc.sev, text: inc.text });
  inc.el.remove();
  const boom = h("div", { class: `oc-boom sev${inc.sev}`, style: { left: `${inc.x}px`, width: `${inc.w}px` } }, `${SEV[inc.sev].label} down`);
  els.field.appendChild(boom);
  setTimeout(() => boom.remove(), 900);
  els.field.classList.remove("shake");
  void els.field.offsetWidth; // restart the animation
  els.field.classList.add("shake");
  paintStatus(`${SEV[inc.sev].label} hit prod. ${SEV[inc.sev].downtime} min of downtime.`, "bad");
}

function resolve(inc) {
  removeIncident(inc);
  const ttr = g.t - inc.born;
  g.resolved[inc.sev].push({ passage: inc.passage, ttr });
  g.score += SEV[inc.sev].points;
  inc.el.classList.add("resolved");
  setTimeout(() => inc.el.remove(), 350);
  paintStatus(`${SEV[inc.sev].label} resolved in ${fmt(ttr / 1000, 1)}s. +${SEV[inc.sev].points}`, "good");
}

function paintHud() {
  const left = Math.max(0, SHIFT_MS - g.t) / 1000;
  const mm = Math.floor(left / 60), ss = Math.floor(left % 60);
  render(els.hud,
    h("div", { class: "oc-hud-item" }, h("span", { class: "l" }, "shift"), h("span", { class: "v" }, `${mm}:${String(ss).padStart(2, "0")}`)),
    h("div", { class: "oc-hud-item" }, h("span", { class: "l" }, "score"), h("span", { class: "v" }, String(g.score))),
    h("div", { class: "oc-hud-item" }, h("span", { class: "l" }, "uptime"),
      h("span", { class: "v oc-lives" }, Array.from({ length: LIVES }, (_, i) => h("span", { class: i < g.lives ? "on" : "off" })))),
    h("div", { class: "oc-hud-item oc-hud-sev" },
      [1, 2, 3].map((s) => h("span", { class: `oc-tag sev${s}` }, `${SEV[s].label} ${g.resolved[s].length}`))),
  );
}

let statusTimer = 0;
function paintStatus(msg, kind) {
  clearTimeout(statusTimer);
  if (!msg) {
    render(els.status, h("span", {}, "Type a first letter to take an incident. ", h("kbd", {}, "Esc"), " drops it."));
    els.status.className = "oc-status muted";
    return;
  }
  render(els.status, h("span", {}, msg));
  els.status.className = `oc-status oc-${kind}`;
  statusTimer = setTimeout(() => paintStatus(), 2200);
}

function onPlayKey(key) {
  if (key === "Escape") {
    if (g.locked) {
      const inc = g.locked;
      g.locked = null;
      g.errFlag = false;
      inc.pos = 0;
      paintIncident(inc);
      paintStatus("Dropped. Progress lost.", "muted");
    }
    return;
  }
  if (key === "Backspace" || key === "WordBackspace") { g.errFlag = false; return; }
  if (key.length !== 1) return;
  const inc = g.locked;
  if (!inc) {
    if (key === " ") return;
    const k = key.toLowerCase();
    const hits = g.incidents.filter((i) => i.text[0].toLowerCase() === k);
    g.keystrokes++;
    if (!hits.length) {
      g.mistakes++;
      els.field.classList.remove("miss");
      void els.field.offsetWidth;
      els.field.classList.add("miss");
      return;
    }
    const target = hits.reduce((a, b) => (b.y > a.y ? b : a));
    g.locked = target;
    target.pos = 1;
    for (const i of g.incidents) if (i !== target) i.el.classList.remove("locked");
    paintIncident(target);
    if (target.pos >= target.text.length) resolve(target);
    return;
  }
  g.keystrokes++;
  if (key === inc.text[inc.pos]) {
    inc.pos++;
    g.errFlag = false;
    paintIncident(inc);
    if (inc.pos >= inc.text.length) resolve(inc);
  } else {
    // A typo does not drop the lock, but the incident slips closer to prod.
    g.mistakes++;
    g.errFlag = true;
    inc.y += 10;
    inc.el.classList.remove("typo");
    void inc.el.offsetWidth;
    inc.el.classList.add("typo");
  }
}

// ---------- end ----------
function endShift() {
  phase = "end";
  stopLoop?.();
  stopLoop = null;
  const handedOff = g.incidents.length;
  const all = [1, 2, 3].flatMap((s) => g.resolved[s]);
  const mttr = all.length ? all.reduce((a, r) => a + r.ttr, 0) / all.length / 1000 : NaN;
  const downtime = g.outages.reduce((a, o) => a + SEV[o.sev].downtime, 0);
  const pagedOut = g.lives <= 0;
  const sev1Down = g.outages.filter((o) => o.sev === 1).length;

  const n = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;
  const ratio = SEV[1].downtime / SEV[3].downtime;
  let triage;
  if (sev1Down && g.resolved[3].length) triage = `You fixed ${n(g.resolved[3].length, "SEV3")} while ${n(sev1Down, "SEV1")} took prod down. One SEV1 costs ${ratio} times the downtime of a SEV3. Triage first.`;
  else if (sev1Down) triage = `${n(sev1Down, "SEV1")} reached prod. They fall fastest, so take them the moment they appear.`;
  else if (g.outages.length) triage = `No SEV1 reached prod, but ${n(g.outages.length, "smaller incident")} did. When nothing big is falling, take the one closest to prod.`;
  else if (g.seen[1]) triage = "No SEV1 reached prod. That is triage done right.";
  else triage = "A quiet shift. Enjoy it.";

  // Lessons from the passages you resolved, biggest incidents first.
  const lessons = [];
  for (const s of [1, 2, 3]) for (const r of g.resolved[s]) if (!lessons.includes(r.passage)) lessons.push(r.passage);

  render(main,
    h("div", { class: "panel stack" },
      h("div", { class: "center" },
        h("div", { class: "big" }, pagedOut ? "Paged out." : "End of shift."),
        h("div", { class: "muted" }, pagedOut
          ? `Prod went down ${g.outages.length} times in ${fmt(g.t / 1000)} seconds.`
          : `You held prod for the full shift. ${handedOff} open ${handedOff === 1 ? "incident" : "incidents"} handed off.`),
      ),
      statsRow([
        ["score", g.score],
        ["SEV1 fixed", `${g.resolved[1].length}/${g.seen[1]}`],
        ["SEV2 fixed", `${g.resolved[2].length}/${g.seen[2]}`],
        ["SEV3 fixed", `${g.resolved[3].length}/${g.seen[3]}`],
        ["MTTR", Number.isFinite(mttr) ? `${fmt(mttr, 1)}s` : "-"],
        ["downtime", `${downtime} min`],
        ["accuracy", pct(g.keystrokes ? (g.keystrokes - g.mistakes) / g.keystrokes : 1)],
      ]),
      h("p", { class: "oc-triage" }, triage),
      lessons.length
        ? [h("div", { class: "muted" }, "What you fixed today:"), lessons.slice(0, 3).map(lessonCard)]
        : h("p", { class: "muted" }, "Nothing resolved this shift, so no lessons yet."),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: startShift }, "Take another shift"),
        h("span", { class: "muted" }, "or press ", h("kbd", {}, "Enter")),
      ),
    ),
  );
}

listenKeys((key) => {
  if (phase === "intro" || phase === "end") { if (key === "Enter") startShift(); return; }
  if (phase === "play") onPlayKey(key);
});

showIntro();
