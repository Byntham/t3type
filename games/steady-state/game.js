// Steady State: a metronome ticks one beat per word. Finish each word
// (its trailing space) on its beat. Early is as wrong as late. The end
// screen shows how even your timing was, because steady throughput is what
// ships, not bursts.
import { TypingSession, TextView, listenKeys, loop, now } from "../../shared/engine.js";
import { rng, getSeed, shuffle, filterPassages } from "../../shared/content.js";
import { mountShell, h, render, lessonCard, statsRow, fmt, pct, exposeState } from "../../shared/ui.js";

const COUNT_IN = 4;
const TEMPO_MIN = 16, TEMPO_MAX = 100, TEMPO_STEP = 4;
const NS = "http://www.w3.org/2000/svg";

const main = mountShell({ title: "Steady State", tagline: "Sustainable pace beats sprints." });

const rand = rng(getSeed());
let queue = [];
function nextPassage() {
  if (!queue.length) queue = shuffle(filterPassages({ minLen: 80, maxLen: 210 }), rand);
  return queue.shift();
}

let phase = "setup"; // setup | play | results
let tempo = 36; // beats (words) per minute
let passage = nextPassage();
let round = null;

exposeState("steady-state", () => {
  const r = round;
  const i = r ? typingIndex() : null;
  return {
    phase, tempo, passageId: passage.id,
    interval: r?.I,
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
function windows(I) {
  return { perfect: Math.max(80, 0.07 * I), good: Math.max(170, 0.16 * I), late: 0.5 * I };
}
function judge(off, I) {
  const w = windows(I);
  const a = Math.abs(off);
  if (a <= w.perfect) return "perfect";
  if (a <= w.good) return "good";
  if (off < 0) return "early";
  if (off <= w.late) return "late";
  return "miss";
}
const LABEL = { perfect: "Perfect", good: "Good", early: "Early", late: "Late", miss: "Miss" };

function avgWordChars(text) {
  const ws = text.split(" ");
  return text.length / ws.length; // includes the space share
}
function tempoWpm(bpm, text) { return (bpm * avgWordChars(text)) / 5; }

// ---------- setup ----------
function showSetup() {
  phase = "setup";
  round = null;
  const n = passage.text.split(" ").length;
  render(main,
    h("div", { class: "panel stack" },
      h("div", {}, h("span", { class: "pill" }, "rhythm"), " ", h("b", {}, "Ship one word on every beat.")),
      h("ul", { class: "ss-rules" },
        h("li", {}, "A metronome ticks. Each beat, one word is due."),
        h("li", {}, "Words slide toward the line. Press the space after a word as it crosses the line."),
        h("li", {}, "Early is as bad as late. Bursting ahead does not count."),
        h("li", {}, "Typos block you until you fix them. Backspace is off."),
      ),
      h("div", { class: "ss-tempo" },
        h("button", { class: "ss-step", "aria-label": "slower", onclick: () => setTempo(tempo - TEMPO_STEP) }, "-"),
        h("div", { class: "center" },
          h("div", { class: "big" }, String(tempo)),
          h("div", { class: "muted" }, "words per minute (beats)"),
          h("div", { class: "muted ss-small" }, `${n} words. About ${fmt(tempoWpm(tempo, passage.text))} wpm for this passage. ${fmt(60 / tempo, 2)}s per word.`),
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
  const I = 60000 / tempo;
  const t0 = now() + 700;
  round = {
    session, words, I, t0,
    due: words.map((_, i) => t0 + (COUNT_IN + i) * I),
    judged: words.map(() => null),
    offsets: words.map(() => null),
    doneAt: words.map(() => null),
    counts: { perfect: 0, good: 0, early: 0, late: 0, miss: 0 },
    combo: 0, maxCombo: 0, mistakes: 0,
    nextJudge: 0,
    nextClick: 0,
    lastBeat: -1,
    stop: null,
    summary: null,
  };
  phase = "play";

  ui.lane = h("div", { class: "ss-lane" });
  ui.hit = h("div", { class: "ss-hit" });
  ui.pop = h("div", { class: "ss-pop" });
  ui.ticks = [];
  ui.notes = [];
  const totalBeats = COUNT_IN + words.length;
  for (let k = 0; k < totalBeats; k++) {
    const label = k < COUNT_IN ? String(COUNT_IN - k) : null;
    const t = h("div", { class: "ss-tick" + (label ? " count" : "") }, label ? h("span", {}, label) : null);
    ui.ticks.push(t);
    ui.lane.appendChild(t);
  }
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

  render(main,
    h("div", { class: "panel stack ss-play" },
      h("div", { class: "row ss-hud" },
        h("div", { class: "stat" }, ui.combo, h("div", { class: "l" }, "combo")),
        h("div", { class: "stat" }, ui.progress, h("div", { class: "l" }, "words")),
        h("div", { class: "stat" }, h("div", { class: "v" }, String(tempo)), h("div", { class: "l" }, "beats/min")),
        ui.counts,
      ),
      ui.lane,
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

function laneGeom() {
  const w = ui.lane.clientWidth || 600;
  return { w, hitX: Math.max(70, w * 0.2), spacing: Math.max(110, Math.min(190, w / 5)) };
}

function frame() {
  if (phase !== "play") return;
  const t = now();
  const r = round;
  const { w, hitX, spacing } = laneGeom();
  const xAt = (time) => hitX + ((time - t) / r.I) * spacing;
  ui.hit.style.left = `${hitX}px`;
  ui.pop.style.left = `${hitX}px`;

  // Schedule clicks a little ahead so they land on time.
  const totalBeats = COUNT_IN + r.words.length;
  while (r.nextClick < totalBeats && r.t0 + r.nextClick * r.I - t < 120) {
    const k = r.nextClick++;
    click(k < COUNT_IN ? k === 0 : (k - COUNT_IN) % 4 === 0, (r.t0 + k * r.I - t) / 1000);
  }
  const beat = Math.floor((t - r.t0) / r.I);
  if (beat > r.lastBeat && beat >= 0) {
    r.lastBeat = beat;
    ui.hit.classList.remove("pulse");
    void ui.hit.offsetWidth;
    ui.hit.classList.add("pulse");
  }

  for (let k = 0; k < totalBeats; k++) {
    const x = xAt(r.t0 + k * r.I);
    const el = ui.ticks[k];
    const vis = x > -40 && x < w + 40;
    el.style.visibility = vis ? "visible" : "hidden";
    if (vis) el.style.transform = `translateX(${x.toFixed(1)}px)`;
  }
  const typing = typingIndex();
  r.words.forEach((wd, i) => {
    const x = xAt(r.due[i]);
    const el = ui.notes[i];
    const vis = x > -160 && x < w + 160;
    el.style.visibility = vis ? "visible" : "hidden";
    if (vis) el.style.transform = `translateX(${x.toFixed(1)}px) translateX(-50%)`;
    el.classList.toggle("typing", i === typing);
  });

  // Words whose beat passed long ago without being finished are misses.
  const lateMs = windows(r.I).late;
  while (r.nextJudge < r.words.length) {
    const i = r.nextJudge;
    if (r.judged[i]) { r.nextJudge++; continue; }
    if (t > r.due[i] + lateMs) { setJudgement(i, "miss"); r.nextJudge++; continue; }
    break;
  }
  if (r.nextJudge >= r.words.length && t > r.due[r.words.length - 1] + 400) finish();
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
    if (!r.judged[before]) setJudgement(before, judge(r.offsets[before], r.I));
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
  const mean = offs.length ? offs.reduce((a, b) => a + b, 0) / offs.length : 0;
  const sd = offs.length > 1 ? Math.sqrt(offs.reduce((a, o) => a + (o - mean) ** 2, 0) / (offs.length - 1)) : 0;
  const n = r.words.length;
  const onBeat = (r.counts.perfect + r.counts.good) / n;
  // Gaps between finished words show sprints and stalls directly.
  const gaps = [];
  for (let i = 1; i < n; i++) if (r.doneAt[i] != null && r.doneAt[i - 1] != null) gaps.push(r.doneAt[i] - r.doneAt[i - 1]);
  return {
    mean, sd, onBeat, n,
    finished: offs.length,
    fastest: gaps.length ? Math.min(...gaps) : null,
    slowest: gaps.length ? Math.max(...gaps) : null,
  };
}

// ---------- results ----------
function timingChart() {
  const r = round;
  const W = Math.max(300, r.words.length * 18), H = 180, mid = H / 2;
  const lim = r.I * 0.6; // offsets beyond this are clipped to the edge
  const y = (off) => mid - (Math.max(-lim, Math.min(lim, off)) / lim) * (mid - 6); // late is up
  const win = windows(r.I);
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
  const dir = Math.abs(s.mean) < 40 ? "You were centered on the beat." : s.mean < 0 ? `You rushed. On average you finished ${fmt(-s.mean)} ms before the beat.` : `You dragged. On average you finished ${fmt(s.mean)} ms after the beat.`;
  let next = tempo;
  let advice;
  if (s.onBeat >= 0.8 && s.sd < windows(r.I).good) { next = Math.min(TEMPO_MAX, tempo + TEMPO_STEP); advice = `Solid. Try ${next} next.`; }
  else if (s.onBeat < 0.4) { next = Math.max(TEMPO_MIN, tempo - TEMPO_STEP); advice = `Too fast to hold. Try ${next} next. A pace you can keep beats one you can hit once.`; }
  else advice = "Stay at this tempo until the spread shrinks.";
  const spread = s.fastest != null
    ? `Between words you swung from ${fmt(s.fastest / 1000, 2)}s to ${fmt(s.slowest / 1000, 2)}s. The beat asked for ${fmt(r.I / 1000, 2)}s every time.`
    : "";

  render(main,
    h("div", { class: "panel stack ss-results" },
      h("div", { class: "center" },
        h("div", { class: "big" }, pct(s.onBeat)),
        h("div", { class: "muted" }, `of words on the beat at ${tempo} beats/min`),
      ),
      statsRow([
        ["spread (sd)", `±${fmt(s.sd)} ms`],
        ["avg offset", `${s.mean > 0 ? "+" : ""}${fmt(s.mean)} ms`],
        ["max combo", r.maxCombo],
        ["typos", r.mistakes],
      ]),
      countsBar(r.counts),
      h("div", { class: "ss-finding" },
        h("p", {}, `Your spread was ±${fmt(s.sd)} ms. That is your consistency score. Lower is better. `, dir),
        spread ? h("p", {}, spread) : null,
        h("p", {}, advice),
      ),
      h("h3", {}, "Timing per word"),
      timingChart(),
      h("div", { class: "muted ss-caption" }, "One bar per word. Up is late, down is early. Shaded bands are the Good and Perfect windows. Hover a bar for the word."),
      lessonCard(passage),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: () => playAgain(next) }, "Play again"),
        h("span", { class: "muted" }, h("kbd", {}, "Enter"), ` next passage at ${next} beats/min`),
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
