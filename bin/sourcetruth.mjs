#!/usr/bin/env node
// sourcetruth — read what contract code does, from source, and say what could not be determined.
//
// Exit codes: 0 parsed, 1 nothing found or below --min-resolution, 2 bad usage. Holes are NOT a
// failure — an honest 80% is the output, not an error.
//
// WHY THIS IS A FUNCTION WITH RETURNS, and never calls process.exit():
// stdout to a pipe is ASYNCHRONOUS. `process.exit()` tears the process down before the buffer
// drains, and `--json` on a real codebase was truncating at exactly 65282 bytes — a 64 KB pipe
// buffer — emitting JSON that ended mid-string. It looked perfect in a terminal, where stdout is
// synchronous, and broke the instant anyone piped it to jq. Set `process.exitCode` and return;
// Node then exits on its own once the buffer has flushed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import daml from "../src/adapters/daml.mjs";
import evm from "../src/adapters/evm.mjs";
import { graph, attackSurface } from "../src/model.mjs";
import { render as renderHtml } from "../src/report.mjs";

const PKG = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const ADAPTERS = { daml, evm, solidity: evm };

/** The JSON shape's version. Bump it when a field changes meaning or goes away — tools key off it. */
const SCHEMA_VERSION = 1;

const USAGE = `sourcetruth ${PKG.version} — see what contract code does, from source

Usage
  sourcetruth <dir> [mode] [options]

Modes (pick one; the default prints a summary and the blind spots)
  --html               the interactive map, as one self-contained HTML file
  --surface            state-changing actions that at most one party can take alone
  --holes              only what could not be traced
  --graph              contract-to-contract calls and creates
  --json               the full model, for your own tooling

Options
  -o, --out <file>     write the output to a file instead of stdout
  --title <text>       name the map (default: the directory name)
  --lang daml|evm      force the language (default: detected)
  --min-resolution N   exit 1 if less than N% of links could be traced (for CI)
  --include-tests      include test packages, TestContracts/, mocks/, *.t.sol
  --include-libs       report vendored dependencies (lib/) as if they were this code
  --dated              stamp today's date on the map (off by default, so maps diff cleanly)
  --demo [daml|solidity]  render a bundled example instead of <dir> (default: solidity)
  -v, --version        print the version
  -h, --help           print this

Examples
  sourcetruth --demo -o demo.html
  sourcetruth ./contracts --html -o map.html
  sourcetruth ./daml --surface
  sourcetruth . --json | jq '.entries[] | select(.authority == []) | .name'
  sourcetruth ./src --min-resolution 90`;

/** Pick an adapter by what the tree contains. Ties go to whichever has more files. */
function detectLanguage(root) {
  try {
    const nDaml = daml.findSources(root).length;
    const nSol = evm.findSources(root).length;
    if (nSol > nDaml) return "evm";
    if (nDaml > 0) return "daml";
    return nSol > 0 ? "evm" : "daml";
  } catch { return "daml"; }
}

function main(input) {
  let argv = [...input];
  const flag = (...names) => names.some((n) => argv.includes(n));
  const opt = (names, d = null) => {
    for (const n of [].concat(names)) { const i = argv.indexOf(n); if (i >= 0) return argv[i + 1] ?? d; }
    return d;
  };
  // A bare word that is not the value of an option that takes one.
  const VALUED = new Set(["--min-resolution", "--lang", "--title", "-o", "--out", "--demo"]);
  let target = argv.find((a, i) => !a.startsWith("-") && !VALUED.has(argv[i - 1]));

  if (flag("--help", "-h")) { console.log(USAGE); return 0; }
  if (flag("--version", "-v")) { console.log(PKG.version); return 0; }
  // A first look before pointing it at real code: render one of the bundled examples.
  if (flag("--demo")) {
    const which = String(opt("--demo", "solidity"));
    const dir = /^(daml)$/i.test(which) ? "daml-lending" : "solidity-vault";
    target = fileURLToPath(new URL(`../examples/${dir}`, import.meta.url));
    if (!flag("--html", "--json", "--surface", "--holes", "--graph")) argv = [...argv, "--html"];
    if (!argv.includes("--title")) argv = [...argv, "--title", `sourcetruth demo — ${dir}`];
  }
  if (!target) { console.error(USAGE); return 2; }
  if (!fs.existsSync(target)) { console.error(`sourcetruth: no such file or directory: ${target}`); return 2; }

  const lang = opt("--lang") ?? detectLanguage(path.resolve(target));
  const adapter = ADAPTERS[lang];
  if (!adapter) {
    console.error(`no adapter for "${lang}" (have: ${Object.keys(ADAPTERS).join(", ")})`);
    return 2;
  }

  let m;
  try { m = adapter.parse(path.resolve(target), { includeLibs: flag("--include-libs"), includeTests: flag("--include-tests") }); }
  catch (e) { console.error(`parse failed: ${e.message}`); return 1; }

  // Output goes to stdout, or to --out. Either way it is written once, whole.
  const outFile = opt(["-o", "--out"]);
  const lines = [];
  const say = (s = "") => lines.push(s);
  const flush = () => {
    const text = `${lines.join("\n")}\n`;
    if (outFile) {
      fs.writeFileSync(outFile, text);
      console.error(`wrote ${outFile} (${Math.max(1, Math.round(Buffer.byteLength(text) / 1024))} KB)`);
    } else process.stdout.write(text);
  };

  if (flag("--json")) {
    say(JSON.stringify({ schemaVersion: SCHEMA_VERSION, tool: { name: "sourcetruth", version: PKG.version }, ...m }, null, 2));
    flush();
    return 0;
  }

  if (flag("--html")) {
    // No timestamp unless asked: a report that differs every run cannot be diffed between commits,
    // and "what changed since last week" is the question this format is for.
    say(renderHtml(m, {
      title: opt("--title", `sourcetruth — ${path.basename(path.resolve(target))}`),
      generatedAt: flag("--dated") ? new Date().toISOString().slice(0, 10) : null,
    }));
    flush();
    return 0;
  }

  if (flag("--holes")) {
    for (const h of m.holes) say(`${h.path}  ${h.owner}  ${h.kind}  ${h.raw}`);
    flush();
    return 0;
  }
  if (flag("--graph")) {
    for (const e of graph(m).edges) {
      say(`${e.from} --${e.kind}--> ${e.to}${e.external ? " [external]" : ""}  (${e.via.join(", ")})`);
    }
    flush();
    return 0;
  }
  if (flag("--surface")) {
    for (const e of attackSurface(m)) {
      say(`${String(e.unguarded ? "ANYONE" : e.authority).padEnd(18)} ${`${e.unit}.${e.name}`.padEnd(38)} ${e.effect.padEnd(11)} moves:${e.moves} holes:${e.holes}  ${e.path}:${e.line}`);
    }
    flush();
    return 0;
  }

  // Default: the summary an auditor wants first.
  const s = m.stats;
  say(`\n  ${m.language}  ${m.root}`);
  say(`  ${s.modules} module(s)  ${s.units} unit(s)  ${s.entries} entr(ies)  ${s.edges} edge(s)`);
  if (s.resolution !== null) {
    say(`\n  resolution   ${s.resolution}%   (${s.holes} edge(s) could not be resolved from source)`);
  }
  say(`  solo-authority entries: ${s.soloAuthority}    terminal entries: ${s.terminal}`);
  for (const n of m.notes) say(`  note: ${n}`);

  if (m.holes.length) {
    say(`\n  HOLES — what this tool could not determine. Not guessed, not omitted:`);
    const byOwner = new Map();
    for (const h of m.holes) {
      if (!byOwner.has(h.owner)) byOwner.set(h.owner, []);
      byOwner.get(h.owner).push(h);
    }
    for (const [owner, hs] of [...byOwner].slice(0, 20)) {
      say(`    ${owner}`);
      for (const h of hs.slice(0, 4)) say(`      ${h.kind.padEnd(8)} ${h.raw.slice(0, 84)}`);
      if (hs.length > 4) say(`      … ${hs.length - 4} more`);
    }
    if (byOwner.size > 20) say(`    … ${byOwner.size - 20} more entr(ies) with holes`);
  }
  flush();

  const floor = opt("--min-resolution");
  if (floor !== null && s.resolution !== null && s.resolution < Number(floor)) {
    console.error(`  resolution ${s.resolution}% is below the required ${floor}%`);
    return 1;
  }
  return s.units === 0 ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
