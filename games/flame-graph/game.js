// Flame Graph: guess your bottleneck, type the passage, then read your own
// profile. The slowest words become a drill ("optimize the hot path").
import { TypingSession, TextView, listenKeys } from "../../shared/engine.js";
import { pickPassage, phrases } from "../../shared/content.js";
import { mountShell, h, render, lessonCard, statsRow, fmt, pct, exposeState } from "../../shared/ui.js";

const main = mountShell({
  title: "Flame Graph",
  tagline: "Guess your bottleneck. Then profile it.",
});

let passage = pickPassage({ minLen: 90, maxLen: 260 });
let phase = "predict"; // predict | type | profile | drill | compare
let guess = null; // word index
let session = null;
let view = null;
let profile = null; // per-word timings for the full passage
let drill = null; // {words, session, view, profileBefore}

exposeState("flame-graph", () => ({
  phase, guess, passageId: passage.id,
  pos: session?.pos, done: session?.done,
  hottest: profile?.ranked?.slice(0, 3).map((w) => w.word),
}));

// Assign each keystroke's "self time" to the word it landed in. The trailing
// space belongs to the word before it, like a stack frame's return.
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
  const ranked = [...stats].sort((a, b) => b.msPerChar - a.msPerChar);
  ranked.forEach((w, r) => (w.rank = r + 1));
  const total = stats.reduce((a, w) => a + w.ms, 0) || 1;
  return { stats, ranked, total };
}

function heat(msPerChar, median) {
  // 0 = at or under median (cool), 1 = 3x median or worse (hot)
  const x = Math.max(0, Math.min(1, (msPerChar / median - 1) / 2));
  const hue = 50 - 50 * x; // yellow -> red
  const light = 62 - 12 * x;
  return `hsl(${hue} 95% ${light}%)`;
}

// ---------- predict ----------
function showPredict() {
  phase = "predict";
  guess = null;
  const words = passage.text.split(" ");
  const pick = h("div", { class: "typing fg-pick" },
    words.map((w, i) => [
      h("span", {
        class: "fg-word", "data-i": i,
        onclick: () => { guess = i; startTyping(); },
      }, w),
      " ",
    ]),
  );
  render(main,
    h("div", { class: "panel stack" },
      h("div", {}, h("span", { class: "pill" }, "step 1 of 3"), " ", h("b", {}, "Predict the bottleneck.")),
      h("p", { class: "muted", style: { margin: 0 } }, "Click the word you think will be slowest for you to type. Rob Pike says you will probably be wrong."),
      pick,
      h("div", { class: "hint" }, "Or press ", h("kbd", {}, "Enter"), " to skip and just type."),
    ),
  );
}

// ---------- type ----------
function startTyping() {
  phase = "type";
  session = new TypingSession(passage.text);
  const box = h("div", {});
  const live = h("div", {});
  render(main,
    h("div", { class: "panel stack" },
      h("div", {}, h("span", { class: "pill" }, "step 2 of 3"), " ", h("b", {}, "Type it. "),
        guess != null ? h("span", { class: "muted" }, `Your guess: "${passage.text.split(" ")[guess]}"`) : null),
      box,
      live,
    ),
  );
  view = new TextView(box, passage.text);
  if (guess != null) {
    // underline the guessed word while typing
    const w = session.words()[guess];
    for (let k = w.start; k < w.end; k++) view.spans[k].classList.add("fg-guess");
  }
  view.paint(session);
  const tick = setInterval(() => {
    if (session.startedAt == null) return;
    render(live, statsRow([["wpm", fmt(session.wpm())], ["acc", pct(session.accuracy())]]));
  }, 250);
  session.onDone = () => { clearInterval(tick); profile = profileWords(session); showProfile(); };
}

// ---------- profile ----------
function flameRow(items, total, median, labelFn) {
  return h("div", { class: "fg-row" },
    items.map((it) =>
      h("div", {
        class: "fg-box" + (it.rank && it.rank <= 3 ? " fg-top" : "") + (it.i === guess && it.word ? " fg-guessed" : ""),
        style: { flexGrow: String(Math.max(it.ms, 1)), background: heat(it.msPerChar, median) },
        title: `${it.label ?? it.word}\n${fmt(it.ms)} ms total, ${fmt(it.msPerChar)} ms/char${it.errors ? `, ${it.errors} typo(s)` : ""}`,
      }, h("span", {}, labelFn(it))),
    ),
  );
}

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
  const { stats, ranked, total } = profile;
  const sorted = [...stats].map((w) => w.msPerChar).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  const hottest = ranked[0];
  const guessed = guess != null ? stats[guess] : null;

  let verdict;
  if (!guessed) verdict = h("p", {}, "No guess this time. Next run, try to call it before you measure.");
  else if (guessed.rank === 1) verdict = h("p", {}, h("b", { class: "fg-good" }, "You called it. "), `"${guessed.word}" was your slowest word. Rare. Most people miss.`);
  else verdict = h("p", {},
    h("b", { class: "fg-bad" }, "Missed. "),
    `You guessed "${guessed.word}", which ranked #${guessed.rank} of ${stats.length}. `,
    `The real hot spot was "${hottest.word}" at ${fmt(hottest.msPerChar)} ms/char, ${fmt(hottest.msPerChar / median, 1)}x your median.`,
  );

  render(main,
    h("div", { class: "panel stack" },
      h("div", {}, h("span", { class: "pill" }, "step 3 of 3"), " ", h("b", {}, "Your profile.")),
      statsRow([
        ["wpm", fmt(session.wpm())],
        ["accuracy", pct(session.accuracy())],
        ["total", `${fmt(total / 1000, 1)}s`],
        ["median", `${fmt(median)} ms/ch`],
      ]),
      h("div", { class: "fg-graph" },
        flameRow(stats, total, median, (w) => w.word),
        flameRow(phraseFrames(stats), total, median, (p) => p.label),
        flameRow([{ label: "passage", ms: total, msPerChar: median }], total, median, () => "main()"),
      ),
      h("div", { class: "muted", style: { fontSize: "0.85rem" } }, "Width is time spent. Color is ms per character: yellow is your normal pace, red is slow. Hover a box for numbers."),
      verdict,
      h("div", { class: "fg-hot" },
        h("b", {}, "Hot path: "),
        ranked.slice(0, 5).map((w) => h("span", { class: "pill", style: { borderColor: heat(w.msPerChar, median) } }, `${w.word} ${fmt(w.msPerChar)}ms`)),
      ),
      lessonCard(passage),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: startDrill }, "Optimize the hot path"),
        h("button", { onclick: nextPassage }, "New passage"),
        h("span", { class: "muted" }, h("kbd", {}, "Enter"), " optimize . ", h("kbd", {}, "Esc"), " new passage"),
      ),
    ),
  );
}

// ---------- drill ----------
function startDrill() {
  phase = "drill";
  const hot = profile.ranked.slice(0, 5).map((w) => w.word.replace(/[^\w'-]/g, "") || w.word);
  const reps = 3;
  const seq = [];
  for (let r = 0; r < reps; r++) for (const w of hot) seq.push(w);
  const text = seq.join(" ");
  session = new TypingSession(text);
  drill = { hot, reps, text };
  const box = h("div", {});
  render(main,
    h("div", { class: "panel stack" },
      h("div", {}, h("span", { class: "pill" }, "drill"), " ", h("b", {}, "Optimize the hot path. "),
        h("span", { class: "muted" }, `Your 5 slowest words, ${reps} times each.`)),
      box,
    ),
  );
  view = new TextView(box, text);
  view.paint(session);
  session.onDone = showCompare;
}

function showCompare() {
  phase = "compare";
  const after = profileWords(session).stats;
  const rows = drill.hot.map((word, k) => {
    const before = profile.ranked[k];
    const runs = after.filter((_, i) => i % drill.hot.length === k).map((w) => w.msPerChar);
    const best = Math.min(...runs);
    return { word, before: before.msPerChar, best, speedup: before.msPerChar / best };
  });
  const avg = rows.reduce((a, r) => a + r.speedup, 0) / rows.length;
  render(main,
    h("div", { class: "panel stack" },
      h("div", { class: "center" },
        h("div", { class: "big" }, `${fmt(avg, 1)}x`),
        h("div", { class: "muted" }, "average speedup on your hot path"),
      ),
      h("table", { class: "fg-table" },
        h("tr", {}, h("th", {}, "word"), h("th", {}, "before"), h("th", {}, "best after"), h("th", {}, "speedup")),
        rows.map((r) => h("tr", {},
          h("td", {}, r.word),
          h("td", {}, `${fmt(r.before)} ms/ch`),
          h("td", {}, `${fmt(r.best)} ms/ch`),
          h("td", { class: r.speedup >= 1 ? "fg-good" : "fg-bad" }, `${fmt(r.speedup, 1)}x`),
        )),
      ),
      h("p", { class: "muted" }, "You measured, found the real hot spots, and fixed those instead of the ones you guessed. That is the whole method."),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: () => { showPredict(); } }, "Profile this passage again"),
        h("button", { onclick: nextPassage }, "New passage"),
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

listenKeys((key) => {
  if (phase === "predict") { if (key === "Enter") startTyping(); return; }
  if (phase === "profile") {
    if (key === "Enter") startDrill();
    else if (key === "Escape") nextPassage();
    return;
  }
  if (phase === "compare") { if (key === "Enter") showPredict(); return; }
  if (phase === "type" || phase === "drill") {
    if (key === "Enter" || key === "Escape" || key === "Tab") return;
    session.input(key);
    view.paint(session);
    if (session.done) session.onDone?.();
  }
});

showPredict();
