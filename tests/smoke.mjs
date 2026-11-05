// Runs every play test. Usage: npm run smoke
import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
const dir = new URL(".", import.meta.url).pathname;
let failed = 0;
for (const f of readdirSync(dir).filter((f) => f.startsWith("play-")).sort()) {
  try {
    const out = execFileSync("node", [dir + f], { encoding: "utf8", timeout: 300000 });
    const bad = /errors?:\s*\[\s*['"]/.test(out) || /\bFAIL\b/.test(out);
    console.log(`${bad ? "FAIL" : "ok  "} ${f}`);
    if (bad) { failed++; console.log(out.split("\n").slice(-15).join("\n")); }
  } catch (e) {
    failed++;
    console.log(`FAIL ${f}\n${String(e.stdout || "").slice(-1500)}\n${String(e.stderr || "").slice(-1500)}`);
  }
}
process.exit(failed ? 1 : 0);
