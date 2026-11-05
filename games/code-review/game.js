// Code Review: a diff proposes two lines. One is real advice, one is the
// anti-pattern. You approve a line by typing it. The mechanic teaches you to
// tell good engineering advice from bad while your hands are busy.
import { listenKeys, wpm as calcWpm, now } from "../../shared/engine.js";
import { PASSAGES, rng, getSeed, shuffle } from "../../shared/content.js";
import { mountShell, h, render, lessonCard, statsRow, fmt, pct, exposeState } from "../../shared/ui.js";

const main = mountShell({ title: "Code Review", tagline: "Approve the right diff." });

const ROUNDS = 6;
const rand = rng(getSeed());

let phase = "review"; // review | result | final
let rounds = []; // {passage, lines: [{text, good}], approved, correct, wpm, acc, points}
let ri = 0;
let r = null; // typing state for the current round
let els = {};

exposeState("code-review", () => ({
  phase, round: ri + 1, rounds: rounds.length,
  passageId: rounds[ri]?.passage.id,
  lines: rounds[ri]?.lines.map((l) => ({ text: l.text, good: l.good })),
  typed: r?.typed, candidates: r?.cands,
  score: rounds.reduce((a, x) => a + (x.points || 0), 0),
  history: rounds.filter((x) => x.approved != null).map((x) => ({ id: x.passage.id, correct: x.correct, points: x.points })),
}));

function pickRounds() {
  // The good line is the one-sentence lesson, not the full quote: quotes run
  // about 2.3x longer than their anti-patterns, so length gave the answer
  // away. Prefer pairs within 1.5x of each other. The full quote shows after.
  const pool = PASSAGES.filter((p) => p.antiPattern && p.lesson);
  const ratio = (p) => p.lesson.length / p.antiPattern.length;
  const close = (p) => ratio(p) <= 1.5 && ratio(p) >= 1 / 1.5;
  const order = [...shuffle(pool.filter(close), rand), ...shuffle(pool.filter((p) => !close(p)), rand)];
  return shuffle(order.slice(0, ROUNDS), rand).map((passage) => ({
    passage,
    lines: shuffle([{ text: passage.lesson, good: true }, { text: passage.antiPattern, good: false }], rand),
    approved: null,
  }));
}

function startGame() {
  rounds = pickRounds();
  ri = 0;
  if (!rounds.length) {
    render(main, h("div", { class: "panel" }, "No passages have an anti-pattern yet."));
    return;
  }
  startRound();
}

// ---------- review ----------
function startRound() {
  phase = "review";
  r = { typed: "", cands: [0, 1], errFlag: false, keystrokes: 0, mistakes: 0, startedAt: null, endedAt: null };
  els.diff = h("div", { class: "cr-diff" });
  els.foot = h("div", { class: "hint" });
  els.result = h("div", { class: "stack" });
  const file = `${(rounds[ri].passage.topic || "advice").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
  render(main,
    h("div", { class: "panel stack" },
      h("div", { class: "cr-head" },
        h("span", { class: "pill" }, `review ${ri + 1} of ${rounds.length}`),
        h("span", { class: "cr-score" }, `score ${rounds.reduce((a, x) => a + (x.points || 0), 0)}`),
      ),
      h("div", {}, h("b", {}, "Two changes to the team handbook. "), h("span", { class: "muted" }, "Approve the good one by typing it.")),
      h("div", { class: "cr-file" },
        h("div", { class: "cr-file-head" }, h("span", {}, `docs/handbook/${file}`), h("span", { class: "muted" }, "@@ -12,0 +12,2 @@")),
        els.diff,
      ),
      els.foot,
      els.result,
    ),
  );
  paint();
}

function paint() {
  const round = rounds[ri];
  const done = round.approved != null;
  render(els.diff, round.lines.map((line, i) => {
    const isCand = r.cands.includes(i);
    const chosen = done && round.approved === i;
    const cls = ["cr-line"];
    if (!done && !isCand) cls.push("out");
    if (!done && isCand && r.typed.length && r.cands.length === 1) cls.push("picked");
    if (done) cls.push(line.good ? "good" : "bad", chosen ? "chosen" : "other");
    const n = done || isCand ? r.typed.length : 0;
    const text = line.text;
    return h("div", { class: cls.join(" ") },
      h("span", { class: "cr-ln" }, String(12 + i)),
      h("span", { class: "cr-mark" }, done ? (line.good ? "+" : "-") : "~"),
      h("span", { class: "cr-code" },
        done
          ? text
          : [
            n ? h("span", { class: "cr-typed" }, text.slice(0, n)) : null,
            isCand ? h("span", { class: "cr-cur" + (r.errFlag ? " err" : "") }, text[n] === " " ? " " : text[n]) : text[n],
            text.slice(n + 1),
          ],
      ),
    );
  }));
  if (!done) {
    render(els.foot, r.typed.length === 0
      ? h("span", {}, "Start typing either line. The first letters pick which one you are approving. A wrong key is rejected, so just type the right one. ", h("kbd", {}, "Backspace"), " backs out of a line.")
      : r.cands.length > 1
        ? h("span", {}, "Both lines still match. Keep going.")
        : h("span", {}, "Approving this line. A wrong key is rejected, so type the right one. ", h("kbd", {}, "Backspace"), " backs out."));
  }
}

function onReviewKey(key) {
  const round = rounds[ri];
  if (key === "Backspace" || key === "WordBackspace") {
    if (r.errFlag) { r.errFlag = false; paint(); return; }
    if (!r.typed) return;
    let cut = r.typed.length - 1;
    if (key === "WordBackspace") { while (cut > 0 && r.typed[cut - 1] !== " ") cut--; }
    r.typed = r.typed.slice(0, cut);
    r.cands = round.lines.map((_, i) => i).filter((i) => round.lines[i].text.startsWith(r.typed));
    paint();
    return;
  }
  if (key.length !== 1) return;
  if (r.startedAt == null) r.startedAt = now();
  r.keystrokes++;
  const n = r.typed.length;
  const next = r.cands.filter((i) => round.lines[i].text[n] === key);
  if (!next.length) {
    // Wrong key: the cursor does not move. Backspace clears the miss.
    r.mistakes++;
    r.errFlag = true;
    paint();
    return;
  }
  r.errFlag = false;
  r.typed += key;
  r.cands = next;
  const full = next.find((i) => round.lines[i].text.length === r.typed.length);
  if (full != null) return approve(full);
  paint();
}

function approve(i) {
  const round = rounds[ri];
  r.endedAt = now();
  round.approved = i;
  round.correct = round.lines[i].good;
  round.acc = r.keystrokes ? (r.keystrokes - r.mistakes) / r.keystrokes : 1;
  round.wpm = calcWpm(r.typed.length, r.endedAt - r.startedAt);
  round.points = round.correct ? Math.round((50 + Math.min(50, round.wpm)) * round.acc) : 0;
  phase = "result";
  paint();
  const last = ri === rounds.length - 1;
  render(els.foot);
  render(els.result,
    round.correct
      ? h("div", { class: "cr-verdict good" }, h("b", {}, "LGTM, merged. "), `+${round.points} points.`)
      : h("div", { class: "cr-verdict bad" }, h("b", {}, "You approved a bad change. "), "That line is the anti-pattern. Here is the real advice."),
    statsRow([["wpm", fmt(round.wpm)], ["accuracy", pct(round.acc)], ["points", `+${round.points}`]]),
    lessonCard(round.passage),
    h("div", { class: "row" },
      h("button", { class: "primary", onclick: next }, last ? "See results" : "Next review"),
      h("span", { class: "muted" }, "or press ", h("kbd", {}, "Enter")),
    ),
  );
}

function next() {
  if (ri < rounds.length - 1) { ri++; startRound(); } else showFinal();
}

// ---------- final ----------
function showFinal() {
  phase = "final";
  const right = rounds.filter((x) => x.correct).length;
  const wrong = rounds.filter((x) => !x.correct);
  const meanWpm = rounds.reduce((a, x) => a + x.wpm, 0) / rounds.length;
  const meanAcc = rounds.reduce((a, x) => a + x.acc, 0) / rounds.length;
  const score = rounds.reduce((a, x) => a + x.points, 0);
  render(main,
    h("div", { class: "panel stack" },
      h("div", { class: "center" },
        h("div", { class: "big" }, `${right}/${rounds.length}`),
        h("div", { class: "muted" }, "good changes approved"),
      ),
      statsRow([
        ["review accuracy", pct(right / rounds.length)],
        ["wpm", fmt(meanWpm)],
        ["typing accuracy", pct(meanAcc)],
        ["score", score],
      ]),
      wrong.length
        ? [
          h("p", { class: "cr-line-note" }, `You merged ${wrong.length} bad ${wrong.length === 1 ? "change" : "changes"}. Here is what the real advice says.`),
          wrong.map((x) => h("div", { class: "stack" },
            h("div", { class: "cr-bad-quote" }, h("span", { class: "cr-mark" }, "-"), " ", x.passage.antiPattern),
            lessonCard(x.passage),
          )),
        ]
        : h("p", { class: "cr-line-note" }, "No bad merges. Your handbook is in good shape."),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: startGame }, "Review another PR"),
        h("span", { class: "muted" }, "or press ", h("kbd", {}, "Enter")),
      ),
    ),
  );
}

listenKeys((key) => {
  if (phase === "review") { if (key !== "Enter" && key !== "Tab" && key !== "Escape") onReviewKey(key); return; }
  if (phase === "result" && key === "Enter") return next();
  if (phase === "final" && key === "Enter") return startGame();
});

startGame();
