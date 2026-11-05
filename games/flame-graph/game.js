// Flame Graph: guess your bottleneck, type the passage, then read your own
// profile. The slowest words become a drill, and a re-profile checks whether
// the drill changed anything.
import { TypingSession, TextView, listenKeys } from "../../shared/engine.js";
import { pickPassage, phrases } from "../../shared/content.js";
import { mountShell, h, render, lessonCard, statsRow, fmt, pct, exposeState } from "../../shared/ui.js";

const main = mountShell({
  title: "Flame Graph",
  tagline: "Guess your bottleneck. Then profile it.",
});

const MIN_LETTERS = 3; // shorter words show in the graph but are not ranked
const HOT_N = 5;

let passage = pickPassage({ minLen: 90, maxLen: 260 });
let phase = "predict"; // predict | type | profile | drill | reprofile | compare
let guess = null; // word index
let hl = null; // highlighted word index on the predict screen
let session = null;
let view = null;
let note = null; // hint line under the typing box
let stopTick = () => {};
let profile = null; // per-word timings for the first full pass
let first = null; // {wpm, acc} for the first full pass
let drill = null; // {hot: [word index], text}
let result = null; // compare numbers

exposeState("flame-graph", () => ({
  phase, guess, highlighted: hl, passageId: passage.id,
  pos: session?.pos, len: session?.text.length, done: session?.done, full: session?.full,
  hottest: profile?.ranked?.slice(0, 3).map((w) => w.word),
  result,
}));

const letters = (w) => w.replace(/[^A-Za-z0-9]/g, "").length;
const ranked = (w) => letters(w) >= MIN_LETTERS;

// Assign each keystroke's "self time" to the word it landed in. The trailing
// space belongs to the word before it, like a stack frame's return.
// Words are ranked by excess time: time spent beyond what the median pace
// predicts for a word that long. A pause before a short word then counts as
// one pause, not as a huge per-character cost.
function profileWords(s) {
  const words = s.words();
  const owner = new Array(s.text.length + 1).fill(words.length - 1);
  words.forEach((w, i) => { for (let k = w.start; k <= w.end; k++) owner[k] = i; });
  const stats = words.map((w, i) => ({ ...w, i, ms: 0, errors: 0 }));
  let prev = null;
  for (const e of s.log) {
    const idx = Math.min(e.index, s.text.length - 1);
    const w = stats[owner[idx]];
    if (prev != null) w.ms += e.t - prev;
    if (!e.ok) w.errors++;
    prev = e.t;
  }
  for (const w of stats) w.msPerChar = w.ms / (w.word.length + 1);
  const sorted = stats.map((w) => w.msPerChar).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  for (const w of stats) w.excess = w.ms - median * (w.word.length + 1);
  const order = stats.filter((w) => ranked(w.word)).sort((a, b) => b.excess - a.excess);
  order.forEach((w, r) => (w.rank = r + 1));
  const total = stats.reduce((a, w) => a + w.ms, 0) || 1;
  return { stats, ranked: order, total, median };
}

function heat(msPerChar, median) {
  // 0 = at or under median (cool), 1 = 3x median or worse (hot)
  const x = Math.max(0, Math.min(1, (msPerChar / median - 1) / 2));
  const hue = 50 - 50 * x; // yellow -> red
  const light = 62 - 12 * x;
  return `hsl(${hue} 95% ${light}%)`;
}

// ---------- predict ----------
function eligible() {
  return passage.text.split(" ").map((w, i) => (ranked(w) ? i : -1)).filter((i) => i >= 0);
}

function moveHighlight(d) {
  const el = eligible();
  if (!el.length) return;
  if (hl == null) hl = d > 0 ? el[0] : el[el.length - 1];
  else hl = el[(el.indexOf(hl) + d + el.length) % el.length];
  for (const s of main.querySelectorAll(".fg-word")) s.classList.toggle("fg-hl", Number(s.dataset.i) === hl);
}

function showPredict() {
  phase = "predict";
  guess = null;
  hl = null;
  stopTick();
  const words = passage.text.split(" ");
  const pick = h("div", { class: "typing fg-pick" },
    words.map((w, i) => [
      ranked(w)
        ? h("span", { class: "fg-word", "data-i": i, onclick: () => { guess = i; startTyping(); } }, w)
        : h("span", { class: "fg-short" }, w),
      " ",
    ]),
  );
  render(main,
    h("div", { class: "panel stack" },
      h("div", {}, h("span", { class: "pill" }, "step 1 of 3"), " ", h("b", {}, "Predict the bottleneck.")),
      h("p", { class: "muted", style: { margin: 0 } }, "Pick the word you think will be slowest for you to type. Rob Pike says you will probably be wrong."),
      pick,
      h("div", { class: "hint" },
        "Click a word, or move with ", h("kbd", {}, "←"), " ", h("kbd", {}, "→"), " and press ", h("kbd", {}, "Enter"), " to lock it in. ",
        h("kbd", {}, "Space"), " skips the guess. Words under 3 letters are not ranked."),
    ),
  );
}

// ---------- typing screens ----------
function typeScreen({ pill, title, sub, text, onDone, mark }) {
  stopTick();
  session = new TypingSession(text);
  const box = h("div", {});
  const live = h("div", {});
  note = h("div", { class: "hint fg-note" });
  render(main,
    h("div", { class: "panel stack" },
      h("div", {}, h("span", { class: "pill" }, pill), " ", h("b", {}, title), " ", sub ? h("span", { class: "muted" }, sub) : null),
      box,
      note,
      live,
    ),
  );
  view = new TextView(box, text);
  mark?.(view, session);
  view.paint(session);
  const id = setInterval(() => {
    if (session.startedAt == null) return;
    render(live, statsRow([["wpm", fmt(session.wpm())], ["acc", pct(session.accuracy())]]));
  }, 250);
  stopTick = () => clearInterval(id);
  session.onDone = () => { stopTick(); onDone(); };
}

function startTyping() {
  phase = "type";
  typeScreen({
    pill: "step 2 of 3",
    title: "Type it.",
    sub: guess != null ? `Your guess: "${passage.text.split(" ")[guess]}"` : null,
    text: passage.text,
    mark: (v, s) => {
      if (guess == null) return;
      const w = s.words()[guess];
      for (let k = w.start; k < w.end; k++) v.spans[k].classList.add("fg-guess");
    },
    onDone: () => {
      profile = profileWords(session);
      first = { wpm: session.wpm(), acc: session.accuracy() };
      showProfile();
    },
  });
}

// ---------- profile ----------
function flameRow(items, median, cls = "") {
  return h("div", { class: "fg-row " + cls },
    items.map((it) => {
      const label = it.label ?? it.word;
      return h("div", {
        class: "fg-box" + (it.rank && it.rank <= 3 ? " fg-top" : "") + (it.word && it.i === guess ? " fg-guessed" : ""),
        style: { flexGrow: String(Math.max(it.ms, 1)), background: heat(it.msPerChar, median) },
        "data-label": label,
        title: `${label}\n${fmt(it.ms)} ms total, ${fmt(it.msPerChar)} ms/char`
          + (it.excess != null ? `, ${it.excess >= 0 ? "+" : ""}${fmt(it.excess)} ms vs your pace` : "")
          + (it.errors ? `, ${it.errors} typo(s)` : ""),
      }, h("span", {}, label));
    }),
  );
}

// Show a label only when the box is wide enough for all of it.
function fitLabels(root) {
  for (const box of root.querySelectorAll(".fg-words .fg-box")) {
    const span = box.firstChild;
    span.textContent = box.dataset.label;
    if (span.getBoundingClientRect().width > box.clientWidth) span.textContent = "";
  }
}
addEventListener("resize", () => { const g = main.querySelector(".fg-graph"); if (g) fitLabels(g); });

function phraseFrames(stats) {
  // Group words into phrases for the middle row of the flame graph.
  const out = [];
  let wi = 0;
  for (const p of phrases(passage.text, { maxLen: 60 })) {
    const n = p.split(" ").length;
    const ws = stats.slice(wi, wi + n);
    wi += n;
    const ms = ws.reduce((a, w) => a + w.ms, 0);
    out.push({ label: p, ms, msPerChar: ms / (p.length + 1), word: null });
  }
  return out;
}

function showProfile() {
  phase = "profile";
  const { stats, ranked: order, total, median } = profile;
  const hottest = order[0];
  const guessed = guess != null ? stats[guess] : null;

  let verdict;
  if (!guessed) verdict = h("p", {}, "No guess this time. Next run, try to call it before you measure.");
  else if (guessed.rank === 1) verdict = h("p", {}, h("b", { class: "fg-good" }, "You called it. "), `"${guessed.word}" cost you the most extra time. Rare. Most people miss.`);
  else verdict = h("p", {},
    h("b", { class: "fg-bad" }, "Missed. "),
    `You guessed "${guessed.word}", which ranked #${guessed.rank} of ${order.length}. `,
    hottest ? `The real hot spot was "${hottest.word}". It took ${fmt(hottest.excess)} ms longer than your normal pace for a word that long.` : "",
  );

  const graph = h("div", { class: "fg-graph" },
    flameRow(stats, median, "fg-words"),
    flameRow(phraseFrames(stats), median),
    flameRow([{ label: "main()", ms: total, msPerChar: median }], median),
  );

  render(main,
    h("div", { class: "panel stack" },
      h("div", {}, h("span", { class: "pill" }, "step 3 of 3"), " ", h("b", {}, "Your profile.")),
      statsRow([
        ["wpm", fmt(first.wpm)],
        ["accuracy", pct(first.acc)],
        ["total", `${fmt(total / 1000, 1)}s`],
        ["median", `${fmt(median)} ms/ch`],
      ]),
      graph,
      h("div", { class: "muted", style: { fontSize: "0.85rem" } }, "Width is time spent. Color is ms per character: yellow is your normal pace, red is slow. Hover a box for numbers."),
      verdict,
      h("div", { class: "fg-hot" },
        h("b", {}, "Hot path: "),
        order.slice(0, HOT_N).map((w) => h("span", { class: "pill", style: { borderColor: heat(w.msPerChar, median) } }, `${w.word} ${w.excess >= 0 ? "+" : ""}${fmt(w.excess)}ms`)),
      ),
      h("div", { class: "muted", style: { fontSize: "0.85rem" } }, "Ranked by extra time: how much longer a word took than your median pace predicts for its length."),
      lessonCard(passage),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: startDrill }, "Optimize the hot path"),
        h("button", { onclick: nextPassage }, "New passage"),
        h("span", { class: "muted" }, h("kbd", {}, "Enter"), " optimize . ", h("kbd", {}, "Esc"), " new passage"),
      ),
    ),
  );
  fitLabels(graph);
}

// ---------- drill ----------
function startDrill() {
  phase = "drill";
  const hot = profile.ranked.slice(0, HOT_N).map((w) => w.i);
  if (!hot.length) return startReprofile();
  const clean = (w) => w.replace(/[^\w'-]/g, "") || w;
  const reps = 3;
  const seq = [];
  for (let r = 0; r < reps; r++) for (const i of hot) seq.push(clean(profile.stats[i].word));
  drill = { hot, text: seq.join(" ") };
  typeScreen({
    pill: "drill",
    title: "Optimize the hot path.",
    sub: `Your ${hot.length} slowest words, ${reps} times each.`,
    text: drill.text,
    onDone: startReprofile,
  });
}

function startReprofile() {
  phase = "reprofile";
  typeScreen({
    pill: "re-profile",
    title: "Measure again.",
    sub: "Retype the full passage once. Then compare your hot words before and after.",
    text: passage.text,
    onDone: showCompare,
  });
}

// ---------- compare ----------
function change(before, after) { return before > 0 ? (after - before) / before : 0; }

function changeText(x) {
  if (Math.abs(x) < 0.03) return "about the same";
  return `${pct(Math.abs(x))} ${x < 0 ? "faster" : "slower"}`;
}

function showCompare() {
  phase = "compare";
  const after = profileWords(session);
  const hot = drill?.hot ?? [];
  const rows = hot.map((i) => ({ word: profile.stats[i].word, before: profile.stats[i].ms, after: after.stats[i].ms }));
  const hotBefore = rows.reduce((a, r) => a + r.before, 0);
  const hotAfter = rows.reduce((a, r) => a + r.after, 0);
  const restBefore = profile.total - hotBefore;
  const restAfter = after.total - hotAfter;
  const hotChange = change(hotBefore, hotAfter);
  const restChange = change(restBefore, restAfter);
  result = { hotBefore, hotAfter, restBefore, restAfter, hotChange, restChange };

  let read;
  if (hotChange >= 0.03) read = "Your hot words got slower. One retype is a single sample, so this can be noise. Try another round.";
  else if (hotChange < restChange - 0.05) read = "Your hot words improved more than the rest of the passage. The drill probably helped.";
  else read = "Your hot words improved about as much as everything else. That is the usual second-try speedup, not the drill.";

  const signed = (ms) => `${ms > 0 ? "+" : ""}${fmt(ms)} ms`;
  render(main,
    h("div", { class: "panel stack" },
      h("div", { class: "center" },
        h("div", { class: "big " + (hotChange < -0.03 ? "fg-good" : hotChange > 0.03 ? "fg-bad" : "") }, changeText(hotChange)),
        h("div", { class: "muted" }, "time on your hot words, before vs after the drill"),
      ),
      h("p", { style: { margin: 0 } }, `The rest of the passage: ${changeText(restChange)}. `, read),
      h("table", { class: "fg-table" },
        h("tr", {}, h("th", {}, "word"), h("th", {}, "before"), h("th", {}, "after"), h("th", {}, "change")),
        rows.map((r) => h("tr", {},
          h("td", {}, r.word),
          h("td", {}, `${fmt(r.before)} ms`),
          h("td", {}, `${fmt(r.after)} ms`),
          h("td", { class: r.after < r.before ? "fg-good" : "fg-bad" }, signed(r.after - r.before)),
        )),
        h("tr", { class: "fg-rest" },
          h("td", {}, "rest of passage"),
          h("td", {}, `${fmt(restBefore / 1000, 1)} s`),
          h("td", {}, `${fmt(restAfter / 1000, 1)} s`),
          h("td", {}, changeText(restChange)),
        ),
      ),
      h("p", { class: "muted", style: { margin: 0 } }, "Each time is one in-context sample. Expect a few percent of noise either way."),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: showPredict }, "Profile this passage again"),
        h("button", { onclick: nextPassage }, "New passage"),
        h("span", { class: "muted" }, h("kbd", {}, "Enter"), " again . ", h("kbd", {}, "Esc"), " new passage"),
      ),
    ),
  );
}

function nextPassage() {
  const prev = passage.id;
  do passage = pickPassage({ minLen: 90, maxLen: 260 }, Math.random);
  while (passage.id === prev);
  showPredict();
}

function lockGuess(i) { guess = i; startTyping(); }

listenKeys((key, e) => {
  if (phase === "predict") {
    if (key === "Enter") { if (hl != null) lockGuess(hl); else startTyping(); }
    else if (key === " ") startTyping();
    else if (key === "Tab") moveHighlight(e.shiftKey ? -1 : 1);
    return;
  }
  if (phase === "profile") {
    if (key === "Enter") startDrill();
    else if (key === "Escape") nextPassage();
    return;
  }
  if (phase === "compare") {
    if (key === "Enter") showPredict();
    else if (key === "Escape") nextPassage();
    return;
  }
  if (phase === "type" || phase === "drill" || phase === "reprofile") {
    if (key === "Enter" || key === "Escape" || key === "Tab") return;
    session.input(key);
    view.paint(session);
    note.textContent = session.full ? "Fix the red characters to finish." : "";
    if (session.done) session.onDone?.();
  }
});

// listenKeys drops arrow keys, so the predict screen listens for them here.
addEventListener("keydown", (e) => {
  if (phase !== "predict" || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    moveHighlight(e.key === "ArrowRight" ? 1 : -1);
  }
});

showPredict();
