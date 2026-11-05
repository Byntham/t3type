// Tech Debt: no backspace. Each typo goes on a ledger and accrues interest.
// Outstanding debt makes the text ahead harder to read. Press Enter to open
// the ledger and pay debts oldest first by retyping each word, once per copy
// owed. Opening the ledger costs a fixed context switch, so batching can pay.
import { TypingSession, TextView, listenKeys, now, wpm } from "../../shared/engine.js";
import { pickPassage, rng, getSeed } from "../../shared/content.js";
import { mountShell, h, render, lessonCard, statsRow, fmt, pct, exposeState } from "../../shared/ui.js";

const SLUG = "tech-debt";
const RATE = 0.2; // interest per period
const PERIOD = 20; // chars typed per period
const BLUR_AT = 48; // chars owed at which the text is at max blur
const SWITCH_MS = 1000; // context switch each time you open the ledger
const PICK = { minLen: 100, maxLen: 260 };

const main = mountShell({ title: "Tech Debt", tagline: "Debt compounds. Pay it early." });

let passage = pickPassage(PICK);
let jitterRand = rng(getSeed() ^ 0x5eed);
let phase = "type"; // type | pay | settle | done
let session, view, words, debts, history, startedAt, endedAt, payMs, payStart, pay, ui, interestTicks, payBands;
let switchEnd = 0, switchTimer = 0, visits = 0;

exposeState(SLUG, () => ({
  phase, passageId: passage.id, text: passage.text,
  pos: session?.pos, owed: owed(), level: +level().toFixed(2),
  unpaid: debts.filter((d) => !d.paid).length, paid: debts.filter((d) => d.paid).length,
  principalPaid: sum(debts, (d) => d.principalPaid), interestPaid: sum(debts, (d) => d.interestPaid),
  payTarget: pay?.target ?? null, payPos: pay?.session.pos ?? null,
  switching: !!pay && switching(), visits, mults: debts.filter((d) => !d.paid).map((d) => +d.mult.toFixed(3)),
  done: phase === "done",
}));

const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
const copies = (d) => Math.max(1, Math.round(d.mult));
const owedBy = (d) => (d.paid ? 0 : copies(d) * d.word.length);
function owed() { return debts ? sum(debts, owedBy) : 0; }
// 0 = clean, 1 = worst. Uses the smooth balance so it creeps up between ticks.
function level() { return debts ? Math.min(1, sum(debts.filter((d) => !d.paid), (d) => d.mult * d.word.length) / BLUR_AT) : 0; }
const elapsed = () => (startedAt == null ? 0 : (endedAt ?? now()) - startedAt);
const switching = () => now() < switchEnd;
const multLabel = (d) => `x${d.mult.toFixed(1)}`;
const copiesLabel = (n) => `${n} ${n === 1 ? "copy" : "copies"}`;

// ---------- play ----------
function start() {
  session = new TypingSession(passage.text, { allowBackspace: false });
  words = session.words();
  debts = [];
  history = [];
  interestTicks = [];
  payBands = [];
  startedAt = endedAt = payStart = null;
  payMs = 0;
  pay = null;
  visits = 0;
  switchEnd = 0;
  clearInterval(switchTimer);
  phase = "type";

  ui = {
    box: h("div", { class: "td-text" }),
    status: h("div", { class: "td-status muted" }),
    prompt: h("div", { class: "td-prompt hidden" }),
    total: h("div", { class: "td-total" }),
    meter: h("div", { class: "td-meter-fill" }),
    meterLabel: h("span", {}),
    list: h("ol", { class: "td-list" }),
  };
  render(main,
    h("div", { class: "td-grid" },
      h("div", { class: "panel stack td-main" },
        h("div", { class: "muted td-rules" },
          "No backspace. Each typo is debt. It grows ", `${RATE * 100}%`, " every ", PERIOD, " chars, and debt blurs the text ahead. ",
          "Press ", h("kbd", {}, "Enter"), " to open the ledger and pay debts oldest first by retyping each word. ",
          "Opening the ledger costs a ", `${SWITCH_MS / 1000}s`, " context switch, so paying a few at once can be worth it.",
        ),
        ui.prompt,
        ui.box,
        ui.status,
      ),
      h("aside", { class: "panel td-side" },
        h("div", { class: "td-side-head" }, h("b", {}, "Debt ledger"), h("span", { class: "muted" }, `${RATE * 100}% per ${PERIOD} chars`)),
        ui.total,
        h("div", { class: "td-meter", title: "Chars until the next interest charge" }, ui.meter),
        h("div", { class: "td-meter-label muted" }, ui.meterLabel),
        ui.list,
      ),
    ),
  );
  view = new TextView(ui.box, passage.text);
  paint();
}

function record() {
  history.push({ t: elapsed(), owed: owed() });
}

function wordAt(i) {
  if (passage.text[i] === " ") i--;
  return words.findIndex((w) => i >= w.start && i < w.end);
}

function onChar(key) {
  if (startedAt == null) { startedAt = now(); record(); }
  const r = session.input(key);
  if (r.kind === "err") {
    const wi = wordAt(r.index);
    const w = words[wi];
    debts.push({ id: debts.length + 1, index: r.index, wi, word: w.word, mult: 1, paid: false, principalPaid: 0, interestPaid: 0 });
    flash("td-hit");
    rejitter();
  }
  if (session.pos % PERIOD === 0 && session.pos < passage.text.length) {
    let charged = false;
    for (const d of debts) if (!d.paid) { d.mult *= 1 + RATE; charged = true; }
    if (charged) { interestTicks.push(elapsed()); flash("td-interest"); rejitter(); }
  }
  record();
  if (session.done) {
    if (debts.some((d) => !d.paid)) { phase = "settle"; openPay(); }
    else finish();
    return;
  }
  paint();
}

function flash(cls) {
  ui.total.classList.remove("td-hit", "td-interest");
  void ui.total.offsetWidth;
  ui.total.classList.add(cls);
}

// Random offsets for letters ahead of the cursor, scaled by debt at paint time.
let jitter = [];
function rejitter() {
  jitter = [...passage.text].map(() => [jitterRand() * 2 - 1, jitterRand() * 2 - 1]);
}

function paint() {
  view.paint(session);
  // Any unpaid debt starts at a visible floor, so the first typo is felt.
  // The cap keeps the worst case readable, just clearly harder.
  const V = debts.some((d) => !d.paid) ? 0.35 + 0.65 * level() : 0;
  const pos = session.pos;
  ui.box.style.setProperty("--blur", `${(0.5 + 1.7 * V).toFixed(2)}px`);
  ui.box.style.setProperty("--fade", (1 - 0.35 * V).toFixed(2));
  ui.box.classList.toggle("td-blurred", V > 0);
  const amp = V * 2.6;
  view.spans.forEach((s, i) => {
    const ahead = i > pos;
    s.classList.toggle("td-ahead", ahead);
    if (ahead && amp > 0.3) {
      const [dx, dy] = jitter[i] || [0, 0];
      s.style.left = `${(dx * amp * 0.6).toFixed(1)}px`;
      s.style.top = `${(dy * amp).toFixed(1)}px`;
    } else if (s.style.top) { s.style.left = ""; s.style.top = ""; }
  });
  for (const d of debts) view.spans[d.index].classList.toggle("td-paid", d.paid);

  const total = owed();
  render(ui.total,
    h("span", { class: "td-total-v" }, String(total)),
    h("span", { class: "muted" }, " chars owed"),
  );
  const into = session.pos % PERIOD;
  ui.meter.style.width = `${(into / PERIOD) * 100}%`;
  ui.meterLabel.textContent = session.done ? "Passage done. No more interest." : `next interest in ${PERIOD - into} chars`;

  const unpaid = debts.filter((d) => !d.paid);
  const paid = debts.filter((d) => d.paid);
  render(ui.list,
    unpaid.map((d, k) => h("li", { class: "td-item" + (k === 0 ? " td-oldest" : "") },
      h("span", { class: "td-word" }, d.word),
      h("span", { class: "td-mult", title: "Interest multiplier" }, multLabel(d)),
      h("span", { class: "td-copies", title: `${owedBy(d)} chars to retype` }, copiesLabel(copies(d))),
    )),
    paid.length ? h("li", { class: "td-item td-paidrow muted" }, `${paid.length} paid off`) : null,
    debts.length ? null : h("li", { class: "muted td-empty" }, "No debt. Keep it that way."),
  );

  let msg;
  if (phase === "type") {
    msg = unpaid.length
      ? [h("kbd", {}, "Enter"), unpaid.length === 1
        ? ` pay off "${unpaid[0].word}" (${multLabel(unpaid[0])}, ${copiesLabel(copies(unpaid[0]))}).`
        : ` pay off ${unpaid.length} debts, oldest "${unpaid[0].word}" first.`,
        h("span", { class: "muted" }, ` Opening the ledger costs ${SWITCH_MS / 1000}s.`)]
      : "Clean so far.";
  } else msg = "";
  render(ui.status, h("span", {}, msg));
}

// ---------- pay down ----------
function openPay() {
  const d = debts.find((x) => !x.paid);
  if (!d) return;
  if (payStart == null) {
    payStart = now();
    payBands.push([elapsed(), null]);
    visits++;
    switchEnd = now() + SWITCH_MS;
    clearInterval(switchTimer);
    switchTimer = setInterval(paintSwitch, 50);
  }
  const n = copies(d);
  const target = Array(n).fill(d.word).join(" ");
  const box = h("div", { class: "td-pay-text" });
  const sw = h("div", { class: "td-switch" });
  pay = { debt: d, target, session: new TypingSession(target, { blockOnError: true }), box, sw };
  ui.prompt.classList.remove("hidden");
  render(ui.prompt,
    sw,
    h("div", { class: "td-prompt-head" },
      h("b", {}, phase === "settle" ? "Passage done. Pay off the rest to ship. " : "Paying down. "),
      h("span", { class: "muted" }, n > 1
        ? `Retype "${d.word}" ${n} times. 1 for principal, ${n - 1} for interest.`
        : `Retype "${d.word}" once.`),
    ),
    box,
    phase === "pay" ? h("div", { class: "muted td-prompt-foot" }, h("kbd", {}, "Esc"), " back to typing. Coming back costs another switch.") : null,
  );
  pay.view = new TextView(box, target);
  pay.view.paint(pay.session);
  paintSwitch();
  paint();
}

// Countdown while you switch into the ledger. Keys do nothing until it ends.
function paintSwitch() {
  if (!pay) { clearInterval(switchTimer); return; }
  const left = switchEnd - now();
  const on = left > 0;
  pay.box.classList.toggle("td-wait", on);
  pay.sw.classList.toggle("hidden", !on);
  if (!on) { clearInterval(switchTimer); return; }
  render(pay.sw,
    h("span", {}, `Context switch to the ledger. ${fmt(left / 1000, 1)}s`),
    h("span", { class: "td-switch-track" }, h("span", { class: "td-switch-fill", style: { width: `${(1 - left / SWITCH_MS) * 100}%` } })),
  );
}

function payKey(key) {
  if (key === "Escape" && phase === "pay") { closePay(); return; }
  if (key.length !== 1 || switching()) return;
  const r = pay.session.input(key);
  if (r.kind === "blocked") {
    pay.box.classList.remove("td-shake");
    void pay.box.offsetWidth;
    pay.box.classList.add("td-shake");
  }
  pay.view.paint(pay.session);
  if (!pay.session.done) return;
  const d = pay.debt;
  const n = copies(d);
  d.paid = true;
  d.principalPaid = d.word.length;
  d.interestPaid = (n - 1) * d.word.length;
  record();
  if (phase === "settle") {
    if (debts.some((x) => !x.paid)) { openPay(); return; }
    payMs += now() - payStart;
    endedAt = now();
    payBands.at(-1)[1] = elapsed();
    record();
    finish();
    return;
  }
  // Stay in the ledger while there is debt. Esc goes back to typing.
  if (debts.some((x) => !x.paid)) openPay();
  else closePay();
}

function closePay() {
  clearInterval(switchTimer);
  switchEnd = 0;
  payMs += now() - payStart;
  payBands.at(-1)[1] = elapsed();
  payStart = null;
  pay = null;
  phase = "type";
  ui.prompt.classList.add("hidden");
  rejitter();
  paint();
}

// ---------- end ----------
function finish() {
  phase = "done";
  pay = null;
  clearInterval(switchTimer);
  if (endedAt == null) endedAt = now();
  const total = endedAt - startedAt;
  const principal = sum(debts, (d) => d.principalPaid);
  const interest = sum(debts, (d) => d.interestPaid);
  const typing = total - payMs;
  const peak = Math.max(0, ...history.map((p) => p.owed));
  const share = principal + interest ? interest / (principal + interest) : 0;

  let verdict;
  if (!debts.length) verdict = "No typos, no debt. Nothing to pay.";
  else if (share >= 0.5) verdict = "Most of what you paid was interest. Old debt is the expensive kind. Pay sooner.";
  else if (!debts.some((d) => d.mult > 1.0001)) verdict = "You paid every debt before interest hit it. That is the cheap way.";
  else if (interest === 0) verdict = "Interest started on some debts, but you paid before it added an extra copy.";
  else verdict = "You paid some interest. Each debt costs more the longer it sits.";

  render(main,
    h("div", { class: "panel stack" },
      h("div", { class: "center" },
        h("div", { class: "big" }, `${fmt(wpm(passage.text.length, total))} wpm`),
        h("div", { class: "muted" }, "net of debt, with pay-down time included"),
      ),
      statsRow([
        ["typos", debts.length],
        ["principal", `${principal} ch`],
        ["interest", `${interest} ch`],
        ["interest share", pct(share)],
        ["peak debt", `${peak} ch`],
        ["raw wpm", fmt(wpm(passage.text.length, typing))],
        ["paying", `${fmt(payMs / 1000, 1)}s`],
        ["ledger visits", visits],
      ]),
      debtChart(total),
      h("p", { class: "td-verdict" }, h("b", {}, verdict)),
      lessonCard(passage),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: start }, "Play again"),
        h("button", { onclick: nextPassage }, "New passage"),
        h("span", { class: "muted" }, h("kbd", {}, "Enter"), " play again . ", h("kbd", {}, "Esc"), " new passage"),
      ),
    ),
  );
}

// Step-area chart of chars owed over time. Shaded bands are time spent paying.
function debtChart(total) {
  // Size to the panel so labels stay at 11px on phones too.
  const W = Math.round(Math.max(300, Math.min(900, main.clientWidth - 40))), H = 150, P = { l: 34, r: 10, t: 12, b: 22 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const maxY = Math.max(4, ...history.map((p) => p.owed));
  const x = (t) => P.l + (t / Math.max(1, total)) * iw;
  const y = (v) => P.t + ih - (v / maxY) * ih;
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs, ...kids) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    for (const c of kids) n.append(c);
    return n;
  };
  const pts = history.length ? history : [{ t: 0, owed: 0 }];
  let d = `M${x(0)},${y(0)}`;
  let prev = 0;
  for (const p of pts) { d += ` L${x(p.t)},${y(prev)} L${x(p.t)},${y(p.owed)}`; prev = p.owed; }
  d += ` L${x(total)},${y(prev)}`;
  const area = d + ` L${x(total)},${y(0)} Z`;

  const bands = payBands.filter((b) => b[1] != null);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "td-chart", role: "img", "aria-label": `Debt over time. Peak ${maxY} chars owed.` },
    ...bands.map(([a, b]) => el("rect", { x: x(a), y: P.t, width: Math.max(1, x(b) - x(a)), height: ih, class: "td-band" })),
    el("line", { x1: P.l, x2: W - P.r, y1: y(0), y2: y(0), class: "td-axis" }),
    el("line", { x1: P.l, x2: W - P.r, y1: y(maxY), y2: y(maxY), class: "td-grid" }),
    ...interestTicks.map((t) => el("line", { x1: x(t), x2: x(t), y1: y(0), y2: y(0) + 4, class: "td-tick" })),
    el("path", { d: area, class: "td-area" }),
    el("path", { d, class: "td-line" }),
    el("text", { x: P.l - 6, y: y(maxY) + 4, class: "td-lbl", "text-anchor": "end" }, String(maxY)),
    el("text", { x: P.l - 6, y: y(0) + 4, class: "td-lbl", "text-anchor": "end" }, "0"),
    el("text", { x: P.l, y: H - 4, class: "td-lbl" }, "0s"),
    el("text", { x: W - P.r, y: H - 4, class: "td-lbl", "text-anchor": "end" }, `${fmt(total / 1000, 1)}s`),
  );
  const cross = el("line", { y1: P.t, y2: P.t + ih, class: "td-cross", visibility: "hidden" });
  const dot = el("circle", { r: 4, class: "td-dot", visibility: "hidden" });
  svg.append(cross, dot);
  const tip = h("div", { class: "td-tip hidden" });
  const wrap = h("div", { class: "td-chart-wrap" },
    h("div", { class: "td-chart-title" }, h("b", {}, "Chars owed over time"), h("span", { class: "muted" }, "Shaded: paying down. Ticks: interest charged.")),
    h("div", { class: "td-chart-box" }, svg, tip),
  );
  svg.addEventListener("mousemove", (e) => {
    const r = svg.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width * W - P.l) / iw * total;
    if (t < 0 || t > total) return;
    let v = 0;
    for (const p of pts) { if (p.t <= t) v = p.owed; else break; }
    const px = x(t);
    for (const n of [cross, dot]) n.setAttribute("visibility", "visible");
    cross.setAttribute("x1", px); cross.setAttribute("x2", px);
    dot.setAttribute("cx", px); dot.setAttribute("cy", y(v));
    tip.classList.remove("hidden");
    tip.textContent = `${fmt(t / 1000, 1)}s: ${v} chars owed`;
    tip.style.left = `${(px / W) * 100}%`;
  });
  svg.addEventListener("mouseleave", () => {
    for (const n of [cross, dot]) n.setAttribute("visibility", "hidden");
    tip.classList.add("hidden");
  });
  return wrap;
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
  if (phase === "pay" || phase === "settle") { payKey(key); return; }
  if (key === "Enter") {
    if (debts.some((d) => !d.paid)) { phase = "pay"; openPay(); }
    return;
  }
  if (key === "Backspace" || key === "WordBackspace") {
    render(ui.status, h("span", {}, "No backspace. Typos go on the ledger."));
    return;
  }
  if (key.length === 1) onChar(key);
});

rejitter();
start();
