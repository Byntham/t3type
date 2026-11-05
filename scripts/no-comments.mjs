import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SCRIPT_EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const CSS_EXTENSION = /\.css$/;
const HTML_EXTENSION = /\.html$/;

function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text[i] === "\n") line++;
  return line;
}

function isJsDocNode(node) {
  return node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
}

function scriptCommentOffsets(fileName, text) {
  const kind = fileName.endsWith(".tsx") || fileName.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const offsets = new Set();
  const jsxTextRanges = [];
  const visit = (node) => {
    if (isJsDocNode(node)) return;
    if (node.kind === ts.SyntaxKind.JsxText) {
      jsxTextRanges.push([node.pos, node.end]);
      return;
    }
    for (const range of ts.getLeadingCommentRanges(text, node.pos) ?? []) offsets.add(range.pos);
    for (const range of ts.getTrailingCommentRanges(text, node.end) ?? []) offsets.add(range.pos);
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);
  const insideJsxText = (offset) => jsxTextRanges.some(([start, end]) => offset >= start && offset < end);
  return [...offsets].filter((offset) => !insideJsxText(offset));
}

function cssCommentOffsets(text) {
  const offsets = [];
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "/" && text[i + 1] === "*") {
      offsets.push(i);
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
    }
  }
  return offsets;
}

function htmlCommentOffsets(fileName, text) {
  const offsets = [];
  for (const match of text.matchAll(/<!--/g)) offsets.push(match.index);
  for (const match of text.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/gi)) {
    const bodyStart = match.index + match[1].length;
    for (const offset of scriptCommentOffsets(`${fileName}.js`, match[2])) offsets.push(bodyStart + offset);
  }
  return offsets;
}

export function findComments(fileName, text) {
  let offsets = [];
  if (SCRIPT_EXTENSIONS.test(fileName)) offsets = scriptCommentOffsets(fileName, text);
  else if (CSS_EXTENSION.test(fileName)) offsets = cssCommentOffsets(text);
  else if (HTML_EXTENSION.test(fileName)) offsets = htmlCommentOffsets(fileName, text);
  return offsets.sort((a, b) => a - b).map((offset) => lineOf(text, offset));
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
    .split("\n")
    .filter((file) => SCRIPT_EXTENSIONS.test(file) || CSS_EXTENSION.test(file) || HTML_EXTENSION.test(file))
    .filter((file) => existsSync(file));
}

function main() {
  const problems = trackedFiles().flatMap((file) =>
    findComments(file, readFileSync(file, "utf8")).map((line) => `${file}:${line}`),
  );
  if (problems.length === 0) return;
  console.error("Code comments are not allowed. Use a clearer name or a test instead.\n");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
