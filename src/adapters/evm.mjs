// Solidity / EVM adapter. Reads .sol source and emits the same neutral model as the Daml adapter.
//
// The model was written before this file existed, precisely so this adapter would have to FIT it
// rather than redefine it.
//
//   neutral     Solidity
//   ---------   ------------------------------------------------------------------
//   Unit        contract / abstract contract / interface / library
//   Entry       external or public function (internal/private are not entry points)
//   authority   an access check that ALWAYS runs: a modifier that checks the caller, or a top-level
//               require/if-revert on msg.sender — in the function or in a helper it calls
//   CREATE      new C(...)
//   CALL        any call into another contract: typed variable, cast, library, `this.`, low-level
//   DESTROY     selfdestruct(...)
//   Guard       require(...), revert ..., assert(...), and modifiers that are not access checks
//   Hole        a call whose target cannot be named from source — never dropped, never guessed
//
// THE AUTHORITY INVERSION, and it matters for how you read the surface: in Daml a choice always
// declares a controller, so the risk signal is ONE principal acting alone. In Solidity the default
// is NO restriction — a function with no access check is callable by anyone. So an EMPTY authority
// list here is strictly more open than a one-element list, not less.
//
// HOW CALLS ARE FOUND. The first version recognised four shapes (selfdestruct, `new`, low-level
// `.call`, and casts like `IERC20(x).transfer()`) and silently ignored everything else — including
// the most common Solidity call there is, a method on a typed variable: `token.safeTransfer(...)`.
// Those were not holes; they were invisible, and "99% traced" measured only the calls it happened
// to see. Now every `name(` in a body is visited and classified: an edge with a named target, a
// hole, an internal call, or something that is not a call (a cast, an event, a builtin). A call that
// cannot be classified becomes a hole. There is no fifth outcome.
//
// HOW AUTHORITY IS FOUND. Checks are only credited when they run on every path. A real vault guards
// its admin functions by calling `onlyManager();`, a plain function two contracts up the inheritance
// chain — reading only modifiers showed eleven of them as callable by anyone. So top-level calls
// into helpers are followed, through inheritance and into vendored libraries. A check inside an
// `if` is NOT credited: claiming a guard that might not run hides an open function, which is the
// one mistake an access map must not make.
//
// Comments are stripped before anything is parsed, as in Daml, and string contents are blanked
// before any scan, so neither can be mistaken for code.

import fs from "node:fs";
import path from "node:path";
import { EDGE, EFFECT, edge, entry, unit, model } from "../model.mjs";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "out", "cache", "artifacts", "build", "dist", "broadcast", "coverage",
]);

/**
 * Tests and deploy scripts are excluded by default, for the same reason `lib/` is. A Foundry test
 * contract is public, unguarded and never deployed — so counted as code it tops the list of what
 * ANYONE can call, and on real vaults it was more than half the files.
 */
// Liquity-style repos keep harnesses in `TestContracts/`; many keep doubles in `mocks/`.
const TEST_DIR = /^(tests?|scripts?|test[-_]?contracts?|mocks?)$/i;

/**
 * Find .sol sources. `lib/` is INCLUDED only when asked: a Foundry project vendors OpenZeppelin
 * there, and reporting a dependency's contracts as the project's own is the same error as parsing
 * Daml's `.daml/` build directory. (It is still READ, for inheritance — see parse().)
 */
export function findSources(root, { includeLibs = false, includeTests = false } = {}) {
  const out = [];
  // Only a project's DEPENDENCY directory is vendored: Foundry's `lib/`, beside foundry.toml or at the
  // root you point at. Skipping every directory named `libs` threw away a vault's own
  // `src/libs/WhitelistFilter.sol` — its access control — as if it were somebody else's code.
  const vendorDir = (dir, name) => name === "lib"
    && (dir === rootDir || fs.existsSync(path.join(dir, "foundry.toml")) || fs.existsSync(path.join(dir, "remappings.txt")));
  const rootDir = fs.statSync(root).isFile() ? path.dirname(root) : root;
  const walk = (dir) => {
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) {
        if (SKIP_DIRS.has(it.name)) continue;
        if (!includeLibs && vendorDir(dir, it.name)) continue;
        if (!includeTests && TEST_DIR.test(it.name)) continue;
        walk(p);
      } else if (it.isFile() && it.name.endsWith(".sol")) {
        if (!includeTests && /\.(t|s)\.sol$/.test(it.name)) continue;
        out.push(p);
      }
    }
  };
  const st = fs.statSync(root);
  if (st.isFile()) return root.endsWith(".sol") ? [root] : [];
  walk(root);
  return out.sort();
}

/** Strip // and /* *\/ comments, leaving string literals intact and line numbers unchanged. */
export function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '"' || c === "'") {
      const q = c; out += c; i++;
      while (i < n && src[i] !== q) { if (src[i] === "\\") { out += src[i]; i++; } out += src[i]; i++; }
      out += src[i] ?? ""; i++;
      continue;
    }
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") {
      i += 2;
      // Preserve newlines so reported line numbers still match the original file.
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") out += "\n"; i++; }
      i += 2;
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** Blank string CONTENTS (quotes and length kept), so no scan can match a brace or call inside one. */
function maskStrings(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      out += c; i++;
      while (i < src.length && src[i] !== c && src[i] !== "\n") {
        if (src[i] === "\\" && i + 1 < src.length) { out += "  "; i += 2; continue; }
        out += " "; i++;
      }
      if (i < src.length) { out += src[i]; i++; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** Index of the closer matching the opener at `open`, or -1. */
function matchPair(s, open, a = "{", b = "}") {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === a) depth++;
    else if (s[i] === b) { depth--; if (depth === 0) return i; }
  }
  return -1;
}
/** Index of the opener matching the closer at `close`, walking backwards, or -1. */
function matchBack(s, close, a, b) {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (s[i] === b) depth++;
    else if (s[i] === a) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function lineStarts(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return starts;
}
function lineAt(starts, idx) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= idx) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

/** Split at a separator, ignoring any inside () [] {}. */
function splitTop(text, sep) {
  const out = [];
  let depth = 0, cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    if (depth === 0 && text.startsWith(sep, i)) { out.push(cur); cur = ""; i += sep.length - 1; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter((s) => s.length);
}

/** Drop parentheses that wrap the whole expression. */
function unwrap(t) {
  let s = t.trim();
  while (s.startsWith("(") && matchPair(s, 0, "(", ")") === s.length - 1) s = s.slice(1, -1).trim();
  return s;
}

/** Split a parameter list at top-level commas into { name, type }. */
function splitParams(text) {
  return splitTop(text, ",").map((p) => {
    const parts = p.replace(/\s+/g, " ").split(" ").filter((x) => !/^(memory|storage|calldata|indexed)$/.test(x));
    const name = parts.length > 1 && /^[A-Za-z_]\w*$/.test(parts[parts.length - 1]) ? parts[parts.length - 1] : "";
    const type = name ? parts.slice(0, -1).join(" ") : parts.join(" ");
    return { name, type };
  });
}

const KNOWN_MODIFIERS = new Set([
  "public", "external", "internal", "private", "view", "pure", "payable", "virtual", "override",
  "constant", "immutable", "returns", "memory", "storage", "calldata", "nonpayable",
]);

/** Everything between the parameter list and the body: visibility, mutability, modifiers, returns. */
function parseSignatureTail(tail) {
  const visibility = /\b(external|public|internal|private)\b/.exec(tail)?.[1] ?? "internal";
  const mutability = /\b(view|pure|payable)\b/.exec(tail)?.[1] ?? null;
  let returns = [];
  let rest = tail;
  const r = /\breturns\s*\(/.exec(tail);
  if (r) {
    const open = r.index + r[0].length - 1;
    const close = matchPair(tail, open, "(", ")");
    if (close > 0) {
      returns = splitParams(tail.slice(open + 1, close));
      rest = tail.slice(0, r.index) + " " + tail.slice(close + 1);
    }
  }
  rest = rest.replace(/\boverride\s*\([^)]*\)/g, " ");
  const modifiers = [...rest.matchAll(/\b([A-Za-z_]\w*)\s*(\([^)]*\))?/g)]
    .map((m) => m[1])
    .filter((w) => !KNOWN_MODIFIERS.has(w));
  return { visibility, mutability, returns, modifiers };
}

const ELEMENTARY = /^(address|bool|string|bytes\d*|u?int\d*|u?fixed[\dx]*|byte)$/;
const LOCAL_KEYWORDS = new Set([
  "return", "emit", "delete", "else", "new", "revert", "require", "assert", "unchecked", "if", "for",
  "while", "do", "break", "continue", "throw", "case", "import", "using", "is", "try", "catch", "assembly",
]);
// Names that are followed by `(` but are not calls into code: control flow, builtins, casts.
const NOT_A_CALL = new Set([
  "if", "for", "while", "return", "returns", "function", "modifier", "event", "error", "emit", "revert",
  "require", "assert", "new", "delete", "catch", "try", "mapping", "unchecked", "assembly", "type",
  "keccak256", "sha256", "ripemd160", "ecrecover", "addmod", "mulmod", "blockhash", "blobhash",
  "gasleft", "payable", "address", "bool", "string", "bytes", "abi", "super", "this", "unicode", "hex", "else",
]);
const LOW_LEVEL = new Set(["call", "delegatecall", "staticcall", "callcode"]);
const YUL_CALLS = new Set(["call", "callcode", "delegatecall", "staticcall"]);

// ── the declaration index ────────────────────────────────────────────────────────────────────────

/** Every contract, interface and library in one file, with enough structure to resolve calls. */
function parseFile(file, root, reported) {
  const raw = fs.readFileSync(file, "utf8");
  const src = stripComments(raw);
  const mk = maskStrings(src);
  const starts = lineStarts(src);
  const rel = path.relative(root, file);
  const decls = [];
  const RE = /\b(abstract\s+)?(contract|interface|library)\s+([A-Za-z_]\w*)([^{;]*)\{/g;
  let m;
  while ((m = RE.exec(mk)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchPair(mk, open);
    if (close < 0) continue;
    const isList = /\bis\b([\s\S]*)$/.exec(m[4]);
    const inherits = isList
      ? splitTop(isList[1], ",").map((s) => /^([A-Za-z_][\w.]*)/.exec(s)?.[1]).filter(Boolean)
      : [];
    const d = {
      name: m[3], kind: m[2], abstract: Boolean(m[1]), file, rel, raw, src, mk, starts, reported,
      open, close, line: lineAt(starts, m.index), endLine: lineAt(starts, close),
      inherits, usings: [], fields: new Map(), structs: new Map(), enums: new Set(),
      functions: [], modifiers: [],
    };
    parseBody(d);
    decls.push(d);
    RE.lastIndex = close + 1;
  }
  // Structs and enums declared at file level, outside every contract, are visible to all of them.
  const outside = (i) => decls.every((d) => i < d.open || i > d.close);
  for (const s of mk.matchAll(/\bstruct\s+([A-Za-z_]\w*)\s*\{/g)) {
    if (!outside(s.index)) continue;
    const end = matchPair(mk, s.index + s[0].length - 1);
    const fields = new Map();
    for (const part of mk.slice(s.index + s[0].length, end).split(";")) {
      const p = splitParams(part.trim())[0];
      if (p?.name) fields.set(p.name, p.type);
    }
    for (const d of decls) if (!d.structs.has(s[1])) d.structs.set(s[1], fields);
  }
  for (const s of mk.matchAll(/\benum\s+([A-Za-z_]\w*)\s*\{/g)) {
    if (outside(s.index)) for (const d of decls) d.enums.add(s[1]);
  }
  return decls;
}

function parseBody(d) {
  const { mk } = d;
  // Top-level statements: state variables, using-directives. Blocks that belong to a function,
  // modifier, struct or enum are skipped here and read by the passes below.
  let stmt = "";
  for (let k = d.open + 1; k < d.close; k++) {
    const ch = mk[k];
    if (ch === "{") {
      const end = matchPair(mk, k);
      if (end < 0) break;
      if (/^\s*(function|modifier|constructor|receive|fallback|struct|enum)\b/.test(stmt)) stmt = "";
      else stmt += mk.slice(k, end + 1);
      k = end;
      continue;
    }
    if (ch === ";") { topStatement(d, stmt.trim()); stmt = ""; continue; }
    stmt += ch;
  }

  const depth1 = (idx) => {
    let dep = 0;
    for (let k = d.open; k < idx; k++) { if (mk[k] === "{") dep++; else if (mk[k] === "}") dep--; }
    return dep === 1;
  };
  const region = mk.slice(0, d.close);

  const STRUCT = /\bstruct\s+([A-Za-z_]\w*)\s*\{/g;
  STRUCT.lastIndex = d.open;
  for (let s; (s = STRUCT.exec(region)) !== null;) {
    const end = matchPair(mk, s.index + s[0].length - 1);
    const fields = new Map();
    for (const part of mk.slice(s.index + s[0].length, end).split(";")) {
      const p = splitParams(part.trim())[0];
      if (p?.name) fields.set(p.name, p.type);
    }
    d.structs.set(s[1], fields);
  }
  const ENUM = /\benum\s+([A-Za-z_]\w*)\s*\{/g;
  ENUM.lastIndex = d.open;
  for (let s; (s = ENUM.exec(region)) !== null;) d.enums.add(s[1]);

  const MOD = /\bmodifier\s+([A-Za-z_]\w*)/g;
  MOD.lastIndex = d.open;
  for (let s; (s = MOD.exec(region)) !== null;) {
    if (!depth1(s.index)) continue;
    const brace = mk.indexOf("{", s.index);
    const semi = mk.indexOf(";", s.index);
    if (brace < 0 || (semi >= 0 && semi < brace)) continue;
    const end = matchPair(mk, brace);
    if (end > 0) d.modifiers.push({ name: s[1], decl: d, bodyOpen: brace, bodyClose: end });
  }

  const FN = /\b(function\s+([A-Za-z_]\w*)|constructor|receive|fallback)\s*\(/g;
  FN.lastIndex = d.open;
  for (let f; (f = FN.exec(region)) !== null;) {
    if (!depth1(f.index)) continue;
    const name = f[2] ?? f[1];
    const paramOpen = f.index + f[0].length - 1;
    const paramClose = matchPair(mk, paramOpen, "(", ")");
    if (paramClose < 0) continue;
    const brace = mk.indexOf("{", paramClose);
    const semi = mk.indexOf(";", paramClose);
    const declaredOnly = semi >= 0 && (brace < 0 || semi < brace);
    const tail = mk.slice(paramClose + 1, declaredOnly ? semi : brace);
    const sig = parseSignatureTail(tail);
    const bodyClose = declaredOnly ? null : matchPair(mk, brace);
    d.functions.push({
      name, decl: d, kind: f[2] ? "function" : f[1],
      params: splitParams(mk.slice(paramOpen + 1, paramClose)),
      returns: sig.returns, visibility: sig.visibility, mutability: sig.mutability,
      modifiers: sig.modifiers,
      bodyOpen: declaredOnly ? null : brace, bodyClose,
      line: lineAt(d.starts, f.index),
      endLine: declaredOnly ? lineAt(d.starts, semi) : lineAt(d.starts, bodyClose),
    });
  }
}

function topStatement(d, s) {
  if (!s) return;
  const using = /^using\s+([A-Za-z_][\w.]*|\{[^}]*\})\s+for\s+([^;]+?)(\s+global)?$/.exec(s);
  if (using) {
    const libs = using[1].startsWith("{") ? [] : [using[1]];
    for (const lib of libs) d.usings.push({ lib, type: using[2].trim() });
    return;
  }
  if (/^(function|modifier|constructor|receive|fallback|event|error|pragma|import|struct|enum|type)\b/.test(s)) return;
  const noInit = splitTop(s, "=")[0] ?? s;
  let type, rest;
  if (noInit.startsWith("mapping")) {
    const po = noInit.indexOf("(");
    const pc = matchPair(noInit, po, "(", ")");
    if (pc < 0) return;
    type = noInit.slice(0, pc + 1);
    rest = noInit.slice(pc + 1);
  } else {
    const mm = /^([A-Za-z_][\w.]*(?:\s*\[[^\]]*\])*(?:\s+payable)?)\s+([\s\S]*)$/.exec(noInit);
    if (!mm) return;
    type = mm[1];
    rest = mm[2];
  }
  const toks = rest.trim().split(/\s+/)
    .filter((t) => !/^(public|private|internal|constant|immutable|override|transient)$/.test(t));
  const name = toks[toks.length - 1];
  if (name && /^[A-Za-z_]\w*$/.test(name)) d.fields.set(name, type.replace(/\s+/g, " ").trim());
}

// ── imports ──────────────────────────────────────────────────────────────────────────────────────

/** Foundry remappings from remappings.txt and foundry.toml, longest prefix first. */
function loadRemappings(cfgDir) {
  const maps = [];
  const add = (line) => {
    const m = /^\s*(?:[\w.-]+:)?([^=\s]+)\s*=\s*(\S+)\s*$/.exec(line);
    if (m) maps.push([m[1], m[2]]);
  };
  try { fs.readFileSync(path.join(cfgDir, "remappings.txt"), "utf8").split("\n").forEach(add); } catch { /* none */ }
  try {
    const toml = fs.readFileSync(path.join(cfgDir, "foundry.toml"), "utf8");
    const block = /remappings\s*=\s*\[([\s\S]*?)\]/.exec(toml);
    if (block) for (const q of block[1].matchAll(/["']([^"']+)["']/g)) add(q[1]);
  } catch { /* none */ }
  return maps.sort((a, b) => b[0].length - a[0].length);
}

/** Every .sol under the project's dependency folders, by file name — built once, only when needed. */
const depIndexCache = new Map();
function depIndex(cfgDir) {
  if (depIndexCache.has(cfgDir)) return depIndexCache.get(cfgDir);
  const byName = new Map();
  const walk = (dir, depth) => {
    if (depth > 12) return;
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) {
        if (it.name === ".git" || it.name === "out" || it.name === "cache" || TEST_DIR.test(it.name)) continue;
        walk(p, depth + 1);
      } else if (it.name.endsWith(".sol")) {
        if (!byName.has(it.name)) byName.set(it.name, []);
        byName.get(it.name).push(p);
      }
    }
  };
  for (const dep of ["lib", "node_modules"]) walk(path.join(cfgDir, dep), 0);
  depIndexCache.set(cfgDir, byName);
  return byName;
}

/**
 * When a remapped path does not exist, find the same file inside a NESTED dependency — the way
 * Foundry's auto-remapping does. A repo can remap `@openzeppelin/` to `lib/openzeppelin-contracts/`
 * while the only copy on disk is `lib/openzeppelin-contracts-upgradeable/lib/openzeppelin-contracts/`.
 * The longest matching path tail wins, then the shortest path.
 */
function nestedResolve(spec, cfgDir) {
  const parts = spec.split("/");
  const cands = depIndex(cfgDir).get(parts[parts.length - 1]) ?? [];
  for (let k = 0; k < parts.length - 1; k++) {
    const tail = `/${parts.slice(k).join("/")}`;
    const hit = cands.filter((p) => p.endsWith(tail)).sort((a, b) => a.length - b.length)[0];
    if (hit) return hit;
  }
  return null;
}

function resolveImport(spec, fromFile, cfgDir, maps) {
  if (spec.startsWith(".")) return path.resolve(path.dirname(fromFile), spec);
  for (const [prefix, target] of maps) {
    if (spec.startsWith(prefix)) return path.resolve(cfgDir, target + spec.slice(prefix.length));
  }
  for (let dir = path.dirname(fromFile); ; dir = path.dirname(dir)) {
    const cand = path.join(dir, "node_modules", spec);
    if (fs.existsSync(cand)) return cand;
    if (dir === path.dirname(dir) || !dir.startsWith(cfgDir)) break;
  }
  for (const base of ["lib", "node_modules", ""]) {
    const cand = path.resolve(cfgDir, base, spec);
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

/**
 * The files to READ: what is reported, plus everything it imports, transitively, resolved the way
 * the compiler would. Reading exactly the imports — not all of lib/ — finds a parent wherever it
 * lives (lib/, node_modules, a remapped path), and tells us precisely which ones are MISSING: an
 * uninitialised submodule is an empty directory, and an access check inside it cannot be read.
 */
function importClosure(files, root) {
  let cfgDir = fs.statSync(root).isFile() ? path.dirname(root) : root;
  for (let up = cfgDir, i = 0; i < 4; i++, up = path.dirname(up)) {
    if (fs.existsSync(path.join(up, "foundry.toml")) || fs.existsSync(path.join(up, "remappings.txt"))) { cfgDir = up; break; }
    if (up === path.dirname(up)) break;
  }
  const maps = loadRemappings(cfgDir);
  const readable = new Set(files);
  const missing = new Set();
  // Per file, what each import brings into scope: every name (`import "x"`, `import * as X`), or
  // just the listed ones (`import {A, B as C} from "x"`). Names resolve through these, the way the
  // compiler resolves them — a repo that vendors both OpenZeppelin and solmate has two `ERC20`s.
  const imports = new Map();
  const queue = [...files];
  while (queue.length) {
    const f = queue.shift();
    let text;
    try { text = stripComments(fs.readFileSync(f, "utf8")); } catch { continue; }
    const list = [];
    imports.set(f, list);
    for (const m of text.matchAll(/\bimport\s+(?:([^"';]*?)\s+from\s+)?["']([^"']+)["']/g)) {
      const spec = m[2];
      let hit = resolveImport(spec, f, cfgDir, maps);
      if (!(hit && fs.existsSync(hit)) && !spec.startsWith(".")) hit = nestedResolve(spec, cfgDir);
      let names = null;
      const clause = (m[1] ?? "").trim();
      if (clause.startsWith("{")) {
        names = new Map();
        for (const part of clause.slice(1, clause.lastIndexOf("}")).split(",")) {
          const a = /^\s*([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?\s*$/.exec(part);
          if (a) names.set(a[2] ?? a[1], a[1]);
        }
      }
      if (hit && fs.existsSync(hit)) {
        list.push({ file: hit, names });
        if (!readable.has(hit)) { readable.add(hit); queue.push(hit); }
      } else missing.add(spec);
    }
  }
  return { readable: [...readable], missing: [...missing].sort(), imports };
}

// ── resolution ───────────────────────────────────────────────────────────────────────────────────

function makeResolver(index, reportedNames, imports = new Map()) {
  const byFile = new Map();
  for (const all of index.values()) {
    for (const d of all) {
      if (!byFile.has(d.file)) byFile.set(d.file, []);
      byFile.get(d.file).push(d);
    }
  }

  /** The declaration a name means IN a file: its own, else through its imports, transitively. */
  const inScope = (name, file, seen) => {
    const key = `${file}\0${name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const own = (byFile.get(file) ?? []).find((d) => d.name === name);
    if (own) return own;
    for (const imp of imports.get(file) ?? []) {
      const orig = imp.names ? imp.names.get(name) : name;
      if (orig == null) continue;
      const hit = inScope(orig, imp.file, seen);
      if (hit) return hit;
    }
    return null;
  };

  // A name is looked up from the file that uses it when that file is known; two dependencies can
  // both declare `ERC20`, and which one a contract inherits is decided by its imports, not by which
  // was read first. The global answer remains for names with no file to start from.
  const scoped = new Map();
  const pick = (name, fromFile = null) => {
    const last = String(name).split(".").pop();
    if (fromFile) {
      const key = `${fromFile}\0${last}`;
      if (!scoped.has(key)) scoped.set(key, inScope(last, fromFile, new Set()));
      const hit = scoped.get(key);
      if (hit) return hit;
    }
    const all = index.get(last) ?? [];
    return all.find((d) => d.reported) ?? all[0] ?? null;
  };

  /**
   * Solidity's linearization (C3, bases merged right to left), so an implementation always precedes
   * the interface it implements: for `ERC4626 is ERC20, IERC4626`, ERC20 comes before IERC20. A plain
   * depth-first walk put the interface first, and an inherited function was read as a declaration.
   * When the merge cannot complete (a hierarchy the compiler would reject, or a parent that isn't on
   * disk), the depth-first order is used so nothing is lost.
   */
  const chainCache = new Map();
  const depthFirst = (d) => {
    const out = [];
    const seen = new Set();
    const visit = (x) => {
      if (!x || seen.has(x)) return;
      seen.add(x);
      out.push(x);
      for (const p of [...x.inherits].reverse()) visit(pick(p, x.file));
    };
    visit(d);
    return out;
  };
  const chainOf = (d, stack = new Set()) => {
    if (chainCache.has(d)) return chainCache.get(d);
    if (stack.has(d)) return [d];
    stack.add(d);
    const parents = [...d.inherits].reverse().map((p) => pick(p, d.file)).filter(Boolean);
    const lists = parents.map((p) => [...chainOf(p, stack)]);
    lists.push([...parents]);
    const out = [d];
    let ok = true;
    for (;;) {
      const live = lists.filter((l) => l.length);
      if (!live.length) break;
      const head = live.map((l) => l[0]).find((h) => live.every((l) => !l.slice(1).includes(h)));
      if (!head) { ok = false; break; }
      if (!out.includes(head)) out.push(head);
      for (const l of live) if (l[0] === head) l.shift();
    }
    const chain = ok ? out : depthFirst(d);
    stack.delete(d);
    chainCache.set(d, chain);
    return chain;
  };

  /** Implementations with this name in the most-derived contract that has one. */
  const lookup = (chain, name, { skipFirst = false } = {}) => {
    for (const c of skipFirst ? chain.slice(1) : chain) {
      const hits = c.functions.filter((f) => f.name === name && f.bodyOpen != null);
      if (hits.length) return hits;
    }
    return [];
  };
  const structFields = (typeName, chain) => {
    const last = String(typeName).split(".").pop();
    for (const c of chain) if (c.structs.has(last)) return c.structs.get(last);
    for (const all of index.values()) for (const c of all) if (c.structs.has(last)) return c.structs.get(last);
    return null;
  };
  const isEnum = (typeName, chain) => {
    const last = String(typeName).split(".").pop();
    if (chain.some((c) => c.enums.has(last))) return true;
    for (const all of index.values()) for (const c of all) if (c.enums.has(last)) return true;
    return false;
  };
  const elementType = (t) => {
    const s = t.trim();
    if (s.startsWith("mapping")) {
      const inner = s.slice(s.indexOf("(") + 1, s.lastIndexOf(")"));
      const parts = splitTop(inner, "=>");
      return parts.length >= 2 ? parts.slice(1).join("=>").trim() : null;
    }
    const mm = /^([\s\S]*)\[[^\]]*\]$/.exec(s);
    return mm ? mm[1].trim() : null;
  };

  /** What a type is, for the purpose of deciding what calling a method on it means. */
  const classify = (t, chain) => {
    if (!t) return "unknown";
    const base = t.replace(/\s+payable$/, "").trim();
    if (base === "address") return "address";
    if (base.startsWith("mapping") || /\]$/.test(base)) return "collection";
    if (ELEMENTARY.test(base)) return "value";
    const last = base.split(".").pop();
    if (!/^[A-Z]/.test(last)) return "unknown";
    if (structFields(last, chain)) return "struct";
    if (isEnum(last, chain)) return "value";
    return "contract";
  };

  const usingFor = (chain, type) => {
    const base = String(type ?? "").replace(/\s+payable$/, "").trim();
    for (const c of chain) {
      for (const u of c.usings) if (u.type === "*" || u.type === base || u.type.split(".").pop() === base.split(".").pop()) return u.lib;
    }
    return null;
  };
  const libFunctions = (lib, method, fromFile = null) =>
    (pick(lib, fromFile)?.functions ?? []).filter((f) => f.name === method && f.bodyOpen != null);
  const pureOnly = (fns) => fns.length > 0 && fns.every((f) => f.mutability === "pure" || f.mutability === "view");

  return { index, pick, chainOf, lookup, structFields, elementType, classify, usingFor, libFunctions, pureOnly, reportedNames };
}

/** Index of the first arithmetic operator at nesting depth 0, or -1 (unary minus at the start is not one). */
function topLevelOperator(e) {
  let depth = 0;
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if ("([".includes(c)) depth++;
    else if (")]".includes(c)) depth--;
    else if (depth === 0 && i > 0 && "+-*/%".includes(c) && !"+-*/%=<>!&|".includes(e[i - 1]) && e[i + 1] !== "=" && e[i + 1] !== ">") return i;
  }
  return -1;
}

/** Local variable declarations in a body, as name -> type. */
function localsOf(body) {
  const env = new Map();
  const LOCAL = /(?:^|[;{}(,])\s*((?:mapping\s*\([^;]*?\))|[A-Za-z_][\w.]*(?:\s*\[[^\]]*\])*(?:\s+payable)?)\s+(?:(?:memory|storage|calldata)\s+)?([A-Za-z_]\w*)\s*(?==|;|,|\))/g;
  for (let m; (m = LOCAL.exec(body)) !== null;) {
    const type = m[1].trim();
    if (LOCAL_KEYWORDS.has(type.split(/[\s[]/)[0])) continue;
    env.set(m[2], type.replace(/\s+/g, " "));
    LOCAL.lastIndex = m.index + m[0].length - 1;
  }
  return env;
}

/** Read the receiver expression that ends just before `end` (inclusive), walking backwards. */
const RECEIVER_STOP = new Set(["return", "if", "else", "while", "for", "do", "emit", "revert", "assert", "require", "unchecked", "catch", "try"]);
function readReceiver(s, end) {
  let i = end;
  while (i >= 0 && /\s/.test(s[i])) i--;
  const stop = i;
  for (;;) {
    if (i < 0) break;
    if (s[i] === ")" || s[i] === "]") {
      const o = matchBack(s, i, s[i] === ")" ? "(" : "[", s[i]);
      if (o < 0) break;
      i = o - 1;
      let j = i;
      while (j >= 0 && /\s/.test(s[j])) j--;
      if (j >= 0 && /[\w]/.test(s[j])) {
        // `return (a + b).x()`: a keyword before the parenthesis is not a call — the group is the receiver.
        let k = j;
        while (k >= 0 && /[\w]/.test(s[k])) k--;
        if (RECEIVER_STOP.has(s.slice(k + 1, j + 1))) break;
        i = j;
        continue;
      }
    } else if (/[\w]/.test(s[i])) {
      while (i >= 0 && /[\w]/.test(s[i])) i--;
    } else break;
    let j = i;
    while (j >= 0 && /\s/.test(s[j])) j--;
    if (j >= 0 && s[j] === ".") { i = j - 1; while (i >= 0 && /\s/.test(s[i])) i--; continue; }
    break;
  }
  return s.slice(i + 1, stop + 1).trim();
}

/**
 * Every call site in one function body, classified. The contract of this function is that nothing
 * followed by `(` is dropped without a reason: it is an edge, a hole, an internal call, or named as
 * not being a call at all.
 */
function scanBody(fn, R, ctx = fn.decl, binds = new Map()) {
  // Text comes from where the function is written; names resolve against the contract that actually
  // runs it. An inherited `deposit()` calling `_deposit(...)` reaches the child's OVERRIDE — that is
  // virtual dispatch, and resolving against the base would trace code that never executes.
  // A library's body is different: a bare name there is the library's own function.
  const d = fn.decl;
  const chain = R.chainOf(ctx);
  const lookChain = d.kind === "library" ? [d] : chain;
  const usingChain = d.kind === "library" ? [d, ...chain] : chain;
  const { mk, src, starts } = d;
  const open = fn.bodyOpen + 1, close = fn.bodyClose;
  const body = mk.slice(open, close);

  const env = new Map();
  for (const c of [...chain].reverse()) for (const [n, t] of c.fields) env.set(n, t);
  for (const p of fn.params) if (p.name) env.set(p.name, p.type);
  for (const r of fn.returns) if (r.name) env.set(r.name, r.type);
  for (const [n, t] of localsOf(body)) env.set(n, t);

  // Yul inside `assembly { }` has its own call primitives, and they are the riskiest calls there are.
  const yul = [];
  for (let a, A = /\bassembly\b[^{]*\{/g; (a = A.exec(body)) !== null;) {
    const o = a.index + a[0].length - 1;
    yul.push([o, matchPair(body, o)]);
  }
  const inYul = (i) => yul.some(([o, c]) => i > o && i < c);

  const typeOf = (expr) => {
    const e = unwrap(expr);
    if (!e) return null;
    if (e === "this") return { self: true };
    if (e === "super") return { super: true };
    if (e === "msg.sender" || e === "tx.origin" || e === "block.coinbase") return { t: "address" };
    // `(a + b).toInt256()`: arithmetic on values yields a value of the first operand's type.
    const op = topLevelOperator(e);
    if (op > 0) return typeOf(e.slice(0, op));
    const call = /^([A-Za-z_][\w.]*)\s*\(/.exec(e);
    if (call && matchPair(e, call[0].length - 1, "(", ")") === e.length - 1) {
      const name = call[1];
      if (name === "address" || name === "payable") return { t: "address" };
      if (ELEMENTARY.test(name)) return { t: name };
      if (/^[A-Z]/.test(name.split(".").pop())) return { t: name };
      const dot = name.lastIndexOf(".");
      if (dot > 0) {
        // `oracle.getPrice(x)`: the return type of getPrice on whatever oracle is.
        const recv = typeOf(name.slice(0, dot));
        const method = name.slice(dot + 1);
        const fns = recv?.self ? R.lookup(chain, method)
          : recv?.t ? (R.pick(recv.t, d.file)?.functions ?? []).filter((x) => x.name === method) : [];
        const f = fns.find((x) => x.returns.length);
        return f ? { t: f.returns[0].type } : null;
      }
      const f = R.lookup(lookChain, name).find((x) => x.returns.length);
      return f ? { t: f.returns[0].type } : null;
    }
    if (e.endsWith("]")) {
      const o = matchBack(e, e.length - 1, "[", "]");
      const base = o > 0 ? typeOf(e.slice(0, o)) : null;
      const el = base?.t ? R.elementType(base.t) : null;
      return el ? { t: el } : null;
    }
    if (/^[A-Za-z_]\w*$/.test(e)) return env.has(e) ? { t: env.get(e) } : null;
    const dot = e.lastIndexOf(".");
    if (dot > 0 && !/[)\]]/.test(e.slice(dot))) {
      const left = typeOf(e.slice(0, dot));
      const fields = left?.t ? R.structFields(left.t, chain) : null;
      const right = e.slice(dot + 1).trim();
      if (fields?.has(right)) return { t: fields.get(right) };
    }
    return null;
  };

  // Overloads share a name. Folding every overload into a call over-states what it reaches — a call
  // to `_giveAllowances(asset)` was credited with the approvals of `_giveAllowances()` too. Match on
  // argument count; only when that cannot decide are all candidates kept.
  const byArity = (impls, parenAt) => {
    if (impls.length < 2) return impls;
    const close = matchPair(body, parenAt, "(", ")");
    if (close < 0) return impls;
    const argc = splitTop(body.slice(parenAt + 1, close), ",").length;
    const hit = impls.filter((f) => f.params.filter((x) => x.type).length === argc);
    return hit.length ? hit : impls;
  };

  const sites = [];
  const rawAt = (i) => {
    const ln = lineAt(starts, open + i);
    return { line: ln, raw: src.slice(starts[ln - 1], (starts[ln] ?? src.length + 1) - 1).trim().slice(0, 240) };
  };
  const add = (i, site) => sites.push({ ...site, ...rawAt(i) });
  const unitName = (t) => String(t).replace(/\s+payable$/, "").trim().split(".").pop();
  /** The call's arguments, split at top-level commas, for binding and for reading a Yul receiver. */
  const argsAt = (parenAt) => {
    const close = matchPair(body, parenAt, "(", ")");
    return close > 0 ? splitTop(body.slice(parenAt + 1, close), ",").map((s) => s.trim()) : [];
  };

  const CALL = /([A-Za-z_]\w*)\s*(\{[^{}]*\}\s*)?\(/g;
  for (let m; (m = CALL.exec(body)) !== null;) {
    const name = m[1];
    const at = m.index;
    const parenAt = at + m[0].length - 1;
    let p = at - 1;
    while (p >= 0 && /\s/.test(body[p])) p--;
    const prevWord = (() => { let q = p; while (q >= 0 && /\w/.test(body[q])) q--; return body.slice(q + 1, p + 1); })();

    if (inYul(at)) {
      if (YUL_CALLS.has(name)) {
        // `call(gas(), WHO, ...)`: the second argument is the receiver. A small literal is a precompile
        // (hashing, ecrecover); a name with a contract type is a call this code CAN name.
        const who = argsAt(parenAt)[1] ?? "";
        const t = /^[A-Za-z_]\w*$/.test(who) && env.has(who) ? env.get(who) : null;
        if (/^(0x0*[1-9a-f]|[1-9]|1[0-9])$/i.test(who)) add(at, { cls: "skip", why: "precompile", name });
        else if (t && R.classify(t, chain) === "contract") add(at, { cls: "edge", kind: EDGE.CALL, target: unitName(t), meta: { lowLevel: name, assembly: true, receiver: who } });
        else add(at, { cls: "hole", kind: EDGE.CALL, meta: { lowLevel: name, assembly: true, ...(who ? { receiver: who } : {}) } });
      }
      else if (name === "create" || name === "create2") add(at, { cls: "hole", kind: EDGE.CREATE, meta: { assembly: true } });
      else if (name === "selfdestruct") add(at, { cls: "hole", kind: EDGE.DESTROY, meta: { assembly: true } });
      else add(at, { cls: "skip", why: "yul builtin", name });
      continue;
    }
    if (prevWord === "emit" || prevWord === "revert") { add(at, { cls: "skip", why: prevWord, name }); continue; }
    if (prevWord === "new") {
      add(at, { cls: "edge", kind: EDGE.CREATE, target: unitName(name), meta: {} });
      continue;
    }
    if (p >= 0 && body[p] === ".") {
      const recv = readReceiver(body, p - 1);
      classifyMember(at, name, recv, m[2] ?? "", m.index + m[0].length - 1);
      continue;
    }
    // A bare name(...)
    if (name === "selfdestruct" || name === "suicide") { add(at, { cls: "hole", kind: EDGE.DESTROY, meta: {} }); continue; }
    if (NOT_A_CALL.has(name) || ELEMENTARY.test(name)) { add(at, { cls: "skip", why: "builtin", name }); continue; }
    if (/^[A-Z]/.test(name)) { add(at, { cls: "skip", why: "cast or struct", name }); continue; }
    const impls = byArity(R.lookup(lookChain, name), parenAt);
    if (impls.length) { add(at, { cls: "internal", name, impls, args: argsAt(parenAt) }); continue; }
    if (env.has(name)) {
      // A function-typed parameter. The caller decides what it is: bound at the call site when the
      // argument names a function in this code; a `pure` one can touch nothing either way.
      const bound = binds.get(name);
      if (bound?.length) { add(at, { cls: "internal", name, impls: bound, args: argsAt(parenAt) }); continue; }
      if (/^function\b/.test(env.get(name)) && /\bpure\b/.test(env.get(name))) { add(at, { cls: "skip", why: "pure function pointer", name }); continue; }
      add(at, { cls: "hole", kind: EDGE.CALL, meta: { receiver: name, pointer: true } });
      continue;
    }
    add(at, { cls: "skip", why: "internal, not found in this code", name, unresolvedInternal: true });
  }

  function classifyMember(at, method, recv, opts, parenAt) {
    const r = unwrap(recv);
    if (/^[A-Z]/.test(method)) { add(at, { cls: "skip", why: "struct or type member", name: method }); return; }
    if (/^(abi|bytes|string|block|tx|msg)$/.test(r) || r.startsWith("type(") || r.startsWith("type (")) {
      add(at, { cls: "skip", why: "builtin", name: method });
      return;
    }
    if (LOW_LEVEL.has(method)) {
      add(at, { cls: "hole", kind: EDGE.CALL, meta: { lowLevel: method, value: /\bvalue\s*:/.test(opts), receiver: r } });
      return;
    }
    // `Name.method(` on a bare type name: a library call, or an explicit call into a base contract.
    /**
     * A library function is inlined into its caller, so what it does is what the caller does: its
     * body is followed like a helper's. A pure or view one touches nothing. When the library isn't
     * on disk, the call is an edge to it — a name, never a guess at what it did.
     */
    const viaLibrary = (lib, receiverHole) => {
      const fns = R.libFunctions(lib, method, d.file);
      if (R.pureOnly(fns)) { add(at, { cls: "skip", why: "pure library function", name: method }); return; }
      if (fns.length) { add(at, { cls: "internal", name: method, impls: byArity(fns, parenAt), lib, args: argsAt(parenAt) }); return; }
      if (receiverHole) add(at, { cls: "hole", kind: EDGE.CALL, meta: { lowLevel: method, library: lib, receiver: receiverHole } });
      else add(at, { cls: "edge", kind: EDGE.CALL, target: unitName(lib), meta: { library: lib, method } });
    };
    if (/^[A-Z]\w*(\.[A-Z]\w*)*$/.test(r) && !env.has(r)) {
      const decl = R.pick(r, d.file);
      if (decl?.kind === "library") {
        // `SafeERC20.safeTransfer(IERC20(token), …)` acts ON the token: when the first argument has a
        // contract type, that is what is called. Otherwise the library's body says what happens.
        const first = argsAt(parenAt)[0];
        const ft = first ? typeOf(first) : null;
        if (R.classify(ft?.t, chain) === "contract" && !R.pureOnly(R.libFunctions(r, method, d.file))) {
          add(at, { cls: "edge", kind: EDGE.CALL, target: unitName(ft.t), meta: { library: r, method } });
          return;
        }
        viaLibrary(r, null);
        return;
      }
      if (decl && chain.includes(decl)) { add(at, { cls: "internal", name: method, impls: byArity(R.lookup(R.chainOf(decl), method), parenAt), args: argsAt(parenAt) }); return; }
      if (!decl) { add(at, { cls: "edge", kind: EDGE.CALL, target: unitName(r), meta: { method } }); return; }
      add(at, { cls: "skip", why: "type member", name: method });
      return;
    }
    const t = typeOf(r);
    if (t?.self) { add(at, { cls: "edge", kind: EDGE.CALL, target: ctx.name, meta: { method, selfCall: true } }); return; }
    if (t?.super) { add(at, { cls: "internal", name: method, impls: byArity(R.lookup(chain, method, { skipFirst: true }), parenAt), args: argsAt(parenAt) }); return; }
    const kind = R.classify(t?.t, chain);
    const lib = t?.t ? R.usingFor(usingChain, t.t) : null;
    if (kind === "address") {
      if (method === "transfer" || method === "send") add(at, { cls: "hole", kind: EDGE.CALL, meta: { eth: true, receiver: r } });
      else if (lib) viaLibrary(lib, r);
      else add(at, { cls: "hole", kind: EDGE.CALL, meta: { lowLevel: method, library: null, receiver: r } });
      return;
    }
    if (kind === "contract") {
      add(at, { cls: "edge", kind: EDGE.CALL, target: unitName(t.t), meta: { method, library: lib && R.libFunctions(lib, method, d.file).length ? lib : (lib && !R.pick(lib, d.file) ? lib : null) } });
      return;
    }
    if (kind === "collection" && (method === "push" || method === "pop")) { add(at, { cls: "skip", why: "array builtin", name: method }); return; }
    if ((kind === "value" || kind === "collection") && (method === "concat" || lib)) {
      add(at, { cls: "skip", why: "library computation on a value", name: method });
      return;
    }
    if (kind === "struct" && lib) { viaLibrary(lib, null); return; }
    add(at, { cls: "hole", kind: EDGE.CALL, meta: { receiver: r, method } });
  }

  return sites;
}

// ── authority ────────────────────────────────────────────────────────────────────────────────────

const isSender = (x) => /^(msg\.sender|_msgSender\s*\(\s*\)|tx\.origin)$/.test(unwrap(x));
const principal = (x) => unwrap(x).replace(/^address\s*\(([\s\S]*)\)$/, "$1").trim().replace(/\(\s*\)$/, "");

/** `require(COND)`: the principal(s) COND lets through, or null if it is not purely an access check. */
function allowedBy(cond) {
  const alts = splitTop(unwrap(cond), "||");
  const names = alts.map(allowedTerm);
  return names.every(Boolean) ? [...new Set(names)].join(" or ") : null;
}
function allowedTerm(term) {
  const t = unwrap(term);
  const conj = splitTop(t, "&&");
  if (conj.length > 1) {
    const hits = conj.map(allowedTerm).filter(Boolean);
    return hits.length ? hits.join(" and ") : null;
  }
  let m;
  if ((m = /^([\s\S]+?)\s*==\s*([\s\S]+)$/.exec(t))) {
    if (isSender(m[1])) return principal(m[2]);
    if (isSender(m[2])) return principal(m[1]);
  }
  if ((m = /^hasRole\s*\(([\s\S]*)\)$/.exec(t))) {
    const args = splitTop(m[1], ",");
    if (args.length === 2 && isSender(args[1])) return args[0];
  }
  if ((m = /^([A-Za-z_][\w.]*)\s*\[([\s\S]+)\]$/.exec(t)) && isSender(m[2])) return `${m[1]}[msg.sender]`;
  return null;
}
/** `if (COND) revert`: COND is the FAILURE condition. */
function failureBy(cond) {
  const c = unwrap(cond);
  const conj = splitTop(c, "&&");
  if (conj.length > 1) {
    const names = conj.map(failTerm);
    return names.every(Boolean) ? [...new Set(names)].join(" or ") : null;
  }
  const disj = splitTop(c, "||");
  if (disj.length > 1) {
    const hits = disj.map(failTerm).filter(Boolean);
    return hits.length ? hits.join(" and ") : null;
  }
  return failTerm(c);
}
function failTerm(term) {
  const t = unwrap(term);
  let m;
  if ((m = /^([\s\S]+?)\s*!=\s*([\s\S]+)$/.exec(t))) {
    if (isSender(m[1])) return principal(m[2]);
    if (isSender(m[2])) return principal(m[1]);
  }
  if ((m = /^!\s*([\s\S]+)$/.exec(t))) return allowedTerm(m[1]);
  return null;
}

/**
 * The access checks a body makes on EVERY path, with where each one lives. Top-level only; a check
 * nested in any block might be skipped. Helpers called at top level are followed, up to a depth.
 */
function checksOf(decl, open, close, R, ctxChain = null, seen = new Set(), depth = 0) {
  const out = [];
  if (open == null || depth > 5) return out;
  const { mk, src, starts } = decl;
  const chain = ctxChain ?? R.chainOf(decl);
  let level = 0;
  const lineText = (idx) => {
    const ln = lineAt(starts, idx);
    return src.slice(starts[ln - 1], (starts[ln] ?? src.length + 1) - 1).trim();
  };
  for (let i = open + 1; i < close; i++) {
    const ch = mk[i];
    if (ch === "{") { level++; continue; }
    if (ch === "}") { level--; continue; }
    if (level !== 0 || !/[A-Za-z_]/.test(ch) || /[\w.]/.test(mk[i - 1] ?? "")) continue;
    const word = /^[A-Za-z_]\w*/.exec(mk.slice(i, i + 64))?.[0];
    if (!word) continue;
    let j = i + word.length;
    while (/\s/.test(mk[j] ?? "")) j++;
    // `emit statusChanged(...)` and `revert notAllowed(...)` name an event and an error, not helpers.
    if (word === "emit" || word === "revert") {
      const next = /^[A-Za-z_][\w.]*/.exec(mk.slice(j, j + 96))?.[0];
      if (next && word === "revert" && mk[j] !== "(") { i = j + next.length - 1; continue; }
      if (next && word === "emit") { i = j + next.length - 1; continue; }
    }
    if (mk[j] !== "(") { i += word.length - 1; continue; }
    if (ELEMENTARY.test(word)) { i = matchPair(mk, j, "(", ")"); if (i < 0) break; continue; }
    const pc = matchPair(mk, j, "(", ")");
    if (pc < 0) break;
    const inside = mk.slice(j + 1, pc);
    let prev = i - 1;
    while (prev > open && /\s/.test(mk[prev])) prev--;
    const afterElse = /else$/.test(mk.slice(Math.max(open, prev - 4), prev + 1));
    if (word === "require" || word === "assert") {
      const who = allowedBy(splitTop(inside, ",")[0] ?? "");
      if (who) out.push({ who, where: lineText(i) });
    } else if (word === "if" && !afterElse) {
      let k = pc + 1;
      while (/\s/.test(mk[k] ?? "")) k++;
      const reverts = /^revert\b/.test(mk.slice(k, k + 8))
        || (mk[k] === "{" && /^\{\s*revert\b/.test(mk.slice(k, k + 40)));
      if (reverts) {
        const who = failureBy(inside);
        if (who) out.push({ who, where: lineText(i) });
      }
    } else if (!NOT_A_CALL.has(word) && !/^[A-Z]/.test(word)) {
      // A top-level call to a helper: its own unconditional checks are this function's too.
      const impls = R.lookup(chain, word);
      if (!impls.length && depth === 0) (out.unread ??= []).push(`${word}()`);
      const key = impls.map((f) => `${f.decl.rel}:${f.line}`).join(",");
      if (impls.length && !seen.has(key)) {
        seen.add(key);
        // A helper guards by its body OR by its own modifiers — `_authorizeUpgrade() internal
        // override onlyOwner {}` has an empty body and is the whole of an upgrade's access control.
        const per = impls.map((f) => [
          ...checksOf(f.decl, f.bodyOpen, f.bodyClose, R, chain, seen, depth + 1),
          ...f.modifiers.filter((w) => !/^[A-Z]/.test(w)).flatMap((w) => {
            const bodies = modifierBodies(w, chain, R.index);
            const cs = bodies.map((mo) => checksOf(mo.decl, mo.bodyOpen, mo.bodyClose, R, chain, seen, depth + 1));
            return bodies.length && cs.every((c) => c.length) ? cs[0].map((c) => ({ who: c.who, where: `${w} → ${c.where}` })) : [];
          }),
        ]);
        // Every overload must check, or the helper is not a guarantee.
        if (per.every((c) => c.length)) for (const c of per[0]) out.push({ who: c.who, where: `${word}() → ${c.where}` });
      }
    }
    i = pc;
  }
  return out;
}

function modifierBodies(name, chain, index) {
  for (const c of chain) {
    const hit = c.modifiers.filter((mo) => mo.name === name);
    if (hit.length) return hit;
  }
  const all = [];
  for (const decls of index.values()) for (const c of decls) for (const mo of c.modifiers) if (mo.name === name) all.push(mo);
  return all;
}

// ── assembly ─────────────────────────────────────────────────────────────────────────────────────

export function parse(root, opts = {}) {
  const files = findSources(root, opts);
  const base = fs.statSync(root).isFile() ? path.dirname(root) : root;
  const reportedFiles = new Set(files);

  // Everything is READ, lib/ included, whether or not it is REPORTED: `onlyOwner` and the helpers
  // behind it live in vendored OpenZeppelin, and whether a modifier checks the caller is a fact
  // about its body.
  const { readable, missing, imports } = importClosure(files, root);
  const index = new Map();
  const reported = [];
  for (const f of readable) {
    let decls;
    try { decls = parseFile(f, base, reportedFiles.has(f)); } catch { continue; }
    for (const d of decls) {
      if (!index.has(d.name)) index.set(d.name, []);
      index.get(d.name).push(d);
      if (d.reported) reported.push(d);
    }
  }
  const reportedNames = new Set(reported.map((d) => d.name));
  const R = makeResolver(index, reportedNames, imports);

  const trace = { sites: 0, edges: 0, holes: 0, internal: 0, skipped: 0, unresolvedInternal: new Set() };
  const siteCache = new Map();
  const NO_BINDS = new Map();
  const sitesOf = (fn, ctx, binds = NO_BINDS) => {
    const bound = [...binds].map(([k, v]) => `${k}=${v.map((f) => `${f.decl.rel}:${f.line}`).join("|")}`).join(",");
    const key = `${fn.decl.rel}:${fn.line}@${ctx.rel}:${ctx.name}#${bound}`;
    if (!siteCache.has(key)) siteCache.set(key, fn.bodyOpen == null ? [] : scanBody(fn, R, ctx, binds));
    return siteCache.get(key);
  };

  /** What a call site passes for each function-typed parameter, when it names a function here. */
  const bindingsFor = (site, impl, caller, ctx) => {
    const binds = new Map();
    const scope = caller.decl.kind === "library" ? [caller.decl] : R.chainOf(ctx);
    impl.params.forEach((p, i) => {
      const a = site.args?.[i];
      if (!p.name || !/^function\b/.test(p.type) || !a || !/^[A-Za-z_]\w*$/.test(a)) return;
      const fns = R.lookup(scope, a);
      if (fns.length) binds.set(p.name, fns);
    });
    return binds;
  };
  const toEdge = (s, through = null) => edge({
    kind: s.kind, target: s.cls === "edge" ? s.target : null, raw: s.raw, through,
    external: s.cls === "edge" ? !reportedNames.has(s.target) : false,
    self: Boolean(s.meta?.selfCall), meta: s.meta ?? {},
  });

  /**
   * An entry's own edges plus those of every helper it reaches, tagged with the first helper on the
   * path. Helpers in this code are always followed. Vendored helpers are followed only for an entry
   * that is itself vendored (an inherited `deposit()`), and only a few levels deep — enough to show
   * the token pull inside OpenZeppelin's deposit, not enough to trace all of OpenZeppelin.
   */
  const edgesOf = (fn, ctx, { vendored = false, seen = new Set(), through = null, depth = 0, binds = NO_BINDS } = {}) => {
    const out = [];
    for (const site of sitesOf(fn, ctx, binds)) {
      if (site.cls === "edge" || site.cls === "hole") out.push(toEdge(site, through));
      else if (site.cls === "internal") {
        for (const impl of site.impls ?? []) {
          // A library body is where the call it makes lives, so it is always read (bounded, in case
          // libraries call libraries); other vendored helpers only for vendored entries.
          const inLibrary = site.lib || impl.decl.kind === "library";
          if (inLibrary ? depth > 8 : !impl.decl.reported && !(vendored && depth < 3)) continue;
          const key = `${impl.decl.rel}:${impl.line}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(...edgesOf(impl, ctx, { vendored, seen, through: through ?? impl.name, depth: depth + 1, binds: bindingsFor(site, impl, fn, ctx) }));
        }
      }
    }
    return out;
  };

  const buildEntry = (fn, ctx, inheritedFrom = null) => {
    const chain = R.chainOf(ctx);
    const declaredOnly = fn.bodyOpen == null;
    const text = fn.decl;

    // Modifiers: a PascalCase name in the signature is a base-constructor call, not a modifier.
    const mods = fn.modifiers.filter((w) => !/^[A-Z]/.test(w) && !index.has(w));
    const access = [];
    const plain = [];
    for (const w of mods) {
      const bodies = modifierBodies(w, chain, index);
      const checks = bodies.map((mo) => checksOf(mo.decl, mo.bodyOpen, mo.bodyClose, R, chain));
      const checked = bodies.length ? checks.every((c) => c.length) : /^only[A-Z_]/.test(w);
      (checked ? access : plain).push(w);
    }
    const body = declaredOnly ? [] : checksOf(text, fn.bodyOpen, fn.bodyClose, R, chain);
    const authority = [...new Set([...access, ...body.map((c) => c.who)])];
    // Helpers and modifiers the function relies on whose code could not be read. An access check may
    // live there; the page says so instead of letting "no check found" read as "anyone".
    const unread = [...(body.unread ?? []), ...mods.filter((w) => !modifierBodies(w, chain, index).length && !access.includes(w)).map((w) => `modifier ${w}`)];

    const edges = declaredOnly ? [] : edgesOf(fn, ctx, { vendored: Boolean(inheritedFrom), seen: new Set([`${text.rel}:${fn.line}`]) });
    const unique = [];
    const keys = new Set();
    for (const e of edges) {
      const k = `${e.kind}|${e.target}|${e.raw}|${e.through ?? ""}`;
      if (!keys.has(k)) { keys.add(k); unique.push(e); }
    }
    if (!inheritedFrom) {
      for (const site of sitesOf(fn, ctx)) {
        trace.sites++;
        if (site.cls === "edge") trace.edges++;
        else if (site.cls === "hole") trace.holes++;
        else if (site.cls === "internal") trace.internal++;
        else trace.skipped++;
        if (site.unresolvedInternal) trace.unresolvedInternal.add(site.name);
      }
    }

    const textGuards = declaredOnly ? [] : text.src.slice(fn.bodyOpen + 1, fn.bodyClose).split("\n").map((l) => l.trim())
      .filter((l) => /^(require\s*\(|revert\b|assert\s*\(|if\s*\(.*\)\s*revert\b)/.test(l)).map((l) => l.slice(0, 200));
    const helperGuards = body.filter((c) => c.where.includes("→")).map((c) => c.where.slice(0, 200));

    const built = entry({
      name: fn.name, unit: ctx.name, module: text.rel.replace(/\.sol$/, ""), path: text.rel,
      line: fn.line, endLine: fn.endLine,
      authority,
      args: fn.params.filter((x) => x.name || x.type),
      guards: [...plain.map((w) => `modifier ${w}`), ...helperGuards, ...textGuards],
      edges: unique,
      effect: fn.mutability === "view" || fn.mutability === "pure" ? EFFECT.NONE
        : unique.some((e) => e.kind === EDGE.DESTROY && !e.through) ? EFFECT.TERMINAL
        : EFFECT.TRANSITION,
      returns: fn.returns.map((r) => r.type).join(", ") || null,
      source: declaredOnly ? null : text.raw.split("\n").slice(fn.line - 1, fn.endLine).join("\n"),
    });
    // Declared but not implemented here — an interface or abstract signature. Not code anyone can
    // run, so never offered as a way in.
    built.declared = declaredOnly;
    // A constructor runs once, when the contract is deployed, by whoever deploys it.
    built.deployOnly = fn.kind === "constructor";
    // Written in a vendored parent (OpenZeppelin's `deposit`), but part of THIS contract's surface.
    built.inherited = inheritedFrom;
    built.unread = unread;
    return built;
  };

  const arity = (fn) => `${fn.name}/${fn.params.filter((x) => x.type).length}`;
  const units = [];
  const modules = new Map();
  for (const d of reported) {
    const chain = R.chainOf(d);
    const entries = [];
    for (const fn of d.functions) {
      const isEntry = fn.visibility === "external" || fn.visibility === "public"
        || fn.kind === "constructor" || fn.kind === "receive" || fn.kind === "fallback";
      if (isEntry) entries.push(buildEntry(fn, d));
    }
    // A deployable contract's public surface includes what it inherits from vendored code — a vault
    // built on OpenZeppelin's ERC4626 is deposited into through OpenZeppelin's `deposit()`, which then
    // runs this repo's `_deposit` override. Without this, the vault's main user flows were absent.
    // In-repo parents keep their functions on their own cards; only vendored ones are brought in.
    if (d.kind === "contract" && !d.abstract) {
      const seenSig = new Set();
      for (const anc of chain) {
        for (const fn of anc.functions) {
          // A declaration without a body never claims the signature: the implementation, wherever
          // it is in the chain, is what a caller reaches.
          if (fn.bodyOpen == null) continue;
          const sig = arity(fn);
          if (seenSig.has(sig)) continue;
          seenSig.add(sig);
          if (anc === d || anc.reported || anc.kind === "interface") continue;
          if (fn.kind !== "function" || !(fn.visibility === "public" || fn.visibility === "external")) continue;
          entries.push(buildEntry(fn, d, anc.name));
        }
      }
    }
    const u = unit({
      name: d.name, module: d.rel.replace(/\.sol$/, ""), path: d.rel,
      line: d.line, endLine: d.endLine,
      signatories: [], observers: [], fields: [...d.fields].map(([name, type]) => ({ name, type })),
      invariants: [], keys: [], entries,
    });
    u.kind = d.kind;
    u.abstract = d.abstract;
    u.inherits = d.inherits;
    units.push(u);
    if (!modules.has(d.rel)) modules.set(d.rel, []);
    modules.get(d.rel).push(u);
  }

  const out = model({
    language: "solidity", root,
    modules: [...modules].map(([rel, us]) => ({
      module: rel.replace(/\.sol$/, ""), path: rel,
      units: us.map((u) => u.name), functions: us.reduce((n, u) => n + u.entries.length, 0),
    })),
    units, entries: units.flatMap((u) => u.entries),
    notes: [
      ...(files.length === 0 ? ["no .sol source found under this path (pass --include-libs to include vendored dependencies)"] : []),
      ...(missing.length ? [`${missing.length} imported file(s) are not on disk (e.g. ${missing[0]}). Whatever they define — inherited functions, modifiers, access checks — could not be read, so a function guarded there may be shown as open. Run \`forge install\` or \`git submodule update --init\` and re-run.`] : []),
    ],
  });
  out.trace = { ...trace, unresolvedInternal: [...trace.unresolvedInternal].sort(), missingImports: missing };
  return out;
}

/** Every classified call site, for auditing the adapter itself. Not part of the model. */
export function traceSites(root, opts = {}) {
  const files = findSources(root, opts);
  const base = fs.statSync(root).isFile() ? path.dirname(root) : root;
  const reportedFiles = new Set(files);
  const { readable, imports } = importClosure(files, root);
  const index = new Map();
  const reported = [];
  for (const f of readable) {
    for (const d of parseFile(f, base, reportedFiles.has(f))) {
      if (!index.has(d.name)) index.set(d.name, []);
      index.get(d.name).push(d);
      if (d.reported) reported.push(d);
    }
  }
  const R = makeResolver(index, new Set(reported.map((d) => d.name)), imports);
  const rows = [];
  for (const d of reported) {
    for (const fn of d.functions) {
      if (fn.bodyOpen == null) continue;
      for (const s of scanBody(fn, R, d)) {
        rows.push({ unit: d.name, fn: fn.name, fnLine: fn.line, visibility: fn.visibility, path: d.rel, line: s.line,
          cls: s.cls, kind: s.kind ?? null, target: s.target ?? null, name: s.name ?? null,
          why: s.why ?? null, meta: s.meta ?? null, raw: s.raw,
          body: d.mk.slice(fn.bodyOpen + 1, fn.bodyClose) });
      }
    }
  }
  return rows;
}

export default { parse, findSources, stripComments, language: "solidity" };
