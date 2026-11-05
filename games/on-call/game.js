// On-Call: incidents fall toward prod. Type one to resolve it.
// The mechanic teaches triage: SEV1s fall fastest and cost the most, so
// they come first even when a SEV3 looks easier.
import { listenKeys, loop } from "../../shared/engine.js";
import { PASSAGES, rng, getSeed, shuffle } from "../../shared/content.js";
import { mountShell, h, render, lessonCard, statsRow, fmt, pct, exposeState } from "../../shared/ui.js";

const main = mountShell({ title: "On-Call", tagline: "Triage first. Then fix." });

const SHIFT_MS = 90_000;
const LIVES = 3;
const PENALTY = 5; // points lost per minute of downtime
// fall: seconds to reach prod at the start of the shift. Slow enough that
// about 3 incidents in flight is workable at 40 to 50 wpm.
const SEV = {
  1: { label: "SEV1", points: 100, fall: 24, downtime: 45 },
  2: { label: "SEV2", points: 30, fall: 28, downtime: 15 },
  3: { label: "SEV3", points: 10, fall: 34, downtime: 5 },
};
const LATE_SPEEDUP = 0.15; // falls get this much faster by the end of the shift

const rand = rng(getSeed());

// Incidents are whole clauses, so each one reads as a complete thought.
// Split only at clause punctuation: . ; : ? ! and commas that start a new
// clause. Drop pieces that are too short, too long, end on a function word,
// start with a quote, paren or digit, or leave a paren or quote open.
const MIN_LEN = 12, MAX_LEN = 48;
const FUNCTION_WORDS = new Set("to the a an of and or but for with in on at is that".split(" "));
const CLAUSE_START = new Set(("and but so or yet because since while when whenever if unless until although though " +
  "which who where then otherwise i you we they he she it this that these those there it's you're we're they're i'm don't").split(" "));
const firstWord = (s) => s.split(/\s/)[0].toLowerCase().replace(/[^a-z']/g, "");
const lastWord = (s) => s.split(/\s+/).at(-1).toLowerCase().replace(/[^a-z']/g, "");
const count = (s, re) => (s.match(re) || []).length;

function goodPhrase(s) {
  if (s.length < MIN_LEN || s.length > MAX_LEN) return false;
  if (/^["'(\[\d\u201c\u2018]/.test(s)) return false;
  if (FUNCTION_WORDS.has(lastWord(s))) return false;
  if (count(s, /\(/g) !== count(s, /\)/g) || count(s, /"/g) % 2) return false;
  return true;
}

function incidentPhrases(text) {
  if (text.length <= MAX_LEN) return goodPhrase(text) ? [text] : [];
  const out = [];
  for (const sentence of text.split(/(?<=[.;:?!])\s+/)) {
    const pieces = [""];
    sentence.split(/(?<=,)\s+/).forEach((part, k) => {
      if (k > 0 && CLAUSE_START.has(firstWord(part))) pieces.push(part);
      else pieces[pieces.length - 1] += (pieces[pieces.length - 1] ? " " : "") + part;
    });
    out.push(...pieces);
  }
  return out.map((s) => s.trim().replace(/[,;:(-]+$/, "").trim()).filter(goodPhrase);
}

// Build the incident pool once. Each phrase keeps a link to its passage so
// you can see the lesson it belongs to.
const POOL = { 1: [], 2: [], 3: [] };
for (const p of shuffle(PASSAGES, rand)) {
  for (const text of incidentPhrases(p.text)) {
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
  score: g ? score() : 0,
  points: g?.points,
  downtime: g?.downtime,
  target: g ? target() : 0,
  locked: g?.locked?.id ?? null,
  incidents: g ? g.incidents.map((i) => ({ id: i.id, sev: i.sev, text: i.text, pos: i.pos, x: Math.round(i.x), y: Math.round(i.y), w: i.w, h: i.h, lane: i.lane, passageId: i.passage.id })) : [],
  resolved: g ? { 1: g.resolved[1].length, 2: g.resolved[2].length, 3: g.resolved[3].length } : null,
  outages: g?.outages.length,
  outageSevs: g?.outages.map((o) => o.sev),
  seen: g?.seen,
  mistakes: g?.mistakes,
}));

function newShift() {
  return {
    t: 0, nextSpawn: 400, nextId: 1,
    lives: LIVES, points: 0, downtime: 0,
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
      h("p", {}, `Your score is points minus ${PENALTY} for every minute of downtime. A SEV1 that reaches prod costs ${SEV[1].downtime * PENALTY} points.`),
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
function score() { return g.points - PENALTY * g.downtime; }
// Incidents in flight to aim for: 3 for the first half, then 4, then 5 in
// the last 10 seconds.
function target() { return Math.min(5, 3 + Math.floor(2.2 * progress())); }

// Columns sized to the field. Each incident stays inside its lane.
function lanes() {
  const fw = els.field.clientWidth;
  const n = Math.max(1, Math.min(4, Math.floor(fw / (fw < 600 ? 170 : 300))));
  return { n, w: fw / n };
}

// A lane is free if its top is clear and the new incident will not catch
// up with a slower one below it before that one reaches prod.
function laneClear(lane, speed, fh) {
  let room = Infinity;
  for (const o of g.incidents) {
    if (o.lane !== lane) continue;
    if (o.y < 10) return -1;
    room = Math.min(room, o.y);
    if (speed > o.speed) {
      const catchMs = (o.y - 10) / (speed - o.speed);
      const prodMs = (fh - o.h - o.y) / o.speed;
      if (catchMs < prodMs) return -1;
    }
  }
  return room;
}

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

// Returns false if there was no phrase or no free lane. Try again soon.
function spawn() {
  const sev = pickSeverity();
  const pick = drawPhrase(sev);
  if (!pick) return false;
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
  const L = lanes();
  inc.el.style.maxWidth = `${Math.floor(L.w - 8)}px`;
  els.field.appendChild(inc.el);
  const fh = els.field.clientHeight;
  const w = inc.el.offsetWidth, ch = inc.el.offsetHeight;
  const fallSec = SEV[sev].fall * (1 - LATE_SPEEDUP * progress());
  inc.speed = (fh + ch) / (fallSec * 1000);
  // Take the free lane with the most room below its top.
  let lane = -1, bestRoom = -1;
  for (const k of shuffle([...Array(L.n).keys()], rand)) {
    const room = laneClear(k, inc.speed, fh);
    if (room > bestRoom) { lane = k; bestRoom = room; }
  }
  if (lane < 0) {
    inc.el.remove();
    g.bag[sev].unshift(pick);
    g.nextId--;
    return false;
  }
  inc.lane = lane;
  inc.x = lane * L.w + 4 + rand() * Math.max(0, L.w - w - 8);
  inc.w = w;
  inc.h = ch;
  inc.y = -ch;
  g.incidents.push(inc);
  g.seen[sev]++;
  place(inc);
  return true;
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
  // Spawn on load, not on a clock: keep about target() incidents in flight,
  // with a short gap so they do not all arrive at once.
  if (g.t >= g.nextSpawn && g.incidents.length < target()) {
    g.nextSpawn = g.t + (spawn() ? 900 + 600 * rand() : 250);
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
  g.downtime += SEV[inc.sev].downtime;
  g.outages.push({ sev: inc.sev, text: inc.text });
  inc.el.remove();
  const boom = h("div", { class: `oc-boom sev${inc.sev}`, style: { left: `${inc.x}px`, width: `${inc.w}px` } }, `${SEV[inc.sev].label} down`);
  els.field.appendChild(boom);
  setTimeout(() => boom.remove(), 900);
  els.field.classList.remove("shake");
  void els.field.offsetWidth; // restart the animation
  els.field.classList.add("shake");
  paintStatus(`${SEV[inc.sev].label} hit prod. ${SEV[inc.sev].downtime} min of downtime, -${SEV[inc.sev].downtime * PENALTY} points.`, "bad");
}

function resolve(inc) {
  removeIncident(inc);
  const ttr = g.t - inc.born;
  g.resolved[inc.sev].push({ passage: inc.passage, ttr });
  g.points += SEV[inc.sev].points;
  inc.el.classList.add("resolved");
  setTimeout(() => inc.el.remove(), 350);
  flashLesson(inc);
  paintStatus(`${SEV[inc.sev].label} resolved in ${fmt(ttr / 1000, 1)}s. +${SEV[inc.sev].points}`, "good");
}

// Show the one-line lesson of the passage this fragment came from, where
// the incident was resolved. It sits under the incidents and fades out.
function flashLesson(inc) {
  if (!inc.passage.lesson) return;
  const fw = els.field.clientWidth, fh = els.field.clientHeight;
  const w = Math.min(fw - 8, 360);
  const note = h("div", {
    class: "oc-lesson",
    style: {
      width: `${w}px`,
      left: `${Math.max(4, Math.min(inc.x, fw - w - 4))}px`,
      top: `${Math.max(4, Math.min(inc.y, fh - 110))}px`,
    },
  }, h("span", { class: "oc-lesson-l" }, "lesson "), inc.passage.lesson);
  els.field.querySelectorAll(".oc-lesson").forEach((n) => n.remove()); // one at a time
  els.field.appendChild(note);
  setTimeout(() => note.remove(), 3000);
}

function paintHud() {
  const left = Math.max(0, SHIFT_MS - g.t) / 1000;
  const mm = Math.floor(left / 60), ss = Math.floor(left % 60);
  render(els.hud,
    h("div", { class: "oc-hud-item" }, h("span", { class: "l" }, "shift"), h("span", { class: "v" }, `${mm}:${String(ss).padStart(2, "0")}`)),
    h("div", { class: "oc-hud-item" }, h("span", { class: "l" }, "score"), h("span", { class: "v" }, String(score()))),
    h("div", { class: "oc-hud-item" }, h("span", { class: "l" }, "downtime"), h("span", { class: "v" + (g.downtime ? " oc-down" : "") }, `${g.downtime}m`)),
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
  const downtime = g.downtime;
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
      h("div", { class: "oc-headline" },
        h("div", { class: "oc-head-item" },
          h("div", { class: "oc-head-v" }, String(score())),
          h("div", { class: "oc-head-l" }, "score")),
        h("div", { class: "oc-head-item" + (downtime ? " oc-down" : "") },
          h("div", { class: "oc-head-v" }, `${downtime} min`),
          h("div", { class: "oc-head-l" }, "downtime")),
      ),
      h("p", { class: "center muted oc-math" },
        `${g.points} points from fixes, minus ${downtime * PENALTY} for ${downtime} min of downtime.`),
      statsRow([
        ["SEV1 fixed", `${g.resolved[1].length}/${g.seen[1]}`],
        ["SEV2 fixed", `${g.resolved[2].length}/${g.seen[2]}`],
        ["SEV3 fixed", `${g.resolved[3].length}/${g.seen[3]}`],
        ["MTTR", Number.isFinite(mttr) ? `${fmt(mttr, 1)}s` : "-"],
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
