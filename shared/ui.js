import { author } from "./content.js";

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return el;
}

// Builds the page header and returns the <main> element to render into.
export function mountShell({ title, tagline }) {
  document.title = `${title} | swetype`;
  const main = h("main", { class: "stack" });
  document.body.appendChild(
    h("div", { class: "shell" },
      h("header", { class: "topbar" },
        h("a", { class: "home", href: "../../index.html" }, "< swetype"),
        h("h1", {}, title),
        h("span", { class: "tagline" }, tagline),
      ),
      main,
    ),
  );
  return main;
}

export function lessonCard(p) {
  return h("div", { class: "lesson" },
    h("blockquote", {}, `"${p.text}"`),
    h("div", { class: "who" },
      author(p),
      p.sourceUrl ? [" . ", h("a", { href: p.sourceUrl, target: "_blank", rel: "noopener" }, "source")] : null,
    ),
    p.lesson ? h("div", { class: "takeaway" }, h("b", {}, "Lesson. "), p.lesson) : null,
  );
}

export function stat(label, value) {
  return h("div", { class: "stat" }, h("div", { class: "v" }, String(value)), h("div", { class: "l" }, label));
}

export function statsRow(pairs) {
  return h("div", { class: "stats" }, pairs.map(([l, v]) => stat(l, v)));
}

// Replaces the contents of el.
export function render(el, ...children) {
  el.textContent = "";
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function fmt(n, d = 0) {
  return Number.isFinite(n) ? n.toFixed(d) : "-";
}

export function pct(x) {
  return `${Math.round(x * 100)}%`;
}

// Expose game state for automated play-testing (Playwright, reviewers).
export function exposeState(name, getState) {
  window.__game = { name, state: getState };
}
