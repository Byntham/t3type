import { describe, expect, it } from "vitest";
import { findComments } from "../scripts/no-comments.mjs";

describe("findComments", () => {
  it("flags line, block, and JSDoc comments in TypeScript", () => {
    const source = ["// line", "const a = 1; /* block */", "/** doc */", "export const b = a;"].join("\n");
    expect(findComments("x.ts", source)).toEqual([1, 2, 3]);
  });

  it("flags comments inside JSX expressions", () => {
    const source = ["export const A = () => (", "  <div>", "    {/* hidden */}", "  </div>", ");"].join("\n");
    expect(findComments("x.tsx", source)).toEqual([3]);
  });

  it("ignores comment markers inside strings, regexes, templates, and JSX text", () => {
    const source = [
      'const url = "https://example.com/*not*/";',
      "const re = /\\/\\*/;",
      "const tpl = `// ${url} /* */`;",
      "export const A = () => <p>// not a comment</p>;",
    ].join("\n");
    expect(findComments("x.tsx", source)).toEqual([]);
  });

  it("flags CSS comments but not markers inside CSS strings", () => {
    const source = ['a { background: url("a/*b.png"); }', "/* note */", "b { color: red; }"].join("\n");
    expect(findComments("x.css", source)).toEqual([2]);
  });

  it("flags HTML comments and comments in inline scripts", () => {
    const source = ["<!-- note -->", "<script>", "  // inline", '  var u = "http://x";', "</script>"].join("\n");
    expect(findComments("x.html", source)).toEqual([1, 3]);
  });

  it("skips files it does not lint", () => {
    expect(findComments("x.json", '{ "a": "// b" }')).toEqual([]);
    expect(findComments("README.md", "<!-- note -->")).toEqual([]);
  });
});
