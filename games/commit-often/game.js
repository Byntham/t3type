// Small Commits: no backspace. A typo fails the build and resets you to your
// last commit. Enter commits, but every commit waits for CI. Find the commit
// size that wastes the least time.
import { TextView, listenKeys, now } from "../../shared/engine.js";
import { pickPassage, getSeed } from "../../shared/content.js";
import { mountShell, h, render, lessonCard, statsRow, fmt, exposeState } from "../../shared/ui.js";

const SLUG = "commit-often";
const CI_MS = 500;
const REVERT_MS = 450;
const PICK = { minLen: 90, maxLen: 210 };

const main = mountShell({ title: "Small Commits", tagline: "Commit early. Revert cheaply." });

let passage = pickPassage(PICK);
let seed = getSeed();
let phase = "type"; // type | ci | revert | done
let text, pos, committed, commits, entries, reverts, lost, startedAt, endedAt, typedKeys, timer;
let view, ui;

exposeState(SLUG, () => ({
  phase, passageId: passage.id, text, pos, committed,
  commits: commits.length, reverts, lost,
  elapsedMs: Math.round(elapsed()), done: phase === "done",
}));

function elapsed() {
  if (startedAt == null) return 0;
  return (endedAt ?? now()) - startedAt;
}

// Short fake git hash, stable for a given chunk and position.
function fakeHash(s, salt) {
  let x = 0x811c9dc5 ^ seed ^ (salt * 2654435761);
  for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619);
  return ((x >>> 0).toString(16) + "0000000").slice(0, 7);
}

function atBoundary() {
  return pos === text.length || text[pos] === " " || text[pos - 1] === " ";
}

// ---------- play ----------
function start() {
  text = passage.text;
  pos = 0; committed = 0; commits = []; entries = []; reverts = 0; lost = 0;
  startedAt = null; endedAt = null; typedKeys = 0;
  phase = "type";

  const box = h("div", { class: "cm-text" });
  ui = {
    box,
    status: h("div", { class: "cm-status" }),
    clock: h("span", { class: "cm-clock" }, "0.0s"),
    counts: h("span", { class: "muted cm-counts" }),
    log: h("ol", { class: "cm-log" }),
  };
  render(main,
    h("div", { class: "cm-grid" },
      h("div", { class: "panel stack cm-main" },
        h("div", { class: "cm-rules muted" },
          "Type the passage. There is no backspace. A typo fails the build and resets you to your last commit. ",
          "Press ", h("kbd", {}, "Enter"), " at a word boundary to commit. Each commit waits ", `${CI_MS / 1000}s`, " for CI.",
        ),
        h("div", { class: "cm-bar" }, ui.status, h("span", { class: "cm-spacer" }), ui.clock),
        box,
        ui.counts,
      ),
      h("aside", { class: "panel cm-side" },
        h("div", { class: "cm-side-head" }, h("b", {}, "git log"), h("span", { class: "muted" }, "newest first")),
        ui.log,
      ),
    ),
  );
  view = new TextView(box, text);
  setStatus("idle", "Start typing.");
  paint();
  renderLog();
  clearInterval(timer);
  timer = setInterval(() => { if (phase !== "done") ui.clock.textContent = `${fmt(elapsed() / 1000, 1)}s`; }, 100);
}

function setStatus(kind, msg) {
  ui.status.className = `cm-status cm-${kind}`;
  render(ui.status,
    kind === "ci" ? h("span", { class: "cm-spin", "aria-hidden": "true" }) : null,
    h("span", {}, msg),
  );
}

function paint() {
  const marks = new Set(commits.map((c) => c.end - 1));
  view.spans.forEach((s, i) => {
    s.classList.toggle("ok", i < committed);
    s.classList.toggle("cm-staged", i >= committed && i < pos);
    s.classList.toggle("cur", i === pos && phase !== "done");
    s.classList.toggle("cm-mark", marks.has(i));
  });
  ui.counts.textContent = `${plural(commits.length, "commit")} . ${plural(reverts, "revert")} . ${pos - committed} chars uncommitted`;
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function renderLog() {
  const items = [...entries].reverse().map((e) =>
    e.kind === "commit"
      ? h("li", { class: "cm-entry" }, h("span", { class: "cm-hash" }, e.hash), h("span", { class: "cm-msg" }, `"${e.text}"`))
      : h("li", { class: "cm-entry cm-revert" }, h("span", { class: "cm-hash" }, "revert"), h("span", { class: "cm-msg" }, `build failed. lost ${e.lost} chars`)),
  );
  items[0]?.classList.add("cm-new");
  if (!items.length) items.push(h("li", { class: "muted cm-empty" }, "No commits yet."));
  render(ui.log, items);
}

function onChar(key) {
  if (startedAt == null) startedAt = now();
  typedKeys++;
  if (pos >= text.length) { setStatus("idle", "Done typing. Press Enter to ship it."); return; }
  if (key === text[pos]) {
    pos++;
    setStatus("idle", pos === text.length ? "Done typing. Press Enter to ship it." : "Editing.");
    paint();
    return;
  }
  failBuild(key);
}

function failBuild(key) {
  phase = "revert";
  const loss = pos - committed;
  reverts++;
  lost += loss;
  entries.push({ kind: "revert", lost: loss, at: pos });
  renderLog();
  paint();
  for (let i = committed; i < pos; i++) view.spans[i].classList.add("cm-lost");
  view.spans[pos]?.classList.add("cm-bad");
  ui.box.classList.remove("cm-shake");
  void ui.box.offsetWidth;
  ui.box.classList.add("cm-shake");
  const want = text[pos] === " " ? "space" : `"${text[pos]}"`;
  setStatus("fail", `Build failed. Typed "${key === " " ? "space" : key}", expected ${want}. Lost ${loss} chars.`);
  setTimeout(() => {
    view.spans.forEach((s) => s.classList.remove("cm-lost", "cm-bad"));
    pos = committed;
    phase = "type";
    paint();
  }, REVERT_MS);
}

function commit() {
  if (pos === committed) { setStatus("warn", "Nothing to commit."); return; }
  if (!atBoundary()) { setStatus("warn", "Commit at a word boundary."); return; }
  if (startedAt == null) startedAt = now();
  const chunk = text.slice(committed, pos);
  commits.push({ start: committed, end: pos });
  entries.push({ kind: "commit", hash: fakeHash(chunk, committed), text: chunk.trim() });
  committed = pos;
  phase = "ci";
  setStatus("ci", "CI running...");
  renderLog();
  paint();
  setTimeout(() => {
    if (committed === text.length) { endedAt = now(); finish(); return; }
    phase = "type";
    setStatus("ok", "CI passed.");
  }, CI_MS);
}

// ---------- end ----------
function finish() {
  phase = "done";
  clearInterval(timer);
  const total = endedAt - startedAt;
  const avg = commits.length ? text.length / commits.length : 0;
  const ciMs = commits.length * CI_MS;
  const typedChars = text.length + lost; // every char you had to type, including retyped work
  const msPerChar = Math.max(1, total - ciMs - reverts * REVERT_MS) / Math.max(1, typedChars);
  const lostMs = lost * msPerChar + reverts * REVERT_MS;

  let advice;
  if (lostMs > ciMs * 1.5) advice = "Commit smaller. Lost work cost you more than CI did.";
  else if (ciMs > lostMs * 1.5 && commits.length > 3) advice = "You could commit less often. CI waits cost you more than reverts did.";
  else advice = "Good balance. CI time and lost work were close.";
  if (reverts === 0 && commits.length <= 2) advice = "No reverts with huge commits. Clean typing, or luck. One late typo would have cost you the whole chunk.";

  render(main,
    h("div", { class: "panel stack" },
      h("div", { class: "center" },
        h("div", { class: "big" }, `${fmt(total / 1000, 1)}s`),
        h("div", { class: "muted" }, "time to ship the passage"),
      ),
      statsRow([
        ["commits", commits.length],
        ["avg commit", `${fmt(avg)} ch`],
        ["reverts", reverts],
        ["chars lost", lost],
        ["CI wait", `${fmt(ciMs / 1000, 1)}s`],
        ["lost work", `${fmt(lostMs / 1000, 1)}s`],
      ]),
      history(),
      h("p", { class: "cm-verdict" },
        `Your average commit was ${fmt(avg)} chars. You lost ${lost} chars to reverts. `,
        h("b", {}, advice),
      ),
      lessonCard(passage),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: start }, "Play again"),
        h("button", { onclick: nextPassage }, "New passage"),
        h("span", { class: "muted" }, h("kbd", {}, "Enter"), " play again . ", h("kbd", {}, "Esc"), " new passage"),
      ),
    ),
  );
}

// One block per commit, sized by chars. Red ticks mark where builds failed.
function history() {
  const L = text.length;
  return h("div", { class: "cm-history" },
    h("div", { class: "cm-hist-label muted" }, "Your history. Each block is one commit. Red ticks are failed builds."),
    h("div", { class: "cm-hist-track" },
      h("div", { class: "cm-hist-bar" },
        commits.map((c, i) => h("div", {
          class: "cm-hist-seg",
          style: { flexGrow: String(c.end - c.start) },
          title: `commit ${i + 1}: ${c.end - c.start} chars\n"${text.slice(c.start, c.end).trim()}"`,
        }, h("span", {}, String(c.end - c.start)))),
      ),
      entries.filter((e) => e.kind === "revert").map((e) => h("div", {
        class: "cm-hist-fail",
        style: { left: `${(e.at / L) * 100}%` },
        title: `build failed at char ${e.at}, lost ${e.lost}`,
      })),
    ),
  );
}

function nextPassage() {
  const prev = passage.id;
  do passage = pickPassage(PICK, Math.random);
  while (passage.id === prev);
  start();
}

listenKeys((key) => {
  if (phase === "done") {
    if (key === "Enter") start();
    else if (key === "Escape") nextPassage();
    return;
  }
  if (phase === "ci") { setStatus("ci", "CI running. Input blocked."); return; }
  if (phase === "revert") return;
  if (key === "Backspace" || key === "WordBackspace") { setStatus("warn", "No backspace here. Commit often instead."); return; }
  if (key === "Enter") { commit(); return; }
  if (key.length === 1) onChar(key);
});

start();
