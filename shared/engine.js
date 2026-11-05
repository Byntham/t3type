// Shared typing core. Games can use TypingSession + TextView for the usual
// "type this passage" flow, or just listenKeys() and do their own thing.

export const now = () => performance.now();

// Listen for typing keys on the window. Calls handler(key, event) with
// key = a single printable character, "Backspace", "Enter", "Escape" or "Tab".
// Ignores ctrl/meta combos, except ctrl+Backspace / alt+Backspace,
// which arrive as "WordBackspace". Returns a detach function.
export function listenKeys(handler) {
  function onKey(e) {
    if (e.isComposing) return;
    let key = e.key;
    if (key === "Backspace" && (e.ctrlKey || e.altKey)) key = "WordBackspace";
    else if (e.ctrlKey || e.metaKey) return;
    if (key.length !== 1 && !["Backspace", "WordBackspace", "Enter", "Escape", "Tab"].includes(key)) return;
    if (key === " " || key === "Tab" || key === "Backspace" || key === "WordBackspace" || key === "'" || key === "/") e.preventDefault();
    handler(key, e);
  }
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

export function wpm(chars, ms) {
  if (ms <= 0) return 0;
  return chars / 5 / (ms / 60000);
}

// Character-level session for one passage.
// typed[i] is what the player typed at position i. Errors can stay in place
// (like most typing tests) unless opts.blockOnError is set, in which case the
// cursor will not advance past a wrong character.
export class TypingSession {
  constructor(text, { allowBackspace = true, blockOnError = false } = {}) {
    this.text = text;
    this.allowBackspace = allowBackspace;
    this.blockOnError = blockOnError;
    this.typed = [];
    this.log = []; // {t, key, index, ok}
    this.startedAt = null;
    this.endedAt = null;
    this.keystrokes = 0;
    this.mistakes = 0; // wrong keystrokes, even if later fixed
  }

  get pos() { return this.typed.length; }
  get done() { return this.endedAt != null; }
  // True when every character is typed but some are wrong.
  get full() { return !this.done && this.pos >= this.text.length; }

  // Returns {kind: "ok" | "err" | "back" | "blocked" | "full" | "ignored", index}
  input(key) {
    if (this.done) return { kind: "ignored" };
    const t = now();
    if (key === "Backspace" || key === "WordBackspace") {
      if (!this.allowBackspace || this.pos === 0) return { kind: "ignored" };
      let n = 1;
      if (key === "WordBackspace") {
        let i = this.pos - 1;
        while (i > 0 && this.text[i - 1] !== " ") i--;
        n = this.pos - i;
      }
      this.typed.splice(this.pos - n, n);
      this.log.push({ t, key, index: this.pos, ok: true });
      return { kind: "back", index: this.pos };
    }
    if (key.length !== 1) return { kind: "ignored" };
    // Passage is full but has typos: the player must backspace and fix them.
    if (this.pos >= this.text.length) return { kind: "full" };
    if (this.startedAt == null) this.startedAt = t;
    const index = this.pos;
    const ok = this.text[index] === key;
    this.keystrokes++;
    if (!ok) this.mistakes++;
    this.log.push({ t, key, index, ok });
    if (!ok && this.blockOnError) return { kind: "blocked", index };
    this.typed.push(key);
    if (this.pos >= this.text.length && this.errorCount() === 0) this.endedAt = t;
    else if (this.pos >= this.text.length && !this.allowBackspace) this.endedAt = t;
    return { kind: ok ? "ok" : "err", index };
  }

  isCorrect(i) { return this.typed[i] === this.text[i]; }
  errorCount() { let n = 0; for (let i = 0; i < this.typed.length; i++) if (!this.isCorrect(i)) n++; return n; }
  correctChars() { return this.typed.length - this.errorCount(); }
  elapsed() { return this.startedAt == null ? 0 : (this.endedAt ?? now()) - this.startedAt; }
  wpm() { return wpm(this.correctChars(), this.elapsed()); }
  accuracy() { return this.keystrokes ? (this.keystrokes - this.mistakes) / this.keystrokes : 1; }

  // Word spans: [{word, start, end}] where end is exclusive and excludes the space.
  words() {
    const out = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(this.text))) out.push({ word: m[0], start: m.index, end: m.index + m[0].length });
    return out;
  }
}

// Renders a passage as one span per character and repaints from a session.
export class TextView {
  constructor(container, text) {
    this.el = container;
    this.el.classList.add("typing");
    this.el.textContent = "";
    this.spans = [...text].map((c) => {
      const s = document.createElement("span");
      s.className = "ch" + (c === " " ? " space" : "");
      s.textContent = c;
      this.el.appendChild(s);
      return s;
    });
  }
  paint(session) {
    const { typed, text } = session;
    for (let i = 0; i < this.spans.length; i++) {
      const s = this.spans[i];
      s.classList.toggle("ok", i < typed.length && typed[i] === text[i]);
      s.classList.toggle("err", i < typed.length && typed[i] !== text[i]);
      s.classList.toggle("cur", i === typed.length && !session.done);
    }
  }
}

// Small helper for animation loops that stop cleanly.
export function loop(fn) {
  let id = 0, last = now(), stopped = false;
  function frame(t) {
    if (stopped) return;
    const dt = Math.min(100, t - last);
    last = t;
    fn(dt, t);
    id = requestAnimationFrame(frame);
  }
  id = requestAnimationFrame(frame);
  return () => { stopped = true; cancelAnimationFrame(id); };
}
