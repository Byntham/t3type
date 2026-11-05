// git blame: type a passage with the author hidden, and guess who wrote it.
// An early guess is worth more. The mechanic teaches who holds which ideas,
// so you know whose work to read next.
import { TypingSession, TextView, listenKeys } from "../../shared/engine.js";
import { PASSAGES, rng, getSeed, shuffle } from "../../shared/content.js";
import { mountShell, h, render, lessonCard, statsRow, fmt, pct, exposeState } from "../../shared/ui.js";

const main = mountShell({ title: "git blame", tagline: "Who wrote this?" });

const ROUNDS = 5;
const BASE = 20;
const EARLY = 100;
const ACC_BONUS = 30;
const ACC_BAR = 0.95;
const LOOKAHEAD = 3; // words visible past the current one

const rand = rng(getSeed());
const keyOf = (p) => (p.name || p.handle || "").toLowerCase();
const nameOf = (p) => p.name || p.handle;

// One representative passage per author, used for the choice labels.
const AUTHORS = new Map();
for (const p of PASSAGES) if (!AUTHORS.has(keyOf(p))) AUTHORS.set(keyOf(p), p);

let phase = "type"; // type | blame | reveal | final
// guess is 1..4 for a choice, 0 for "don't know", null before guessing.
let rounds = []; // {passage, choices, guess, guessAt, correct, passed, guessPts, accPts, wpm, acc}
let ri = 0;
let session = null;
let view = null;
let els = {};

exposeState("git-blame", () => {
  const r = rounds[ri];
  return {
    phase, round: ri + 1, rounds: rounds.length,
    passageId: r?.passage.id,
    text: r?.passage.text,
    pos: session?.pos, done: session?.done, full: session?.full,
    visibleEnd: session ? visibleEnd() : null,
    choices: r?.choices.map(nameOf),
    answer: r ? r.choices.findIndex((c) => keyOf(c) === keyOf(r.passage)) + 1 : null,
    guess: r?.guess ?? null,
    forced: !!r?.forced,
    passed: !!r?.passed,
    score: total(),
    history: rounds.slice(0, phase === "final" ? rounds.length : ri).map((x) => ({ id: x.passage.id, correct: x.correct, passed: !!x.passed, points: x.guessPts + x.accPts })),
  };
});

function total() { return rounds.reduce((a, r) => a + (r.guessPts || 0) + (r.accPts || 0), 0); }

function pickRounds() {
  // Distinct authors per game, and prefer passages long enough to guess early.
  const order = [...shuffle(PASSAGES.filter((p) => p.text.length >= 50), rand), ...shuffle(PASSAGES.filter((p) => p.text.length < 50), rand)];
  const seen = new Set();
  const out = [];
  for (const p of order) {
    if (seen.has(keyOf(p))) continue;
    seen.add(keyOf(p));
    out.push(p);
    if (out.length === ROUNDS) break;
  }
  return out.map((passage) => {
    const others = shuffle([...AUTHORS.values()].filter((a) => keyOf(a) !== keyOf(passage)), rand).slice(0, 3);
    return { passage, choices: shuffle([passage, ...others], rand), guess: null, guessPts: 0, accPts: 0 };
  });
}

function remaining() { return 1 - session.pos / session.text.length; }
function guessValue() { return Math.round(BASE + EARLY * remaining()); }
const blamedName = (r) => (r.passed ? "don't know" : nameOf(r.choices[r.guess - 1]));

// The quote is hidden past the current word plus LOOKAHEAD more words, so an
// early guess really is a guess on less text. Returns the first hidden index.
function visibleEnd() {
  const words = session.words();
  const k = words.findIndex((w) => w.end > session.pos);
  if (k < 0) return session.text.length;
  const last = words[Math.min(k + LOOKAHEAD, words.length - 1)];
  return last.end;
}

// ---------- round ----------
function startGame() {
  rounds = pickRounds();
  ri = 0;
  startRound();
}

function startRound() {
  phase = "type";
  const r = rounds[ri];
  session = new TypingSession(r.passage.text);
  els.box = h("div", {});
  els.meter = h("div", { class: "gb-meter" });
  els.prompt = h("div", { class: "gb-prompt hidden" });
  els.foot = h("div", { class: "hint" });
  render(main,
    h("div", { class: "panel stack" },
      h("div", { class: "gb-head" },
        h("span", { class: "pill" }, `round ${ri + 1} of ${rounds.length}`),
        h("span", { class: "gb-score" }, `score ${total()}`),
      ),
      h("div", { class: "gb-blame" },
        h("span", { class: "gb-sha" }, sha(r.passage)),
        " (", els.who = h("span", { class: "gb-who" }, "?".repeat(12)), ") ",
        h("span", { class: "muted" }, "quote.txt"),
      ),
      els.box,
      els.meter,
      els.prompt,
      els.foot,
    ),
  );
  view = new TextView(els.box, r.passage.text);
  paint();
}

function sha(p) {
  let x = 0;
  for (const c of p.id) x = (Math.imul(x, 31) + c.charCodeAt(0)) >>> 0;
  return x.toString(16).padStart(8, "0").slice(0, 7);
}

function paint() {
  const r = rounds[ri];
  view.paint(session);
  const end = visibleEnd();
  view.spans.forEach((s, i) => s.classList.toggle("gb-hid", i >= end));
  if (r.guess == null) {
    const v = guessValue();
    render(els.meter,
      h("div", { class: "gb-bar" }, h("div", { style: { width: `${remaining() * 100}%` } })),
      h("span", {}, "Guess now for ", h("b", {}, `+${v}`), " if right."),
    );
  } else if (r.passed) {
    render(els.meter, h("span", {}, "It is ", h("b", {}, nameOf(r.passage)), ". Finish typing for the lesson."));
  } else {
    render(els.meter, h("span", {}, "You blamed ", h("b", {}, nameOf(r.choices[r.guess - 1])), `. Finish typing to find out.`));
  }
  els.prompt.classList.toggle("hidden", phase !== "blame");
  if (phase === "blame") {
    render(els.prompt,
      h("div", { class: "gb-prompt-title" }, r.forced ? "Passage done. Who wrote it?" : "Who wrote this?"),
      r.choices.map((c, i) => h("button", { class: "gb-choice", onclick: () => lockGuess(i + 1) },
        h("kbd", {}, String(i + 1)), " ", nameOf(c),
        c.name && c.handle ? h("span", { class: "muted" }, ` ${c.handle}`) : null,
      )),
      h("button", { class: "gb-choice gb-pass", onclick: () => lockGuess(0) },
        h("kbd", {}, "0"), " Don't know", h("span", { class: "muted" }, " shows the author, 0 points"),
      ),
    );
  }
  render(els.foot,
    session.full
      ? h("span", { class: "gb-bad" }, "Fix the red characters to finish.")
      : phase === "blame"
      ? h("span", {}, "Press ", h("kbd", {}, "1"), " to ", h("kbd", {}, "4"), " to blame, or ", h("kbd", {}, "0"), " if you don't know.", r.forced ? "" : [" ", h("kbd", {}, "Tab"), " or ", h("kbd", {}, "Esc"), " to keep typing."])
      : r.guess == null
        ? h("span", {}, "Press ", h("kbd", {}, "Tab"), " to run git blame. You can guess any time. Earlier is worth more.")
        : r.passed
          ? h("span", {}, "No guess points this round.")
          : h("span", {}, `Guess locked. If you are right, ${pct(ACC_BAR)} accuracy or better adds +${ACC_BONUS}.`),
  );
}

function lockGuess(n) {
  const r = rounds[ri];
  if (phase !== "blame" || n < 0 || n > r.choices.length) return;
  r.guess = n;
  r.guessAt = 1 - remaining();
  r.passed = n === 0;
  r.correct = !r.passed && keyOf(r.choices[n - 1]) === keyOf(r.passage);
  r.guessPts = r.correct ? guessValue() : 0;
  if (r.passed) { els.who.textContent = nameOf(r.passage); els.who.classList.add("gb-shown"); }
  if (session.done) return reveal();
  phase = "type";
  paint();
}

function onTypeKey(key) {
  const r = rounds[ri];
  if (phase === "blame") {
    if (/^[0-9]$/.test(key)) lockGuess(Number(key));
    else if ((key === "Tab" || key === "Escape") && !r.forced) { phase = "type"; paint(); }
    return;
  }
  if (key === "Tab") { if (r.guess == null) { phase = "blame"; paint(); } return; }
  if (key === "Enter" || key === "Escape") return;
  session.input(key);
  if (session.done) {
    if (r.guess == null) { r.forced = true; phase = "blame"; }
    else return reveal();
  }
  paint();
}

// ---------- reveal ----------
function reveal() {
  phase = "reveal";
  const r = rounds[ri];
  r.acc = session.accuracy();
  r.wpm = session.wpm();
  r.accPts = r.correct && r.acc >= ACC_BAR ? ACC_BONUS : 0;
  const last = ri === rounds.length - 1;
  render(main,
    h("div", { class: "panel stack" },
      h("div", { class: "gb-head" },
        h("span", { class: "pill" }, `round ${ri + 1} of ${rounds.length}`),
        h("span", { class: "gb-score" }, `score ${total()}`),
      ),
      h("div", { class: "gb-blame" },
        h("span", { class: "gb-sha" }, sha(r.passage)),
        " (", h("span", { class: r.correct ? "gb-good" : r.passed ? "" : "gb-bad" }, nameOf(r.passage)), ") ",
        h("span", { class: "muted" }, "quote.txt"),
      ),
      h("div", { class: "gb-verdict" },
        r.correct
          ? [h("b", { class: "gb-good" }, "Right. "), r.forced
            ? "You got it at the end. Guess while you type for more points."
            : `You knew it with ${pct(1 - r.guessAt)} of the passage left.`]
          : r.passed
            ? [h("b", {}, "Passed. "), `It was ${nameOf(r.passage)}.`]
            : [h("b", { class: "gb-bad" }, "Wrong. "), `You blamed ${blamedName(r)}. It was ${nameOf(r.passage)}.`],
      ),
      statsRow([
        ["guess", `+${r.guessPts}`],
        ["accuracy", `${pct(r.acc)}${r.accPts ? ` +${r.accPts}` : ""}`],
        ["wpm", fmt(r.wpm)],
        ["round", `+${r.guessPts + r.accPts}`],
      ]),
      lessonCard(r.passage),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: next }, last ? "See results" : "Next round"),
        h("span", { class: "muted" }, "or press ", h("kbd", {}, "Enter")),
      ),
    ),
  );
}

function next() {
  if (ri < rounds.length - 1) { ri++; startRound(); } else showFinal();
}

// ---------- final ----------
function list(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function showFinal() {
  phase = "final";
  const max = rounds.length * (BASE + EARLY + ACC_BONUS);
  const known = rounds.filter((r) => r.correct).map((r) => nameOf(r.passage));
  const missed = rounds.filter((r) => !r.correct);
  let line;
  if (!known.length) line = "You did not recognize anyone this time. Everyone starts there.";
  else if (!missed.length) line = `You recognized all ${known.length}: ${list(known)}.`;
  else line = `You recognized ${list(known)}.`;

  render(main,
    h("div", { class: "panel stack" },
      h("div", { class: "center" },
        h("div", { class: "big" }, String(total())),
        h("div", { class: "muted" }, `points out of ${max}`),
      ),
      h("div", { class: "gb-table-wrap" },
        h("table", { class: "gb-table" },
          h("tr", {}, h("th", {}, "#"), h("th", {}, "author"), h("th", {}, "you blamed"), h("th", {}, "guessed at"), h("th", {}, "wpm"), h("th", {}, "points")),
          rounds.map((r, i) => h("tr", {},
            h("td", {}, String(i + 1)),
            h("td", {}, nameOf(r.passage)),
            h("td", { class: r.correct ? "gb-good" : r.passed ? "muted" : "gb-bad" }, blamedName(r)),
            h("td", {}, r.forced ? "end" : `${pct(r.guessAt)} typed`),
            h("td", {}, fmt(r.wpm)),
            h("td", {}, String(r.guessPts + r.accPts)),
          )),
        ),
      ),
      h("p", { class: "gb-line" }, line),
      missed.length
        ? h("div", { class: "stack" },
          h("div", { class: "muted" }, "Worth reading next:"),
          missed.map((r) => h("div", { class: "gb-read" },
            h("b", {}, nameOf(r.passage)), r.passage.handle && r.passage.name ? h("span", { class: "muted" }, ` ${r.passage.handle}`) : null,
            h("span", { class: "muted" }, ` on ${r.passage.topic || "engineering"}. `),
            r.passage.lesson || "",
            r.passage.sourceUrl ? [" ", h("a", { href: r.passage.sourceUrl, target: "_blank", rel: "noopener" }, "source")] : null,
          )),
        )
        : null,
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: startGame }, "Play again"),
        h("span", { class: "muted" }, "or press ", h("kbd", {}, "Enter")),
      ),
    ),
  );
}

listenKeys((key) => {
  if (phase === "type" || phase === "blame") return onTypeKey(key);
  if (phase === "reveal" && key === "Enter") return next();
  if (phase === "final" && key === "Enter") return startGame();
});

startGame();
