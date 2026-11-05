// Context Switch: two tasks side by side. Every 8 to 15 seconds a ping pulls
// you to the other task. The game measures how slow your first keystrokes
// are after each switch, compared with your steady pace, and adds up the
// time those warm-ups cost.
import { TypingSession, TextView, listenKeys, loop, now, wpm } from "../../shared/engine.js";
import { rng, getSeed, shuffle, filterPassages } from "../../shared/content.js";
import { mountShell, h, render, lessonCard, statsRow, fmt, exposeState } from "../../shared/ui.js";

const WARM = 8; // keystrokes after a switch that count as warm-up
const INTERRUPT_MIN = 8000, INTERRUPT_MAX = 15000;
const IDLE_CAP = 2000; // steady gaps longer than this are breaks, not pace
const LABELS = ["A", "B"];
const PEOPLE = ["Priya", "Sam", "Dana", "Lee", "Mo", "Ana"];
const PINGS = [
  "Quick one about Task {T}. Got a sec?",
  "Task {T} is blocking the release. Can you look?",
  "Hey, can you pick Task {T} back up for a minute?",
  "Any update on Task {T}?",
  "Prod alert. Need eyes on Task {T} now.",
  "Sorry to bug you. Task {T}?",
  "Standup moved. Also, Task {T}?",
];

const main = mountShell({ title: "Context Switch", tagline: "Every interrupt has a warm-up cost." });

const seed = getSeed();
const passRand = rng(seed);
const pingRand = rng(seed ^ 0x5bd1e995);
let queue = [];
function nextPair() {
  if (queue.length < 2) queue = shuffle(filterPassages({ minLen: 100 }), passRand);
  return [queue.shift(), queue.shift()];
}

let phase = "intro"; // intro | work | report
let pair = nextPair();
let game = null;

exposeState("context-switch", () => {
  const g = game;
  const cur = g?.switches.at(-1);
  return {
    phase,
    passages: pair.map((p) => p.id),
    activeIdx: g?.active ?? 0,
    active: LABELS[g?.active ?? 0],
    tasks: g ? g.tasks.map((t) => ({ id: t.passage.id, text: t.session.text, pos: t.session.pos, done: t.session.done })) : [],
    interrupts: g ? g.switches.filter((s) => s.kind === "interrupt").length : 0,
    warm: cur ? cur.keys.length : null,
    lostMs: g ? Math.round(lostMs(g)) : 0,
    steadyMs: g ? Math.round(steadyMean(g) ?? 0) : null,
    nextInterruptIn: g?.nextAt != null ? Math.round(g.nextAt - now()) : null,
    switches: g ? g.switches.map((s) => ({ kind: s.kind, to: LABELS[s.to], keys: s.keys.length, cost: Math.round(switchCost(g, s).cost) })) : [],
  };
});

// ---------- measurement ----------
function steadyMean(g) {
  if (g.steady.length >= 5) return g.steady.reduce((a, b) => a + b, 0) / g.steady.length;
  return null;
}
// Warm-up cost: time to get WARM keys in after the switch, minus what those
// keys would take at steady pace. The switch moment counts as the start, so
// the pause to reorient is part of the cost.
function switchCost(g, s) {
  const st = steadyMean(g);
  if (!s.keys.length || st == null) return { warm: 0, expected: 0, cost: 0 };
  const warm = s.keys.at(-1) - s.at;
  const expected = s.keys.length * st;
  return { warm, expected, cost: Math.max(0, warm - expected) };
}
function lostMs(g) {
  return g.switches.filter((s) => s.kind === "interrupt").reduce((a, s) => a + switchCost(g, s).cost, 0);
}

// ---------- intro ----------
function showIntro() {
  phase = "intro";
  game = null;
  render(main,
    h("div", { class: "panel stack" },
      h("div", {}, h("span", { class: "pill" }, "two tasks"), " ", h("b", {}, "Finish both tasks. Expect interruptions.")),
      h("ul", { class: "cs-rules" },
        h("li", {}, "You type in one task at a time. The other waits."),
        h("li", {}, "Every 8 to 15 seconds, a ping pulls you to the other task. Pick up where you left off."),
        h("li", {}, `The game times your first ${WARM} keys after each switch and compares them with your normal pace.`),
        h("li", {}, "The difference is time lost to switching. Typos block until fixed."),
      ),
      h("div", { class: "cs-preview" },
        pair.map((p, i) => h("div", { class: "cs-preview-task" },
          h("b", {}, `Task ${LABELS[i]}`), h("span", { class: "muted" }, ` ${p.text.length} chars, ${p.topic}`))),
      ),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: startWork }, "Start Task A"),
        h("span", { class: "muted" }, "Press ", h("kbd", {}, "Enter"), " to start. The clock starts on your first key."),
      ),
    ),
  );
}

// ---------- work ----------
const ui = {};

function startWork() {
  phase = "work";
  game = {
    tasks: pair.map((p) => ({ passage: p, session: new TypingSession(p.text, { allowBackspace: false, blockOnError: true }) })),
    active: 0,
    switches: [], // {kind: "start" | "interrupt" | "handoff", at, from, to, keys: [t], who, msg}
    steady: [], // gaps between keys at normal pace
    lastOkAt: null,
    startedAt: null,
    endedAt: null,
    nextAt: null,
    typos: 0,
    stop: null,
  };
  ui.lost = h("div", { class: "v cs-lost" }, "0.0s");
  ui.clock = h("div", { class: "v" }, "0.0s");
  ui.count = h("div", { class: "v" }, "0");
  ui.pace = h("div", { class: "v" }, "-");
  ui.toasts = h("div", { class: "cs-toasts", "aria-live": "polite" });
  ui.panels = game.tasks.map((t, i) => {
    const text = h("div", {});
    const pill = h("span", { class: "pill" });
    const prog = h("span", { class: "muted cs-prog" });
    const warm = h("div", { class: "cs-warm" });
    const el = h("section", { class: "panel cs-task" },
      h("div", { class: "cs-task-head" }, h("b", {}, `Task ${LABELS[i]}`), pill, prog),
      warm,
      text,
    );
    t.view = new TextView(text, t.passage.text);
    return { el, pill, prog, warm };
  });
  const stat = (v, l) => h("div", { class: "stat" }, v, h("div", { class: "l" }, l));
  render(main,
    h("div", { class: "stack" },
      h("div", { class: "stats" },
        stat(ui.clock, "elapsed"), stat(ui.count, "interrupts"), stat(ui.pace, "steady wpm"),
        h("div", { class: "stat cs-lost-box" }, ui.lost, h("div", { class: "l" }, "lost to switching")),
      ),
      h("div", { class: "cs-tasks" }, ui.panels.map((p) => p.el)),
      h("div", { class: "hint" }, "Just type. The game moves your cursor when a ping lands."),
    ),
    ui.toasts,
  );
  game.switches.push({ kind: "start", at: null, from: null, to: 0, keys: [] });
  paintTasks();
  game.stop = loop(tick);
}

function paintTasks() {
  const g = game;
  g.tasks.forEach((t, i) => {
    const p = ui.panels[i];
    const s = t.session;
    const isActive = i === g.active && !s.done;
    t.view.paint(s);
    p.el.classList.toggle("active", isActive);
    p.el.classList.toggle("paused", !isActive && !s.done);
    p.el.classList.toggle("done", s.done);
    p.pill.textContent = s.done ? "done" : isActive ? "active" : "paused";
    p.prog.textContent = `${Math.round((s.pos / s.text.length) * 100)}%`;
    const sw = g.switches.at(-1);
    const warming = isActive && sw && sw.kind !== "start" && sw.keys.length < WARM;
    render(p.warm, warming
      ? [h("span", { class: "cs-warm-label" }, "warming up"), Array.from({ length: WARM }, (_, k) => h("span", { class: "cs-dot" + (k < sw.keys.length ? " on" : "") }))]
      : null);
    p.warm.classList.toggle("on", !!warming);
  });
}

function switchTo(to, kind, t) {
  const g = game;
  const sw = { kind, at: t, from: g.active, to, keys: [] };
  if (kind === "interrupt") {
    sw.who = PEOPLE[Math.floor(pingRand() * PEOPLE.length)];
    sw.msg = PINGS[Math.floor(pingRand() * PINGS.length)].replace("{T}", LABELS[to]);
    toast(sw);
  }
  g.switches.push(sw);
  g.active = to;
  const el = ui.panels[to].el;
  el.classList.remove("cs-flash");
  void el.offsetWidth;
  el.classList.add("cs-flash");
  paintTasks();
  // On narrow screens the tasks stack, so bring the new one into view.
  try { el.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch { /* old browsers */ }
}

function toast(sw) {
  const el = h("div", { class: "cs-toast" },
    h("div", { class: "cs-avatar" }, sw.who[0]),
    h("div", { class: "cs-toast-body" },
      h("div", {}, h("b", {}, sw.who), h("span", { class: "muted cs-now" }, " now")),
      h("div", {}, sw.msg),
    ),
  );
  ui.toasts.appendChild(el);
  setTimeout(() => el.classList.add("out"), 3200);
  setTimeout(() => el.remove(), 3700);
}

function tick() {
  if (phase !== "work") return;
  const g = game;
  const t = now();
  if (g.startedAt != null) ui.clock.textContent = `${fmt((t - g.startedAt) / 1000, 1)}s`;
  if (g.nextAt != null && t >= g.nextAt) {
    const other = 1 - g.active;
    if (!g.tasks[other].session.done && !g.tasks[g.active].session.done) {
      switchTo(other, "interrupt", t);
      g.nextAt = t + INTERRUPT_MIN + pingRand() * (INTERRUPT_MAX - INTERRUPT_MIN);
    } else g.nextAt = null;
  }
  const lost = lostMs(g);
  ui.lost.textContent = `${fmt(lost / 1000, 1)}s`;
  ui.count.textContent = String(g.switches.filter((s) => s.kind === "interrupt").length);
  const st = steadyMean(g);
  ui.pace.textContent = st ? fmt(wpm(1, st)) : "-";
}

function onType(key) {
  const g = game;
  const task = g.tasks[g.active];
  const r = task.session.input(key);
  const t = now();
  if (r.kind === "blocked") { g.typos++; return; }
  if (r.kind !== "ok") return;
  if (g.startedAt == null) {
    g.startedAt = t;
    g.switches[0].at = t;
    g.nextAt = t + INTERRUPT_MIN + pingRand() * (INTERRUPT_MAX - INTERRUPT_MIN);
  }
  const sw = g.switches.at(-1);
  if (sw.keys.length < WARM) sw.keys.push(t);
  else if (g.lastOkAt != null && t - g.lastOkAt < IDLE_CAP) g.steady.push(t - g.lastOkAt);
  g.lastOkAt = t;

  if (task.session.done) {
    const other = 1 - g.active;
    if (g.tasks[other].session.done) { finish(t); return; }
    switchTo(other, "handoff", t);
    return;
  }
  paintTasks();
}

function finish(t) {
  const g = game;
  g.endedAt = t;
  g.stop?.();
  phase = "report";
  showReport();
}

// ---------- report ----------
function showReport() {
  const g = game;
  const total = g.endedAt - g.startedAt;
  const lost = lostMs(g);
  const st = steadyMean(g) ?? total / Math.max(1, g.tasks.reduce((a, t) => a + t.passage.text.length, 0));
  const ints = g.switches.filter((s) => s.kind === "interrupt");
  const warmKeys = ints.reduce((a, s) => a + s.keys.length, 0);
  const warmTime = ints.reduce((a, s) => a + (s.keys.length ? s.keys.at(-1) - s.at : 0), 0);
  const rows = g.switches.filter((s) => s.kind !== "start" && s.keys.length);
  const maxMs = Math.max(1, ...rows.map((s) => s.keys.at(-1) - s.at));
  const handoff = rows.find((s) => s.kind === "handoff");

  const head = ints.length
    ? `${ints.length} interrupt${ints.length === 1 ? "" : "s"} cost you ${fmt(lost / 1000, 1)}s.`
    : "No interrupts landed this time.";
  let n = 0;
  render(main,
    h("div", { class: "panel stack cs-report" },
      h("div", { class: "center" },
        h("div", { class: "big cs-lost" }, `+${fmt(lost / 1000, 1)}s`),
        h("div", { class: "muted" }, "lost to context switching"),
      ),
      h("div", { class: "cs-finding" },
        h("p", {}, h("b", {}, head), ` You finished both tasks in ${fmt(total / 1000, 1)}s. With zero interrupts you would have finished in about ${fmt((total - lost) / 1000, 1)}s.`),
        ints.length ? h("p", {}, `At your steady pace a key took ${fmt(st)} ms. In the first ${WARM} keys after a ping, it took ${fmt(warmKeys ? warmTime / warmKeys : 0)} ms. That warm-up is reloading the task into your head.`) : null,
        handoff ? h("p", { class: "muted" }, `Even the planned handoff from A to B cost ${fmt(switchCost(g, handoff).cost / 1000, 2)}s. You pay that once no matter what. Interrupts make you pay it again and again.`) : null,
      ),
      statsRow([
        ["total", `${fmt(total / 1000, 1)}s`],
        ["no-interrupt est.", `${fmt((total - lost) / 1000, 1)}s`],
        ["interrupts", ints.length],
        ["steady wpm", fmt(wpm(1, st))],
        ["warm-up wpm", warmKeys ? fmt(wpm(warmKeys, warmTime)) : "-"],
        ["typos", g.typos],
      ]),
      h("h3", {}, "Cost of each switch"),
      rows.length ? h("div", { class: "cs-switches" },
        rows.map((s) => {
          const c = switchCost(g, s);
          const warmMs = s.keys.at(-1) - s.at;
          const label = s.kind === "interrupt" ? `#${++n} to ${LABELS[s.to]}` : `handoff to ${LABELS[s.to]}`;
          return h("div", { class: "cs-sw" + (s.kind === "handoff" ? " handoff" : "") },
            h("div", { class: "cs-sw-label" }, h("b", {}, label), h("span", { class: "muted" }, ` at ${fmt((s.at - g.startedAt) / 1000, 1)}s`)),
            h("div", { class: "cs-sw-track", title: `${s.keys.length} keys in ${fmt(warmMs)} ms. Steady pace would take ${fmt(c.expected)} ms.` },
              h("div", { class: "cs-sw-base", style: { width: `${(Math.min(c.expected, warmMs) / maxMs) * 100}%` } }),
              h("div", { class: "cs-sw-cost", style: { width: `${(c.cost / maxMs) * 100}%` } }),
            ),
            h("div", { class: "cs-sw-val" }, `+${fmt(c.cost)} ms`),
          );
        }),
        h("div", { class: "muted cs-caption" },
          h("span", { class: "cs-legend" }, h("span", { class: "cs-key base" }), ` time ${WARM} keys take at your steady pace`),
          h("span", { class: "cs-legend" }, h("span", { class: "cs-key cost" }), " extra time after the switch")),
      ) : h("p", { class: "muted" }, "No switches to show."),
      h("h3", {}, "What the tasks said"),
      g.tasks.map((t, i) => h("div", { class: "stack" }, h("div", { class: "muted cs-task-label" }, `Task ${LABELS[i]}`), lessonCard(t.passage))),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: playAgain }, "Play again"),
        h("span", { class: "muted" }, h("kbd", {}, "Enter"), " two new tasks"),
      ),
    ),
  );
}

function playAgain() {
  pair = nextPair();
  showIntro();
}

// ---------- keys ----------
listenKeys((key) => {
  if (phase === "intro") { if (key === "Enter") startWork(); return; }
  if (phase === "work") { if (key.length === 1) onType(key); return; }
  if (phase === "report" && key === "Enter") playAgain();
});

showIntro();
