// Renders the two bundled examples into public/demo/ with the CLI from this repository, so the site
// always shows exactly what the current build of the tool produces.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../../bin/sourcetruth.mjs", import.meta.url));
const out = fileURLToPath(new URL("../public/demo/", import.meta.url));
mkdirSync(out, { recursive: true });
for (const [lang, file, title] of [["solidity", "solidity-vault.html", "Demo vault"], ["daml", "daml-lending.html", "Demo lending"]]) {
  execFileSync(process.execPath, [cli, "--demo", lang, "-o", `${out}${file}`, "--title", title], { stdio: "inherit" });
}
