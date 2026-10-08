// Local packaging only. Publication is owned by the Sites workflow.
import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const filename = ".open-next/cloudflare/next-env.mjs";
const declarations = new Map();
for (const line of readFileSync(filename, "utf8").trim().split("\n")) {
  const match = /^export const (production|development|test) = (.*);$/.exec(line);
  if (!match) throw new Error("Unexpected OpenNext environment output.");
  const [, mode, json] = match;
  const values = JSON.parse(json);
  if (Object.keys(values).some(key => !key.startsWith("NEXT_PUBLIC_"))) {
    throw new Error("Private environment values must be supplied by Sites at runtime, not bundled.");
  }
  if (declarations.has(mode) && declarations.get(mode) !== line) throw new Error("Conflicting OpenNext environment declarations.");
  declarations.set(mode, line);
}
// OpenNext 1.20.9 can append identical exports more than once. Keep one per mode.
writeFileSync(filename, [...declarations.values()].join("\n") + "\n");
const output = path.resolve(".sites-runtime/worker");
// Remove only reproducible build outputs so old WASM chunks cannot enter a new archive.
rmSync(output, { recursive: true, force: true });
rmSync("dist", { recursive: true, force: true });
execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "deploy", "--dry-run", "--outdir", output], { stdio: "inherit" });
mkdirSync("dist/server", { recursive: true });
for (const entry of readdirSync(output, { withFileTypes: true })) {
  if (entry.isFile() && /\.(js|wasm)$/.test(entry.name)) cpSync(path.join(output, entry.name), path.join("dist/server", entry.name));
}
writeFileSync("dist/server/index.js", 'export { default } from "./worker.js";\nexport * from "./worker.js";\n');
cpSync(".open-next/assets", "dist/client", { recursive: true });
mkdirSync("dist/.openai", { recursive: true });
cpSync(".openai/hosting.json", "dist/.openai/hosting.json");
