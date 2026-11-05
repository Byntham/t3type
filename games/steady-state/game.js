// Steady State: the tempo is a steady typing rate (characters per second,
// shown as wpm). Each word gets a time slot in proportion to its length plus
// its space, and its trailing space is due at the end of the slot. Early is
// as wrong as late. The end screen shows how even your timing was, because
// steady throughput is what ships, not bursts.
import { TypingSession, TextView, listenKeys, loop, now } from "../../shared/engine.js";
import { rng, getSeed, shuffle, filterPassages } from "../../shared/content.js";
import { mountShell, h, render, lessonCard, statsRow, fmt, pct, exposeState } from "../../shared/ui.js";

const COUNT_IN = 4;
const COUNT_CHARS = 5; // count-in beats are one "word" (5 chars) apart
const TEMPO_MIN = 12, TEMPO_MAX = 120, TEMPO_STEP = 4; // wpm
const MIN_FINISHED = 3; // fewer finished words than this is not enough data
const NS = "http://www.w3.org/2000/svg";

const main = mountShell({ title: "Steady State", tagline: "Sustainable pace beats sprints." });

const rand = rng(getSeed());
let queue = [];
function nextPassage() {
  if (!queue.length) queue = shuffle(filterPassages({ minLen: 80, maxLen: 210 }), rand);
  return queue.shift();
}

let phase = "setup"; // setup | play | results
let tempo = 36; // wpm: (chars / 5) per minute
let passage = nextPassage();
let round = null;

exposeState("steady-state", () => {
  const r = round;
  const i = r ? typingIndex() : null;
  return {
    phase, tempo, passageId: passage.id,
    msPerChar: msPerChar(tempo),
    countInLeft: r ? Math.max(0, Math.round(r.start - now())) : null,
    text: r?.session.text, pos: r?.session.pos,
    n: r?.words.length,
    wordIndex: i,
    word: r && i != null && i < r.words.length ? r.words[i].word : null,
    dueIn: r && i != null && i < r.words.length ? r.due[i] - now() : null,
    judged: r ? r.judged.filter(Boolean).length : 0,
    combo: r?.combo ?? 0, maxCombo: r?.maxCombo ?? 0,
    counts: r?.counts,
    sd: r?.summary?.sd != null ? Math.round(r.summary.sd) : null,
    audio: audioState(),
  };
});

// ---------- audio (optional; never throws) ----------
let actx = null;
function audioInit() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!actx) actx = new AC();
    if (actx.state === "suspended") actx.resume().catch(() => {});
  } catch { actx = null; }
}
function audioState() { try { return actx ? actx.state : "off"; } catch { return "off"; } }
function click(accent, inSec) {
  if (!actx) return;
  try {
    const t = actx.currentTime + Math.max(0, inSec);
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = "triangle";
    o.frequency.value = accent ? 1500 : 1000;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(accent ? 0.22 : 0.12, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g);
    g.connect(actx.destination);
    o.start(t);
    o.stop(t + 0.07);
  } catch { /* audio is a nice-to-have */ }
}

// ---------- timing rules ----------
function msPerChar(wpmTempo) { return 12000 / wpmTempo; }
// Windows scale with the typing rate: Perfect is about half a character
// either side of the due time, Good about one character.
function windows(mpc) {
  const perfect = Math.max(130, 0.5 * mpc);
  const good = Math.max(260, 1.1 * mpc);
  return { perfect, good, late: Math.max(600, 2 * good) };
}
function judge(off, mpc) {
  const w = windows(mpc);
  const a = Math.abs(off);
  if (a <= w.perfect) return "perfect";
  if (a <= w.good) return "good";
  if (off < 0) return "early";
  if (off <= w.late) return "late";
  return "miss";
}
const LABEL = { perfect: "Perfect", good: "Good", early: "Early", late: "Late", miss: "Miss" };

// ---------- setup ----------
function showSetup() {
  phase = "setup";
  round = null;
  const n = passage.text.split(" ").length;
  const mpc = msPerChar(tempo);
  render(main,
    h("div", { class: "panel stack" },
      h("div", {}, h("span", { class: "pill" }, "rhythm"), " ", h("b", {}, "Type at one steady rate.")),
      h("ul", { class: "ss-rules" },
        h("li", {}, "Each word gets time for its letters plus its space. Long words get more time."),
        h("li", {}, "Words slide toward the line. Press the space after a word as its right edge crosses the line."),
        h("li", {}, "Early is as bad as late. Bursting ahead does not count."),
        h("li", {}, "Wait for the count-in. Keys do nothing until it ends."),
        h("li", {}, "Typos block you until you fix them. Backspace is off."),
      ),
      h("div", { class: "ss-tempo" },
        h("button", { class: "ss-step", "aria-label": "slower", onclick: () => setTempo(tempo - TEMPO_STEP) }, "-"),
        h("div", { class: "center" },
          h("div", { class: "big" }, String(tempo)),
          h("div", { class: "muted" }, "wpm tempo"),
          h("div", { class: "muted ss-small" }, `${n} words. ${fmt(1000 / mpc, 1)} characters per second. A five-letter word and its space get ${fmt((6 * mpc) / 1000, 2)}s.`),
        ),
        h("button", { class: "ss-step", "aria-label": "faster", onclick: () => setTempo(tempo + TEMPO_STEP) }, "+"),
      ),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: startRound }, "Start"),
        h("span", { class: "muted" }, "Set the tempo with ", h("kbd", {}, "←"), " ", h("kbd", {}, "→"), ". Press ", h("kbd", {}, "Enter"), " to start. Sound on helps."),
      ),
      h("div", { class: "hint" }, "Pick a pace you could hold all day, not your best sprint."),
    ),
  );
}

function setTempo(v) {
  tempo = Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, v));
  if (phase === "setup") showSetup();
}

// ---------- play ----------
const ui = {};

function typingIndex() {
  const pos = round.session.pos;
  if (round.session.done) return round.words.length;
  return round.words.findIndex((w) => pos <= w.end);
}

function startRound() {
  audioInit();
  const session = new TypingSession(passage.text, { allowBackspace: false, blockOnError: true });
  const words = session.words();
  const mpc = msPerChar(tempo);
  const beat = COUNT_CHARS * mpc; // count-in spacing
  const t0 = now() + 700;
  const start = t0 + COUNT_IN * beat; // typing opens here; word 0's slot starts
  // Word i's slot is (length + 1) chars long. Its space is due at the end.
  const slotStart = [], due = [];
  let at = start;
  for (const w of words) { slotStart.push(at); at += (w.word.length + 1) * mpc; due.push(at); }
  // Click and pulse times: the count-in, "go", then each word's due time.
  const countBeats = Array.from({ length: COUNT_IN + 1 }, (_, k) => t0 + k * beat);
  round = {
    session, words, mpc, t0, start,
    slotStart, due,
    beats: [...countBeats, ...due],
    countBeats,
    judged: words.map(() => null),
    offsets: words.map(() => null),
    doneAt: words.map(() => null),
    counts: { perfect: 0, good: 0, early: 0, late: 0, miss: 0 },
    combo: 0, maxCombo: 0, mistakes: 0,
    nextJudge: 0,
    nextClick: 0,
    lastBeat: -1,
    countingIn: true,
    stop: null,
    summary: null,
  };
  phase = "play";

  ui.lane = h("div", { class: "ss-lane" });
  ui.hit = h("div", { class: "ss-hit" });
  ui.pop = h("div", { class: "ss-pop" });
  ui.good = h("div", { class: "ss-win good" });
  ui.perfect = h("div", { class: "ss-win perfect" });
  ui.lane.append(ui.good, ui.perfect);
  ui.ticks = [];
  ui.notes = [];
  round.countBeats.forEach((_, k) => {
    const label = k < COUNT_IN ? String(COUNT_IN - k) : "go";
    const t = h("div", { class: "ss-tick count" }, h("span", {}, label));
    ui.ticks.push(t);
    ui.lane.appendChild(t);
  });
  words.forEach((w, i) => {
    const n = h("div", { class: "ss-note " + (i % 2 ? "low" : "high") }, h("span", {}, w.word));
    ui.notes.push(n);
    ui.lane.appendChild(n);
  });
  ui.lane.append(ui.hit, ui.pop);
  ui.combo = h("div", { class: "v" }, "0");
  ui.progress = h("div", { class: "v" }, `0/${words.length}`);
  ui.counts = h("div", { class: "ss-counts" });
  ui.text = h("div", { class: "ss-text" });
  ui.status = h("div", { class: "muted ss-status" }, "Count-in. Start typing on go.");

  render(main,
    h("div", { class: "panel stack ss-play" },
      h("div", { class: "row ss-hud" },
        h("div", { class: "stat" }, ui.combo, h("div", { class: "l" }, "combo")),
        h("div", { class: "stat" }, ui.progress, h("div", { class: "l" }, "words")),
        h("div", { class: "stat" }, h("div", { class: "v" }, String(tempo)), h("div", { class: "l" }, "wpm tempo")),
        ui.counts,
      ),
      ui.lane,
      ui.status,
      ui.text,
    ),
  );
  round.view = new TextView(ui.text, passage.text);
  round.view.paint(session);
  paintCounts();
  round.stop = loop(frame);
}

function paintCounts() {
  render(ui.counts, Object.keys(LABEL).map((k) =>
    h("span", { class: `ss-count j-${k}` }, `${LABEL[k]} `, h("b", {}, String(round.counts[k])))));
}

// The lane maps time to x at a fixed number of pixels per character, so
// each word's bar is as wide as its slot and the text fits inside it.
function laneGeom() {
  const w = ui.lane.clientWidth || 600;
  const pxPerChar = Math.max(10, Math.min(16, w / 40));
  return { w, hitX: Math.max(56, w * 0.2), pxPerMs: pxPerChar / round.mpc };
}

function frame() {
  if (phase !== "play") return;
  const t = now();
  const r = round;
  const { w, hitX, pxPerMs } = laneGeom();
  const xAt = (time) => hitX + (time - t) * pxPerMs;
  ui.hit.style.left = `${hitX}px`;
  ui.pop.style.left = `${hitX}px`;
  const win = windows(r.mpc);
  for (const [el, ms] of [[ui.perfect, win.perfect], [ui.good, win.good]]) {
    const half = Math.max(3, ms * pxPerMs);
    el.style.left = `${(hitX - half).toFixed(1)}px`;
    el.style.width = `${(2 * half).toFixed(1)}px`;
  }

  // Schedule clicks a little ahead so they land on time.
  while (r.nextClick < r.beats.length && r.beats[r.nextClick] - t < 120) {
    const k = r.nextClick++;
    const accent = k === 0 || k === COUNT_IN || (k > COUNT_IN && (k - COUNT_IN) % 4 === 0);
    click(accent, (r.beats[k] - t) / 1000);
  }
  while (r.lastBeat + 1 < r.beats.length && r.beats[r.lastBeat + 1] <= t) {
    r.lastBeat++;
    ui.hit.classList.remove("pulse");
    void ui.hit.offsetWidth;
    ui.hit.classList.add("pulse");
  }
  if (r.countingIn && t >= r.start) { r.countingIn = false; ui.status.textContent = "Go. Hit each space as its word reaches the line."; }

  r.countBeats.forEach((bt, k) => {
    const x = xAt(bt);
    const el = ui.ticks[k];
    const vis = x > -40 && x < w + 40;
    el.style.visibility = vis ? "visible" : "hidden";
    if (vis) el.style.transform = `translateX(${x.toFixed(1)}px)`;
  });
  const typing = typingIndex();
  r.words.forEach((wd, i) => {
    const x0 = xAt(r.slotStart[i]), x1 = xAt(r.due[i]);
    const el = ui.notes[i];
    const vis = x1 > -20 && x0 < w + 20;
    el.style.visibility = vis ? "visible" : "hidden";
    if (vis) {
      el.style.transform = `translateX(${x0.toFixed(1)}px)`;
      el.style.width = `${Math.max(4, x1 - x0 - 2).toFixed(1)}px`;
    }
    el.classList.toggle("typing", i === typing);
  });

  // Words whose due time passed long ago without being finished are misses.
  while (r.nextJudge < r.words.length) {
    const i = r.nextJudge;
    if (r.judged[i]) { r.nextJudge++; continue; }
    if (t > r.due[i] + win.late) { setJudgement(i, "miss"); r.nextJudge++; continue; }
    break;
  }
  // End once every word is judged. If the last word was missed, that already
  // waited out its full Late window. If it was typed, end shortly after.
  const last = r.words.length - 1;
  const endAt = r.doneAt[last] != null ? r.doneAt[last] + 500 : r.due[last] + win.late;
  if (r.nextJudge >= r.words.length && t > endAt) finish();
}

function setJudgement(i, j) {
  const r = round;
  r.judged[i] = j;
  r.counts[j]++;
  if (j === "perfect" || j === "good") { r.combo++; r.maxCombo = Math.max(r.maxCombo, r.combo); }
  else r.combo = 0;
  ui.notes[i].classList.add(`j-${j}`);
  ui.combo.textContent = String(r.combo);
  ui.progress.textContent = `${r.judged.filter(Boolean).length}/${r.words.length}`;
  ui.pop.className = `ss-pop j-${j}`;
  ui.pop.textContent = LABEL[j];
  void ui.pop.offsetWidth;
  ui.pop.classList.add("show");
  paintCounts();
}

function onType(key) {
  const r = round;
  if (now() < r.start) return; // count-in: keys do nothing yet
  const before = typingIndex();
  const res = r.session.input(key);
  const t = now();
  if (res.kind === "blocked") {
    r.mistakes++;
    ui.text.classList.remove("ss-shake");
    void ui.text.offsetWidth;
    ui.text.classList.add("ss-shake");
    return;
  }
  if (res.kind !== "ok") return;
  r.view.paint(r.session);
  const w = r.words[before];
  if (w && (res.index === w.end || (before === r.words.length - 1 && r.session.done))) {
    r.doneAt[before] = t;
    r.offsets[before] = t - r.due[before];
    if (!r.judged[before]) setJudgement(before, judge(r.offsets[before], r.mpc));
  }
}

function finish() {
  phase = "results";
  round.stop?.();
  round.summary = summarize();
  showResults();
}

function summarize() {
  const r = round;
  const offs = r.offsets.filter((o) => o != null);
  const enough = offs.length >= MIN_FINISHED;
  const mean = enough ? offs.reduce((a, b) => a + b, 0) / offs.length : null;
  const sd = enough ? Math.sqrt(offs.reduce((a, o) => a + (o - mean) ** 2, 0) / (offs.length - 1)) : null;
  const n = r.words.length;
  const onBeat = (r.counts.perfect + r.counts.good) / n;
  // Pace between finished words (in wpm) shows sprints and stalls directly.
  const paces = [];
  for (let i = 1; i < n; i++) {
    if (r.doneAt[i] != null && r.doneAt[i - 1] != null) {
      const ms = r.doneAt[i] - r.doneAt[i - 1];
      if (ms > 0) paces.push(((r.words[i].word.length + 1) / 5) / (ms / 60000));
    }
  }
  return {
    mean, sd, onBeat, n, enough,
    finished: offs.length,
    slowest: paces.length ? Math.min(...paces) : null,
    fastest: paces.length ? Math.max(...paces) : null,
  };
}

// ---------- results ----------
function timingChart() {
  const r = round;
  const W = Math.max(300, r.words.length * 18), H = 180, mid = H / 2;
  const win = windows(r.mpc);
  const lim = win.late; // offsets beyond this are clipped to the edge
  const y = (off) => mid - (Math.max(-lim, Math.min(lim, off)) / lim) * (mid - 6); // late is up
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "ss-chart-svg");
  const rect = (x, yy, w, hh, cls) => {
    const e = document.createElementNS(NS, "rect");
    e.setAttribute("x", x); e.setAttribute("y", yy); e.setAttribute("width", w); e.setAttribute("height", Math.max(0, hh));
    e.setAttribute("class", cls);
    return e;
  };
  svg.appendChild(rect(0, y(win.good), W, y(-win.good) - y(win.good), "ss-band-good"));
  svg.appendChild(rect(0, y(win.perfect), W, y(-win.perfect) - y(win.perfect), "ss-band-perfect"));
  const colW = W / r.words.length;
  r.words.forEach((w, i) => {
    const j = r.judged[i] || "miss";
    const off = r.offsets[i];
    const x = i * colW + colW * 0.2;
    let bar;
    if (off == null) bar = rect(x, 4, colW * 0.6, H - 8, "ss-bar j-miss ss-missbar");
    else {
      const y0 = Math.min(mid, y(off)), y1 = Math.max(mid, y(off));
      bar = rect(x, y0, colW * 0.6, Math.max(2, y1 - y0), `ss-bar j-${j}`);
    }
    const title = document.createElementNS(NS, "title");
    title.textContent = `${w.word}: ${off == null ? "never finished" : `${off > 0 ? "+" : ""}${fmt(off)} ms`} (${LABEL[j]})`;
    bar.appendChild(title);
    svg.appendChild(bar);
  });
  const line = document.createElementNS(NS, "line");
  line.setAttribute("x1", 0); line.setAttribute("x2", W); line.setAttribute("y1", mid); line.setAttribute("y2", mid);
  line.setAttribute("class", "ss-mid");
  line.setAttribute("vector-effect", "non-scaling-stroke");
  svg.appendChild(line);
  return h("div", { class: "ss-chart" },
    h("div", { class: "ss-chart-labels" }, h("span", {}, "late"), h("span", {}, "on beat"), h("span", {}, "early")),
    h("div", { class: "ss-chart-plot" }, svg),
  );
}

function countsBar(counts) {
  const keys = Object.keys(LABEL);
  return h("div", { class: "ss-split" },
    h("div", { class: "ss-split-bar" },
      keys.map((k) => counts[k] ? h("div", { class: `j-${k}`, style: { flexGrow: String(counts[k]) }, title: `${LABEL[k]}: ${counts[k]}` }) : null)),
    h("div", { class: "ss-counts" },
      keys.map((k) => h("span", { class: `ss-count j-${k}` }, `${LABEL[k]} `, h("b", {}, String(counts[k]))))),
  );
}

function showResults() {
  const r = round;
  const s = r.summary;
  const dir = !s.enough ? null
    : Math.abs(s.mean) < 40 ? "You were centered on the beat."
    : s.mean < 0 ? `You rushed. On average you finished ${fmt(-s.mean)} ms before the beat.`
    : `You dragged. On average you finished ${fmt(s.mean)} ms after the beat.`;
  let next = tempo;
  let advice;
  if (s.enough && s.onBeat >= 0.8 && s.sd < windows(r.mpc).good) { next = Math.min(TEMPO_MAX, tempo + TEMPO_STEP); advice = `Solid. Try ${next} wpm next.`; }
  else if (s.onBeat < 0.4) { next = Math.max(TEMPO_MIN, tempo - TEMPO_STEP); advice = `Too fast to hold. Try ${next} wpm next. A pace you can keep beats one you can hit once.`; }
  else advice = "Stay at this tempo until the spread shrinks.";
  const spread = s.enough && s.fastest != null
    ? `Between words your pace swung from ${fmt(s.slowest)} to ${fmt(s.fastest)} wpm. The tempo asked for ${tempo} wpm every time.`
    : "";
  const signed = (v) => `${v > 0 ? "+" : ""}${fmt(v)} ms`;

  render(main,
    h("div", { class: "panel stack ss-results" },
      h("div", { class: "center" },
        h("div", { class: "big" }, pct(s.onBeat)),
        h("div", { class: "muted" }, `of words on the beat at ${tempo} wpm`),
      ),
      statsRow([
        ["spread (sd)", s.enough ? `±${fmt(s.sd)} ms` : "-"],
        ["avg offset", s.enough ? signed(s.mean) : "-"],
        ["max combo", r.maxCombo],
        ["typos", r.mistakes],
      ]),
      countsBar(r.counts),
      h("div", { class: "ss-finding" },
        s.enough
          ? h("p", {}, `Your spread was ±${fmt(s.sd)} ms. That is your consistency score. Lower is better. `, dir)
          : h("p", {}, `You finished ${s.finished} of ${s.n} words. That is not enough data for a timing score.`),
        spread ? h("p", {}, spread) : null,
        h("p", {}, advice),
      ),
      h("h3", {}, "Timing per word"),
      timingChart(),
      h("div", { class: "muted ss-caption" }, "One bar per word. Up is late, down is early. Shaded bands are the Good and Perfect windows. Hover a bar for the word."),
      lessonCard(passage),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: () => playAgain(next) }, "Play again"),
        h("span", { class: "muted" }, h("kbd", {}, "Enter"), ` next passage at ${next} wpm`),
      ),
    ),
  );
}

function playAgain(next) {
  tempo = next;
  passage = nextPassage();
  showSetup();
}

// ---------- keys ----------
// Arrow keys are not passed through listenKeys, so tempo has its own listener.
window.addEventListener("keydown", (e) => {
  if (phase !== "setup") return;
  if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); audioInit(); setTempo(tempo - TEMPO_STEP); }
  else if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); audioInit(); setTempo(tempo + TEMPO_STEP); }
});

listenKeys((key) => {
  if (phase === "setup") { if (key === "Enter") startRound(); return; }
  if (phase === "play") { if (key.length === 1) onType(key); return; }
  if (phase === "results" && key === "Enter") {
    const btn = main.querySelector(".ss-results button.primary");
    btn?.click();
  }
});

showSetup();
