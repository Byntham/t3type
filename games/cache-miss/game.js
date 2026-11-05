// Cache Miss: read the passage, then type it from memory. Hold Tab to peek
// at the current word, which is a cache miss and costs a fetch delay. A wrong
// key is also a cache miss: input stalls for the same fetch, then the word
// shows. Three rounds, less read time each round.
import { TypingSession, TextView, listenKeys, now } from "../../shared/engine.js";
import { pickPassage, filterPassages } from "../../shared/content.js";
import { mountShell, h, render, lessonCard, statsRow, fmt, pct, exposeState } from "../../shared/ui.js";

const SLUG = "cache-miss";
const ROUNDS = [1, 0.6, 0.3]; // share of full read time per round
const FETCH_MS = 400; // latency before a peeked word appears
// Short passages fit in memory. Widen the range if the library is small.
const PICK = filterPassages({ minLen: 50, maxLen: 160 }).length >= 5 ? { minLen: 50, maxLen: 160 } : { minLen: 50, maxLen: 200 };
const readMsFor = (text) => 4000 + 90 * text.length;

const main = mountShell({ title: "Cache Miss", tagline: "Keep the lesson in memory." });

let passage = pickPassage(PICK);
let phase = "ready"; // ready | read | recall | between | done
let round = 0;
let results = []; // per round {keyMisses, peeks, missed: Set of word indexes, ms, pos}
let wordMiss = []; // per word index, totals across rounds
let session, view, words, ui, readEnd, readTimer, cur, peek;
let fetch = null; // {wi, shown, timer}: the word a wrong key is fetching

exposeState(SLUG, () => ({
  phase, round: round + 1, passageId: passage.id, text: passage.text,
  pos: session?.pos ?? 0,
  keyMisses: cur?.keyMisses ?? 0, peeks: cur?.peeks ?? 0, missedWords: cur?.missed.size ?? 0,
  hitRate: cur ? +hitRate(cur).toFixed(3) : null,
  peeking: !!peek, peekShown: !!peek?.shown,
  fetching: !!fetch && !fetch.shown, revealed: fetch?.shown ? fetch.wi : null,
  readLeftMs: phase === "read" ? Math.max(0, Math.round(readEnd - now())) : 0,
  rounds: results.map((r) => +hitRate(r).toFixed(3)),
}));

// Each word is one cache lookup. It is a hit if you typed it with no wrong
// key and no peek. A word counts once you finish it, or as soon as you miss it.
function lookups(r) {
  let n = 0;
  words.forEach((w, i) => { if (r.pos >= w.end || r.missed.has(i)) n++; });
  return n;
}
function hitRate(r) {
  const n = lookups(r);
  return n ? (n - r.missed.size) / n : 1;
}
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

// ---------- read ----------
function startGame() {
  round = 0;
  results = [];
  words = new TypingSession(passage.text).words();
  wordMiss = words.map(() => 0);
  showReady();
}

// The read timer only starts when you ask for it.
function showReady() {
  phase = "ready";
  clearInterval(readTimer);
  const total = readMsFor(passage.text) * ROUNDS[0];
  render(main,
    h("div", { class: "panel stack" },
      roundHead("Read the passage, then type it from memory."),
      h("p", { class: "cx-p cx-ready" }, `You get ${fmt(total / 1000)}s to read. Each round after that gives you less time.`),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: startRead }, "Start reading"),
        h("span", { class: "muted" }, "or press ", h("kbd", {}, "Space")),
      ),
    ),
  );
}

function startRead() {
  phase = "read";
  const total = readMsFor(passage.text) * ROUNDS[round];
  readEnd = now() + total;
  const fill = h("div", { class: "cx-fill" });
  const secs = h("span", { class: "cx-secs" });
  render(main,
    h("div", { class: "panel stack" },
      roundHead(`Read it. You get ${fmt(total / 1000)}s.`),
      h("div", { class: "cx-timer" }, h("div", { class: "cx-track" }, fill), secs),
      h("div", { class: "typing cx-read" }, passage.text),
      h("div", { class: "hint" }, "Then type it from memory. Press ", h("kbd", {}, "Space"), " to start early."),
    ),
  );
  clearInterval(readTimer);
  const tick = () => {
    const left = readEnd - now();
    if (left <= 0) { startRecall(); return; }
    fill.style.width = `${(left / total) * 100}%`;
    secs.textContent = `${fmt(left / 1000, 1)}s`;
  };
  tick();
  readTimer = setInterval(tick, 50);
}

function roundHead(msg) {
  return h("div", { class: "cx-head" },
    h("span", { class: "pill" }, `round ${round + 1} of ${ROUNDS.length}`),
    h("b", {}, msg),
  );
}

// ---------- recall ----------
function startRecall() {
  clearInterval(readTimer);
  phase = "recall";
  session = new TypingSession(passage.text, { blockOnError: true });
  cur = { keyMisses: 0, peeks: 0, missed: new Set(), ms: 0, start: null, pos: 0 };
  peek = null;
  clearFetch();
  ui = {
    box: h("div", { class: "cx-recall" }),
    rate: h("span", { class: "cx-rate" }),
    counts: h("span", { class: "muted cx-counts" }),
    fetchMsg: h("span", {}),
    progress: h("div", { class: "cx-prog-fill" }),
  };
  ui.fetch = h("span", { class: "cx-fetch hidden" }, h("span", { class: "cx-dot" }), ui.fetchMsg);
  render(main,
    h("div", { class: "panel stack" },
      roundHead("Now type it from memory."),
      h("div", { class: "cx-bar" },
        h("span", { class: "muted" }, "hit rate"), ui.rate, ui.counts,
        h("span", { class: "cx-spacer" }), ui.fetch,
      ),
      h("div", { class: "cx-prog" }, ui.progress),
      ui.box,
      h("div", { class: "hint" }, "A word is a hit if you type it with no wrong key and no peek. Hold ", h("kbd", {}, "Tab"), " to peek at the current word. A peek is a cache miss. So is a wrong key. Both wait for a fetch before the word shows."),
    ),
  );
  view = new TextView(ui.box, passage.text);
  paint();
}

function wordAtPos() {
  let i = session.pos;
  if (passage.text[i] === " ") i++; // at a space, the next word is what you need
  return words.findIndex((w) => i >= w.start && i < w.end);
}

function paint() {
  const pos = session.pos;
  const shown = [peek?.shown ? words[peek.wi] : null, fetch?.shown ? words[fetch.wi] : null].filter(Boolean);
  view.spans.forEach((s, i) => {
    const vis = i >= pos && shown.some((w) => i >= w.start && i < w.end);
    s.classList.toggle("ok", i < pos);
    s.classList.toggle("cur", i === pos && !session.done);
    s.classList.toggle("cx-hide", i >= pos && !vis);
    s.classList.toggle("cx-peek", vis);
  });
  cur.pos = pos;
  const n = lookups(cur);
  ui.rate.textContent = n ? pct(hitRate(cur)) : "-";
  ui.rate.classList.toggle("cx-rate-none", !n);
  ui.counts.textContent = `${n ? `${n - cur.missed.size} of ${n} words from memory` : "No words done yet"} . ${plural(cur.keyMisses, "wrong key")} . ${plural(cur.peeks, "peek")}`;
  ui.progress.style.width = `${(pos / passage.text.length) * 100}%`;
  const missFetch = fetch && !fetch.shown;
  ui.fetch.classList.toggle("hidden", !(missFetch || (peek && !peek.shown)));
  ui.fetchMsg.textContent = missFetch ? "cache miss. fetching..." : "fetching from memory...";
}

function onChar(key) {
  if (fetch && !fetch.shown) return; // stalled on a fetch
  if (cur.start == null) cur.start = now();
  const r = session.input(key);
  if (r.kind === "blocked") {
    cur.keyMisses++;
    const s = view.spans[r.index];
    s.classList.remove("cx-miss");
    void s.offsetWidth;
    s.classList.add("cx-miss");
    const wi = wordAtPos();
    if (wi >= 0) {
      wordMiss[wi]++;
      cur.missed.add(wi);
      // A wrong key is a cache miss: stall for the fetch, then show the word.
      const visible = (fetch?.wi === wi) || (peek?.shown && peek.wi === wi);
      if (!visible) startFetch(wi);
    }
  }
  if (fetch && fetch.shown && wordAtPos() !== fetch.wi) clearFetch();
  if (peek) followPeek();
  paint();
  if (session.done) endRound();
}

function startFetch(wi) {
  clearFetch();
  const f = { wi, shown: false, timer: 0 };
  f.timer = setTimeout(() => { if (fetch === f) { f.shown = true; if (phase === "recall") paint(); } }, FETCH_MS);
  fetch = f;
}

function clearFetch() {
  if (fetch) clearTimeout(fetch.timer);
  fetch = null;
}

// Peeking: one cache miss per word revealed, each with a fetch delay.
// The miss counts when the word actually shows, so a quick tap is free.
function peekDown() {
  if (peek || session.done) return;
  peek = { wi: -1, shown: false, timer: 0 };
  followPeek();
}

function followPeek() {
  const wi = wordAtPos();
  if (wi < 0 || wi === peek.wi) return;
  peek.wi = wi;
  clearTimeout(peek.timer);
  // Already fetched after a wrong key: no second miss.
  if (fetch?.shown && fetch.wi === wi) { peek.shown = true; paint(); return; }
  peek.shown = false;
  const p = peek;
  p.timer = setTimeout(() => {
    if (peek !== p) return;
    p.shown = true;
    cur.peeks++;
    wordMiss[wi]++;
    cur.missed.add(wi);
    paint();
  }, FETCH_MS);
  paint();
}

function peekUp() {
  if (!peek) return;
  clearTimeout(peek.timer);
  peek = null;
  if (phase === "recall") paint();
}

function endRound() {
  peekUp();
  clearFetch();
  cur.ms = now() - (cur.start ?? now());
  cur.pos = passage.text.length;
  results.push(cur);
  if (round + 1 >= ROUNDS.length) { finish(); return; }
  phase = "between";
  const next = ROUNDS[round + 1];
  render(main,
    h("div", { class: "panel stack" },
      roundHead("Round done."),
      statsRow([
        ["hit rate", pct(hitRate(cur))],
        ["missed words", cur.missed.size],
        ["wrong keys", cur.keyMisses],
        ["peeks", cur.peeks],
        ["time", `${fmt(cur.ms / 1000, 1)}s`],
      ]),
      h("p", { class: "cx-p" }, `Next round you get ${pct(next)} of the read time. Same passage.`),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: nextRound }, `Start round ${round + 2}`),
        h("span", { class: "muted" }, h("kbd", {}, "Space"), " or ", h("kbd", {}, "Enter"), " continue"),
      ),
    ),
  );
}

function nextRound() {
  round++;
  startRead();
}

// ---------- end ----------
function finish() {
  phase = "done";
  const rates = results.map(hitRate);
  const ranked = words.map((w, i) => ({ word: w.word, n: wordMiss[i], i }))
    .filter((w) => w.n > 0).sort((a, b) => b.n - a.n || a.i - b.i);
  const maxMiss = Math.max(1, ...ranked.map((w) => w.n));
  const first = rates[0], last = rates.at(-1);
  let verdict;
  if (last >= first && last >= 0.95) verdict = "Less read time, same hit rate. The passage is in memory now.";
  else if (last >= first) verdict = "Your hit rate held up with a third of the read time. Recall is doing the work.";
  else verdict = "Your hit rate dropped as read time shrank. Try it again. Each recall makes the next one cheaper.";

  render(main,
    h("div", { class: "panel stack" },
      h("div", { class: "center" },
        h("div", { class: "big" }, pct(last)),
        h("div", { class: "muted" }, "final round hit rate"),
      ),
      h("div", { class: "cx-rounds" },
        results.map((r, k) => h("div", { class: "cx-round" },
          h("div", { class: "cx-round-l" }, `Round ${k + 1}`, h("span", { class: "muted" }, ` ${pct(ROUNDS[k])} read time`)),
          h("div", { class: "cx-round-track" },
            h("div", { class: "cx-round-fill", style: { width: `${hitRate(r) * 100}%` } }),
          ),
          h("div", { class: "cx-round-v" }, pct(hitRate(r))),
          h("div", { class: "cx-round-s muted" }, `${r.missed.size} of ${words.length} words missed . ${plural(r.keyMisses, "wrong key")} . ${plural(r.peeks, "peek")} . ${fmt(r.ms / 1000, 1)}s`),
        )),
      ),
      h("div", { class: "stack cx-words" },
        h("b", {}, ranked.length ? "Words you missed most" : "No misses. Every word was a hit."),
        ranked.length ? h("div", { class: "typing cx-heat" },
          words.map((w, i) => [
            h("span", {
              class: "cx-hw" + (wordMiss[i] ? " cx-hw-miss" : ""),
              style: wordMiss[i] ? { background: `color-mix(in srgb, var(--bad) ${Math.round(12 + 38 * (wordMiss[i] / maxMiss))}%, transparent)` } : null,
              title: wordMiss[i] ? `${wordMiss[i]} misses and peeks` : null,
            }, w.word),
            " ",
          ]),
        ) : null,
        ranked.length ? h("div", { class: "row cx-top" },
          ranked.slice(0, 5).map((w) => h("span", { class: "pill" }, `${w.word} x${w.n}`)),
        ) : null,
      ),
      h("p", { class: "cx-p" }, h("b", {}, verdict)),
      lessonCard(passage),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: startGame }, "Play again"),
        h("button", { onclick: nextPassage }, "New passage"),
        h("span", { class: "muted" }, h("kbd", {}, "Enter"), " play again . ", h("kbd", {}, "Esc"), " new passage"),
      ),
    ),
  );
}

function nextPassage() {
  const prev = passage.id;
  do passage = pickPassage(PICK, Math.random);
  while (passage.id === prev);
  startGame();
}

listenKeys((key, e) => {
  const go = (key === " " || key === "Enter") && !e.repeat;
  if (phase === "ready") { if (go) startRead(); return; }
  if (phase === "read") { if (go) startRecall(); return; }
  if (phase === "between") { if (go) nextRound(); return; }
  if (phase === "done") {
    if (key === "Enter") startGame();
    else if (key === "Escape") nextPassage();
    return;
  }
  if (phase !== "recall") return;
  if (key === "Tab") { if (!e.repeat) peekDown(); return; }
  if (key.length === 1) onChar(key);
});
window.addEventListener("keyup", (e) => { if (e.key === "Tab") peekUp(); });
window.addEventListener("blur", peekUp);

startGame();
