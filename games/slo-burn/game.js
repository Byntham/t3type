// SLO Burn: every keystroke serves one request. The gap since the last
// keystroke (right or wrong) is that request's latency. Gaps over the latency
// target burn error budget, typos also burn a fixed amount, and at 0 the
// service is down. Passages chain until then. Each new passage gets a short
// read time before the clock starts, and the target tightens 5% per passage.
// The postmortem shows where the budget went.
import { TypingSession, TextView, listenKeys, loop, now, wpm } from "../../shared/engine.js";
import { PASSAGES, rng, getSeed, shuffle } from "../../shared/content.js";
import { mountShell, h, render, lessonCard, statsRow, fmt, pct, exposeState } from "../../shared/ui.js";

const TARGETS = [
  { key: "1", name: "Easy", ms: 600 },
  { key: "2", name: "Normal", ms: 400 },
  { key: "3", name: "Hard", ms: 250 },
];
const BUDGET = 100;
const BURN_PER_TARGET = 4; // budget burned per full target of overage
const TYPO_BURN = 3;
const READ_MS = 1500; // read time at the start of each new passage
const TIGHTEN = 0.95; // target multiplier per completed passage
const MIN_TARGET = 60;

const main = mountShell({ title: "SLO Burn", tagline: "Your p99 is the product." });

// Seeded passage queue. Reshuffles when it runs out, so a run never ends
// for lack of traffic.
const rand = rng(getSeed());
let queue = [];
function nextPassage() {
  if (!queue.length) queue = shuffle(PASSAGES, rand);
  return queue.shift();
}

let phase = "setup"; // setup | run | outage
let targetIdx = 1;
let run = null;

exposeState("slo-burn", () => {
  const s = run?.session;
  const sorted = run ? sortedGaps() : [];
  return {
    phase,
    target: run?.target ?? TARGETS[targetIdx].ms,
    baseTarget: TARGETS[targetIdx].ms,
    targetName: TARGETS[targetIdx].name,
    readLeft: run && phase === "run" ? Math.round(readLeft()) : 0,
    budget: run ? +effectiveBudget().toFixed(2) : BUDGET,
    served: run?.served ?? 0,
    typos: run?.typos ?? 0,
    passages: run?.passages.map((p) => p.id) ?? [],
    passageId: run?.passages.at(-1)?.id,
    text: s?.text,
    pos: s?.pos,
    gaps: run?.gaps.length ?? 0,
    p50: q(sorted, 0.5), p95: q(sorted, 0.95), p99: q(sorted, 0.99),
    cause: run?.cause ?? null,
    timeout: run?.timeout ? { ms: Math.round(run.timeout.ms), burn: +run.timeout.burn.toFixed(2) } : null,
    worst: run ? worstGaps(5).map((g) => ({ ms: Math.round(g.ms), bigram: g.bigram })) : [],
  };
});

// ---------- stats helpers ----------
function q(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, i)]);
}
function sortedGaps() { return run.gaps.map((g) => g.ms).sort((a, b) => a - b); }
function worstGaps(n) { return [...run.gaps].sort((a, b) => b.ms - a.ms).slice(0, n); }
function burnFor(ms, target) { return (Math.max(0, ms - target) / target) * BURN_PER_TARGET; }
// run.clockAt is when the in-flight request started: the last keystroke of
// any kind, or the end of a new passage's read time (which is in the future
// while the player reads). null means no clock yet (before the first key).
function pendingMs() { return run.clockAt == null ? 0 : Math.max(0, now() - run.clockAt); }
function readLeft() { return run.clockAt == null ? 0 : Math.max(0, run.clockAt - now()); }
function targetFor(passageCount) {
  return Math.max(MIN_TARGET, Math.round(TARGETS[targetIdx].ms * TIGHTEN ** Math.max(0, passageCount - 1)));
}
function effectiveBudget() {
  if (!run) return BUDGET;
  if (phase !== "run") return Math.max(0, run.budget);
  return Math.max(0, run.budget - burnFor(pendingMs(), run.target));
}
function showChar(c) { return c === " " ? "␣" : c; }

// ---------- setup ----------
function showSetup() {
  phase = "setup";
  run = null;
  const cards = TARGETS.map((t, i) =>
    h("button", {
      class: "sb-target" + (i === targetIdx ? " on" : ""),
      onclick: () => { targetIdx = i; showSetup(); },
    },
      h("div", {}, h("kbd", {}, t.key), " ", h("b", {}, t.name)),
      h("div", { class: "sb-target-ms" }, `${t.ms} ms`),
      h("div", { class: "muted sb-target-wpm" }, `about ${fmt(wpm(1, t.ms))} wpm, every key`),
    ),
  );
  render(main,
    h("div", { class: "panel stack" },
      h("div", {}, h("span", { class: "pill" }, "on call"), " ", h("b", {}, "You run a service with a latency SLO.")),
      h("ul", { class: "sb-rules" },
        h("li", {}, "Each keystroke serves one request. Its latency is the gap since your last keystroke, right or wrong."),
        h("li", {}, "A gap over the target burns error budget. The further over, the more it burns."),
        h("li", {}, `A typo is a failed request. Its gap counts like any other, plus ${TYPO_BURN} points. The next gap starts from the typo.`),
        h("li", {}, `Passages keep coming. Each new one gives you ${READ_MS / 1000}s to read. Then the clock runs.`),
        h("li", {}, "Traffic rises. The target drops 5% after each passage."),
        h("li", {}, "When the budget hits 0, you have an outage."),
        h("li", {}, "Your score is characters served before the outage."),
      ),
      h("div", { class: "sb-targets" }, cards),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: startRun }, "Go live"),
        h("span", { class: "muted" }, "Pick a target with ", h("kbd", {}, "1"), " ", h("kbd", {}, "2"), " ", h("kbd", {}, "3"), ". Press ", h("kbd", {}, "Enter"), " to go live."),
      ),
    ),
  );
}

// ---------- run ----------
const hud = {};

function startRun() {
  const target = TARGETS[targetIdx].ms;
  run = {
    target,
    budget: BUDGET,
    served: 0,
    typos: 0,
    typoBurn: 0,
    latencyBurn: 0,
    gaps: [], // {ms, target, bigram, burn, passage, failed}
    timeout: null, // {ms, bigram, burn}: the request that hung and caused the outage
    history: [BUDGET], // budget after each keystroke
    passages: [],
    session: null,
    view: null,
    clockAt: null, // see pendingMs()
    firstAt: null,
    endedAt: null,
    cause: null,
    stopLoop: null,
  };
  phase = "run";

  hud.bar = h("div", { class: "sb-bar-fill" });
  hud.budgetText = h("span", { class: "sb-budget-num" }, "100.0");
  hud.spark = h("div", { class: "sb-spark" });
  hud.p50 = h("div", { class: "v" }, "-");
  hud.p95 = h("div", { class: "v" }, "-");
  hud.p99 = h("div", { class: "v" }, "-");
  hud.served = h("div", { class: "v" }, "0");
  hud.flight = h("div", { class: "v" }, "-");
  hud.flightLabel = h("div", { class: "l" }, "in flight");
  hud.flightBox = h("div", { class: "stat sb-flight" }, hud.flight, hud.flightLabel);
  hud.batch = h("span", { class: "pill" }, "batch 1");
  hud.target = h("span", { class: "pill sb-target-pill" }, `target ${target} ms`);
  hud.msg = h("span", { class: "muted" }, "Waiting for the first request. Start typing.");
  hud.text = h("div", {});
  const stat = (v, l) => h("div", { class: "stat" }, v, h("div", { class: "l" }, l));

  render(main,
    h("div", { class: "panel stack sb-run" },
      h("div", { class: "sb-budget" },
        h("div", { class: "sb-budget-head" },
          h("b", {}, "Error budget"),
          h("span", {}, hud.budgetText, h("span", { class: "muted" }, " / 100")),
        ),
        h("div", { class: "sb-bar" }, hud.bar),
        hud.spark,
      ),
      h("div", { class: "stats" },
        stat(hud.p50, "p50 ms"), stat(hud.p95, "p95 ms"), stat(hud.p99, "p99 ms"),
        hud.flightBox, stat(hud.served, "served"),
      ),
      h("div", { class: "row" }, hud.batch, hud.target, hud.msg),
      hud.text,
    ),
  );
  loadPassage();
  let lastStats = 0;
  run.stopLoop = loop((dt, t) => {
    if (phase !== "run") return;
    const eff = effectiveBudget();
    if (run.clockAt != null && eff <= 0) {
      // The in-flight request timed out and took the last of the budget.
      // It is the outage cause, not a served request, so it stays out of
      // the percentiles, the histogram and the tail numbers.
      const s = run.session;
      const i = s.pos;
      run.timeout = { ms: pendingMs(), bigram: (i > 0 ? s.text[i - 1] : " ") + s.text[i], burn: Math.max(0, run.budget) };
      run.budget = 0;
      outage("timeout");
      return;
    }
    paintBudget(eff);
    if (t - lastStats > 120) { lastStats = t; paintStats(); }
  });
}

function loadPassage() {
  const p = nextPassage();
  run.passages.push(p);
  run.session = new TypingSession(p.text, { allowBackspace: false, blockOnError: true });
  run.view = new TextView(hud.text, p.text);
  run.view.paint(run.session);
  run.target = targetFor(run.passages.length);
  hud.batch.textContent = `batch ${run.passages.length}`;
  hud.target.textContent = `target ${run.target} ms`;
  if (run.passages.length > 1) {
    // The first passage waits for the first key. Later ones get a fixed read time.
    run.clockAt = now() + READ_MS;
    hud.msg.textContent = `New batch. Target is now ${run.target} ms. You have ${READ_MS / 1000}s to read.`;
  }
}

// One rule for every keystroke, right or wrong: it closes the gap since the
// last keystroke (or since the read time ended) and that gap is charged as
// latency once. A wrong key also burns TYPO_BURN. The next gap starts here.
function onKey(key) {
  const s = run.session;
  const r = s.input(key);
  if (r.kind !== "ok" && r.kind !== "blocked") return;
  const t = now();
  const i = r.index;
  const failed = r.kind === "blocked";
  let cause = null;
  if (run.firstAt == null) run.firstAt = t;
  if (run.clockAt != null && t > run.clockAt) {
    const ms = t - run.clockAt;
    const burn = burnFor(ms, run.target);
    run.latencyBurn += burn;
    run.budget -= burn;
    run.gaps.push({ ms, target: run.target, bigram: (i > 0 ? s.text[i - 1] : " ") + s.text[i], burn, passage: run.passages.length - 1, failed });
    if (burn > 0) flash("sb-burn");
    if (run.budget <= 0) cause = "latency";
  }
  run.clockAt = t;
  hud.msg.textContent = "Live. Keep every gap under the target.";
  if (failed) {
    run.typos++;
    run.typoBurn += Math.min(TYPO_BURN, Math.max(0, run.budget));
    run.budget -= TYPO_BURN;
    if (!cause && run.budget <= 0) cause = "typo";
    flash("sb-typo");
  } else run.served++;
  run.history.push(Math.max(0, run.budget));
  run.view.paint(s);
  if (run.budget <= 0) { run.budget = 0; outage(cause ?? "latency"); return; }
  if (s.done) loadPassage();
}

function flash(cls) {
  const el = main.querySelector(".sb-run");
  if (!el) return;
  el.classList.remove("sb-burn", "sb-typo");
  void el.offsetWidth;
  el.classList.add(cls);
}

function budgetColor(b) {
  return b > 50 ? "var(--good)" : b > 20 ? "var(--warn)" : "var(--bad)";
}

function paintBudget(eff) {
  hud.bar.style.width = `${eff}%`;
  hud.bar.style.background = budgetColor(eff);
  hud.budgetText.textContent = fmt(eff, 1);
  const inFlight = pendingMs();
  const reading = readLeft();
  hud.flightBox.classList.toggle("reading", reading > 0);
  if (reading > 0) {
    hud.flight.textContent = `${fmt(reading / 1000, 1)}s`;
    hud.flightLabel.textContent = "read time";
    hud.flightBox.classList.remove("over");
  } else if (run.clockAt == null) {
    hud.flight.textContent = "-";
    hud.flightLabel.textContent = "in flight";
    hud.flightBox.classList.remove("over");
  } else {
    hud.flight.textContent = fmt(inFlight);
    hud.flightLabel.textContent = "in flight";
    hud.flightBox.classList.toggle("over", inFlight > run.target);
  }
}

function paintStats() {
  const sorted = sortedGaps();
  const color = (v) => (v != null && v > run.target ? "var(--bad)" : "");
  for (const [el, p] of [[hud.p50, 0.5], [hud.p95, 0.95], [hud.p99, 0.99]]) {
    const v = q(sorted, p);
    el.textContent = v == null ? "-" : v;
    el.style.color = color(v);
  }
  hud.served.textContent = run.served;
  render(hud.spark, sparkline([...run.history, effectiveBudget()], 600, 44));
}

// Budget burn-down as an inline SVG polyline. Values are 0..100.
function sparkline(values, w, ht, { axis = false } = {}) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${ht}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "sb-spark-svg");
  const n = Math.max(2, values.length);
  const pts = values.map((v, i) => `${((i / (n - 1)) * w).toFixed(1)},${(ht - (v / BUDGET) * (ht - 2) - 1).toFixed(1)}`);
  const area = document.createElementNS(NS, "polygon");
  area.setAttribute("points", `0,${ht} ${pts.join(" ")} ${(((values.length - 1) / (n - 1)) * w).toFixed(1)},${ht}`);
  area.setAttribute("class", "sb-spark-area");
  const line = document.createElementNS(NS, "polyline");
  line.setAttribute("points", pts.join(" "));
  line.setAttribute("class", "sb-spark-line");
  line.setAttribute("vector-effect", "non-scaling-stroke");
  if (axis) {
    for (const v of [50, 20]) {
      const l = document.createElementNS(NS, "line");
      const y = ht - (v / BUDGET) * (ht - 2) - 1;
      l.setAttribute("x1", 0); l.setAttribute("x2", w); l.setAttribute("y1", y); l.setAttribute("y2", y);
      l.setAttribute("class", "sb-spark-grid");
      l.setAttribute("vector-effect", "non-scaling-stroke");
      svg.appendChild(l);
    }
  }
  svg.append(area, line);
  return svg;
}

// ---------- outage / postmortem ----------
function outage(cause) {
  phase = "outage";
  run.cause = cause;
  run.endedAt = now();
  run.history.push(0);
  run.stopLoop?.();
  showPostmortem();
}

// Bins are quarter-target wide, measured against the target each request
// had. Each bin covers (lo, hi], so a gap exactly at the target counts as
// inside, the same as the in-SLO stat.
function histogram(gaps) {
  const nBins = 13; // 0 .. 3x target, last bin is the overflow
  const bins = new Array(nBins).fill(0);
  for (const g of gaps) {
    const r = g.ms / g.target;
    bins[Math.min(nBins - 1, Math.max(0, Math.ceil(r * 4) - 1))]++;
  }
  const max = Math.max(1, ...bins);
  const x = (k) => `${k / 4}x`;
  return h("div", { class: "sb-hist-wrap" },
    h("div", { class: "sb-hist" },
      bins.map((c, i) => h("div", {
        class: "sb-hist-col",
        title: i === nBins - 1 ? `over ${x(i)} target: ${c}` : `${x(i)} to ${x(i + 1)} target: ${c}`,
      },
        h("div", { class: "sb-hist-n" }, c ? String(c) : ""),
        h("div", { class: "sb-hist-bar" + (i >= 4 ? " over" : "") + (c ? "" : " empty"), style: { height: `${(c / max) * 100}%` } }),
      )),
      h("div", { class: "sb-hist-target", style: { left: `${(4 / nBins) * 100}%` } }, h("span", {}, "target")),
    ),
    h("div", { class: "sb-hist-axis" },
      h("span", {}, "0"),
      h("span", { style: { left: `${(4 / nBins) * 100}%` } }, "1x"),
      h("span", { style: { left: `${(8 / nBins) * 100}%` } }, "2x"),
      h("span", { style: { left: `${(12 / nBins) * 100}%` } }, "3x+"),
    ),
  );
}

function showPostmortem() {
  const { gaps, target } = run;
  const startTarget = TARGETS[targetIdx].ms;
  const sorted = sortedGaps();
  const total = gaps.reduce((a, g) => a + g.ms, 0);
  const mean = gaps.length ? total / gaps.length : 0;
  const p50 = q(sorted, 0.5), p95 = q(sorted, 0.95), p99 = q(sorted, 0.99);
  const inSlo = gaps.length ? gaps.filter((g) => g.ms <= g.target).length / gaps.length : 1;
  const meanWpm = wpm(gaps.length, total);
  let peakWpm = 0;
  const W = 20;
  for (let i = W; i <= gaps.length; i++) {
    let sum = 0;
    for (let k = i - W; k < i; k++) sum += gaps[k].ms;
    peakWpm = Math.max(peakWpm, wpm(W, sum));
  }
  // How much of the latency burn came from the slowest 1% of requests?
  const byMs = [...gaps].sort((a, b) => b.ms - a.ms);
  const tailN = Math.max(1, Math.ceil(gaps.length * 0.01));
  const tailBurn = byMs.slice(0, tailN).reduce((a, g) => a + g.burn, 0);
  const tailShare = run.latencyBurn > 0 ? tailBurn / run.latencyBurn : 0;
  const worst = byMs.slice(0, 5);
  const secs = run.firstAt != null ? (run.endedAt - run.firstAt) / 1000 : 0;
  const t = TARGETS[targetIdx];

  const last = gaps.at(-1);
  const hung = run.timeout;
  const causeText = {
    timeout: `A request hung for ${fmt((hung?.ms ?? 0) / 1000, 1)}s and burned the last ${fmt(hung?.burn ?? 0, 1)} points. It timed out, so it is not in the percentiles or the histogram.`,
    latency: `A ${fmt(last?.ms ?? 0)} ms request burned the last of the budget.`,
    typo: "A failed request (a typo) burned the last of the budget.",
  }[run.cause];

  const typed = run.passages.map((p, i) => {
    const done = i < run.passages.length - 1;
    return h("div", { class: "stack" },
      h("div", { class: "muted sb-batch-label" }, `Batch ${i + 1}. ${done ? "Served." : "Down mid-batch."}`),
      lessonCard(p),
    );
  });

  render(main,
    h("div", { class: "panel stack sb-pm" },
      h("div", { class: "row" }, h("span", { class: "pill sb-down" }, "OUTAGE"), h("b", {}, "Postmortem")),
      h("div", { class: "center" },
        h("div", { class: "big" }, String(run.served)),
        h("div", { class: "muted" }, `characters served on ${t.name} in ${fmt(secs, 1)}s. ` + (target < startTarget ? `The target went from ${startTarget} ms to ${target} ms.` : `The target was ${target} ms.`)),
      ),
      h("p", { class: "sb-cause" }, h("b", {}, "Cause. "), causeText),
      statsRow([
        ["p50", `${p50 ?? "-"} ms`],
        ["p95", `${p95 ?? "-"} ms`],
        ["p99", `${p99 ?? "-"} ms`],
        ["in SLO", pct(inSlo)],
        ["typos", run.typos],
        ["avg wpm", fmt(meanWpm)],
        ["peak wpm", fmt(peakWpm)],
      ]),
      h("div", { class: "sb-finding" },
        h("p", {}, `Your average gap was ${fmt(mean)} ms. Your p99 was ${p99 ?? "-"} ms. `,
          `The slowest 1% of requests (${tailN}) burned ${pct(tailShare)} of the latency budget.`),
        h("p", {}, `Latency burned ${fmt(run.latencyBurn, 1)} points. Typos burned ${fmt(run.typoBurn, 1)}. `,
          hung ? `The hung request burned ${fmt(hung.burn, 1)}. ` : "",
          peakWpm > 0 ? `Your fastest burst hit ${fmt(peakWpm)} wpm, but speed does not refund budget. Only the slow requests count.` : ""),
      ),
      h("h3", {}, "Latency histogram"),
      histogram(gaps),
      h("div", { class: "muted sb-caption" }, "Each request against the target it had. A gap exactly on the target counts as inside."),
      h("h3", {}, "Five worst requests"),
      h("table", { class: "sb-table" },
        h("tr", {}, h("th", {}, "#"), h("th", {}, "latency"), h("th", {}, "key pair"), h("th", {}, "budget burned")),
        worst.map((g, i) => h("tr", {},
          h("td", {}, String(i + 1)),
          h("td", {}, `${fmt(g.ms)} ms${g.failed ? " (typo)" : ""}`),
          h("td", { class: "sb-keys" }, h("span", { class: "sb-bigram" }, showChar(g.bigram[0])), h("span", { class: "sb-bigram" }, showChar(g.bigram[1]))),
          h("td", { class: g.burn > 0 ? "sb-bad" : "" }, fmt(g.burn, 1)),
        )),
      ),
      h("h3", {}, "Budget burn-down"),
      h("div", { class: "sb-spark sb-spark-big" }, sparkline(run.history, 600, 120, { axis: true })),
      h("div", { class: "muted sb-caption" }, "Budget left after each request. Dashed lines at 50 and 20."),
      h("h3", {}, "What you served"),
      typed,
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: showSetup }, "Play again"),
        h("span", { class: "muted" }, h("kbd", {}, "Enter"), " play again"),
      ),
    ),
  );
}

// ---------- keys ----------
listenKeys((key) => {
  if (phase === "setup") {
    const i = TARGETS.findIndex((t) => t.key === key);
    if (i >= 0) { targetIdx = i; showSetup(); return; }
    if (key === "Enter") startRun();
    return;
  }
  if (phase === "run") {
    if (key.length !== 1) return;
    onKey(key);
    return;
  }
  if (phase === "outage" && key === "Enter") showSetup();
});

showSetup();
