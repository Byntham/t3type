import { PASSAGES } from "../content/passages.js";

export { PASSAGES };

// Deterministic RNG so tests and reviewers can replay a run with ?seed=N.
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getSeed() {
  const s = new URLSearchParams(location.search).get("seed");
  return s != null && s !== "" ? Number(s) : Math.floor(Math.random() * 1e9);
}

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function filterPassages({ minLen = 0, maxLen = Infinity, topic } = {}) {
  return PASSAGES.filter(
    (p) => p.text.length >= minLen && p.text.length <= maxLen && (!topic || p.topic === topic),
  );
}

export function pickMany(n, opts = {}, rand = rng(getSeed())) {
  const pool = filterPassages(opts);
  return shuffle(pool.length ? pool : PASSAGES, rand).slice(0, n);
}

export function pickPassage(opts = {}, rand) {
  return pickMany(1, opts, rand)[0];
}

export function author(p) {
  return p.handle ? `${p.name || p.handle} (${p.handle})` : p.name;
}

export function authorShort(p) {
  return p.handle || p.name;
}

// Split text into phrases at punctuation, each at most maxLen chars.
// Pieces shorter than minLen merge into the previous phrase.
export function phrases(text, { maxLen = 48, minLen = 0 } = {}) {
  const parts = text.split(/(?<=[,.;:!?])\s+/);
  const out = [];
  for (const part of parts) {
    if (part.length <= maxLen) { out.push(part); continue; }
    let cur = "";
    for (const w of part.split(" ")) {
      if (cur && (cur + " " + w).length > maxLen) { out.push(cur); cur = w; }
      else cur = cur ? cur + " " + w : w;
    }
    if (cur) out.push(cur);
  }
  const merged = [];
  for (const p of out.filter(Boolean)) {
    if (merged.length && p.length < minLen) merged[merged.length - 1] += " " + p;
    else merged.push(p);
  }
  return merged;
}
