import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "packages/shared/src/codex-generated");
const versionSource = resolve(root, "packages/shared/src/api.ts");

const versionOutput = execFileSync("codex", ["--version"], {
  encoding: "utf8",
});
const version = versionOutput.trim().split(/\s+/).at(-1);
if (!version) {
  throw new Error("Unable to read Codex version.");
}

rmSync(output, { recursive: true, force: true });
execFileSync(
  "codex",
  ["app-server", "generate-ts", "--experimental", "--out", output],
  { stdio: "inherit" },
);

const source = readFileSync(versionSource, "utf8").replace(
  /SUPPORTED_CODEX_VERSION = '[^']+'/,
  `SUPPORTED_CODEX_VERSION = '${version}'`,
);
writeFileSync(versionSource, source);
console.log(`Generated app-server protocol types for Codex ${version}.`);
