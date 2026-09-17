// Daml adapter. Reads .daml source and emits the neutral model.
//
// COMMENTS ARE STRIPPED BEFORE ANYTHING IS PARSED. Not as a nicety — as the core assumption. In the
// codebase this began life against, comments repeatedly described behaviour the code did not have:
// a helper documented as "filed as <ticket>" for a finding that was never filed, an assert described
// as guarding a boundary it did not guard, a config pin claiming a version it did not pin. Each cost
// real time. A tool that reads comments inherits every one of those lies, so this one cannot see
// them. The raw text is kept for DISPLAY and never re-parsed.
//
// Resolution rules, each validated against real choices rather than invented:
//   create this with          -> the entry's own unit; with `consuming` that is a STATE TRANSITION
//   create Template with      -> Template
//   create var with           -> var's type, if bound earlier in this body
//   create (helper args)      -> the helper's declared return type
//   exercise cid Choice       -> Choice looked up by name; the cid's declared type as a cross-check
//   fetch cid / archive cid   -> the cid's declared type among args, unit fields, or earlier binds
//   fetch (fromInterfaceContractId @T cid) -> T
// Binders that feed the above: choice arguments, the unit's own fields, `x <- exercise … Choice`
// (via the choice's declared return, tuple-destructured), and `Some y ->` after `case x of`.
//
// Anything else is a HOLE. It is reported with its raw line and never guessed.

import fs from "node:fs";
import path from "node:path";
import { EDGE, EFFECT, edge, entry, unit, model } from "../model.mjs";

const SKIP_DIRS = new Set([".daml", "node_modules", ".git", "dist", "build", ".dpm"]);

/**
 * Test code is excluded by default, as it is for Solidity. A Daml test package defines templates of
 * its own — one real repo's had malicious factories, fake app rights and eight more doubles,
 * over a third of the repo's templates — and none of them is ever deployed. Drawn on the map they
 * are contracts that do not exist.
 *
 * A test package is a package like any other, so it is known by what it calls itself: a `daml.yaml`
 * whose `name` ends in `-test` or `-tests`. Directories named that way are skipped too, for trees
 * without per-package manifests. The directory you point at is never skipped — asking for a test
 * package by path is asking for it. `--include-tests` brings everything back.
 */
const TEST_DIR = /^tests?$|-tests?$/;
function isTestPackage(dir) {
  try {
    const yaml = fs.readFileSync(path.join(dir, "daml.yaml"), "utf8");
    return /-tests?$/.test(/^name:\s*["']?([\w.-]+)/m.exec(yaml)?.[1] ?? "");
  } catch { return false; }
}

/** Recurse for .daml files, skipping build output. `.daml/` is Daml's OWN build dir and is full of
 *  decompiled dependency stubs — parsing those reports a project's dependencies as its own code. */
export function findSources(root, { includeTests = false } = {}) {
  const out = [];
  const walk = (dir, top) => {
    if (!includeTests && !top && isTestPackage(dir)) return;
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) {
        if (SKIP_DIRS.has(it.name)) continue;
        if (!includeTests && TEST_DIR.test(it.name)) continue;
        walk(p, false);
      } else if (it.isFile() && it.name.endsWith(".daml")) out.push(p);
    }
  };
  const st = fs.statSync(root);
  if (st.isFile()) return root.endsWith(".daml") ? [root] : [];
  walk(root, true);
  return out.sort();
}

export function stripComments(src) {
  const out = src.replace(/\{-[\s\S]*?-\}/g, (m) => m.replace(/[^\n]/g, " "));
  return out.split("\n").map((l) => {
    let inStr = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"' && l[i - 1] !== "\\") inStr = !inStr;
      if (!inStr && ch === "-" && l[i + 1] === "-") return l.slice(0, i).replace(/\s+$/, "");
    }
    return l;
  }).join("\n");
}

const indentOf = (l) => (l.match(/^(\s*)/)?.[1].length ?? 0);
/**
 * The template behind a contract-id-shaped type, or null.
 *
 * Unwraps the three containers Daml actually uses around a ContractId in a field or argument:
 * `Optional (ContractId T)`, `[ContractId T]`, and combinations. Without the Optional case, a
 * `Some cid -> do … fetch cid` arm — the standard way to act on an optional contract — reports a
 * hole even though the type is right there in the declaration. That was 2 of 34 holes on one real codebase.
 *
 * Deliberately does NOT unwrap arbitrary nesting: if the shape is not recognised, the answer is
 * null and the edge becomes a hole. A wrong target is worse than an admitted gap.
 */
const cidType = (t) => {
  let s = String(t).trim();
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(/^Optional\s*\(\s*(.+?)\s*\)$/, "$1").replace(/^Optional\s+(\S+)$/, "$1");
    s = s.replace(/^\[\s*(.+?)\s*\]$/, "$1");
    s = s.replace(/^\(\s*(.+?)\s*\)$/, "$1");
    if (s === before) break;
  }
  const m = /^ContractId\s+([A-Za-z_][\w.]*)$/.exec(s);
  return m ? m[1].split(".").pop() : null;
};

function parseWithBlock(lines, start, minIndent) {
  const fields = [];
  let i = start;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    if (indentOf(l) <= minIndent) break;
    const m = /^\s*([a-z_][\w']*)\s*:\s*(.+?)\s*$/.exec(l);
    if (m) fields.push({ name: m[1], type: m[2] });
  }
  return { fields, next: i };
}

/** Split a Daml type at top-level commas: "(ContractId A, Optional (ContractId B))" -> [A, B]. */
function tupleComponents(returns) {
  let s = String(returns).trim();
  if (s.startsWith("(") && s.endsWith(")")) s = s.slice(1, -1);
  const parts = []; let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim().replace(/^Optional\s*\(?\s*/, "").replace(/\)?\s*$/, ""))
    .map((p) => cidType(p) ?? cidType(`ContractId ${p}`) ?? null);
}

function parseModule(file, root) {
  const raw = fs.readFileSync(file, "utf8");
  const src = stripComments(raw);
  const lines = src.split("\n");
  const rawLines = raw.split("\n");
  const rel = path.relative(root, file);
  const moduleName = /^module\s+([\w.]+)/m.exec(src)?.[1] ?? path.basename(file, ".daml");
  const templates = [];
  const functions = [];
  const defs = [];

  for (let i = 0; i < lines.length; i++) {
    // Both layouts are common: `template X` with `with` on the next line, and `template X with`.
    const tm = /^template\s+([A-Z]\w*)(\s+with)?\s*$/.exec(lines[i]);
    if (tm) {
      const t = { name: tm[1], module: moduleName, path: rel, line: i + 1,
                  fields: [], signatory: null, observer: null, ensure: null, key: null, choices: [] };
      let j = i + 1;
      if (tm[2]) {
        // The fields are whatever is indented deeper than the first one; `where` sits shallower.
        let f = j;
        while (f < lines.length && !lines[f].trim()) f++;
        const r = parseWithBlock(lines, j, Math.max(0, indentOf(lines[f] ?? "") - 1)); t.fields = r.fields; j = r.next;
      } else if (/^\s+with\s*$/.test(lines[j] ?? "")) {
        const r = parseWithBlock(lines, j + 1, indentOf(lines[j])); t.fields = r.fields; j = r.next;
      }
      let end = j;
      while (end < lines.length && !(lines[end].trim() && indentOf(lines[end]) === 0)) end++;
      t.endLine = end;
      const body = lines.slice(j, end);
      for (let k = 0; k < body.length; k++) {
        const l = body[k];
        let m;
        if ((m = /^\s+signatory\s+(.+)$/.exec(l))) t.signatory = m[1].trim();
        else if ((m = /^\s+observer\s+(.+)$/.exec(l))) t.observer = m[1].trim();
        else if ((m = /^\s+ensure\s+(.+)$/.exec(l))) t.ensure = m[1].trim();
        else if ((m = /^\s+key\s+(.+)$/.exec(l))) t.key = m[1].trim();
        else if ((m = /^(\s+)((?:non|pre|post)consuming\s+)?choice\s+([A-Z]\w*)\s*:\s*(.*)$/.exec(l))) {
          const ind = m[1].length;
          const c = { name: m[3], consuming: !/^nonconsuming/.test(m[2] ?? ""), returns: m[4].trim(),
                      args: [], controller: null, body: "", rawBody: "",
                      line: j + k + 1, endLine: null, bodyLine: null, guards: [] };
          let p = k + 1;
          // The return type can wrap onto following lines. Stop at `with` (either form) or
          // `controller`, and never consume a blank line — after comment stripping a blank is
          // where a comment used to be, and treating it as the end of the header loses whatever
          // follows it.
          while (p < body.length && body[p].trim()
                 && !/^\s+with\b/.test(body[p]) && !/^\s+controller\b/.test(body[p])
                 && indentOf(body[p]) > ind) { c.returns += " " + body[p].trim(); p++; }

          // Two `with` forms, and both appear in real code:
          //   with              <- a block; fields follow, indented
          //     a : T
          //   with a : T        <- inline, a single field on the same line
          // Matching only the block form left `c.args` empty AND, worse, left `p` pointing at the
          // inline line so the controller scan below missed — reporting a choice with a declared
          // controller as callable by ANYONE. Found when the EVM adapter introduced "unguarded"
          // and a Daml choice turned up in that list, which for Daml is impossible.
          if (/^\s+with\s*$/.test(body[p] ?? "")) {
            const r = parseWithBlock(body, p + 1, indentOf(body[p])); c.args = r.fields; p = r.next;
          } else if ((m = /^\s+with\s+([a-z_][\w']*)\s*:\s*(.+?)\s*$/.exec(body[p] ?? ""))) {
            c.args = [{ name: m[1], type: m[2] }];
            p++;
          }

          // Skip blanks left behind by stripped comments before looking for the controller.
          while (p < body.length && !body[p].trim()) p++;
          if ((m = /^\s+controller\s+(.+)$/.exec(body[p] ?? ""))) { c.controller = m[1].trim(); p++; }
          let q = p;
          while (q < body.length && !/^\s+do\s*$/.test(body[q]) && indentOf(body[q]) > ind) q++;
          if (/^\s+do\s*$/.test(body[q] ?? "")) {
            c.bodyLine = j + q + 2;
            let e = q + 1;
            while (e < body.length && (!body[e].trim() || indentOf(body[e]) > ind)) e++;
            c.body = body.slice(q + 1, e).join("\n");
            c.rawBody = rawLines.slice(j + q + 1, j + e).join("\n");
            c.endLine = j + e;
            c.guards = c.body.split("\n")
              .map((x) => /\b(assertMsg|assert|abort)\b\s*(.*)$/.exec(x.trim()))
              .filter(Boolean).map((x) => x[0].slice(0, 200));
            k = e - 1;
          }
          t.choices.push(c);
        }
      }
      templates.push(t);
      i = end - 1;
      continue;
    }
    const fm = /^([a-z_][\w']*)\s*:(.*)$/.exec(lines[i]);
    if (fm && !/^(import|module)\b/.test(lines[i])) {
      let sig = fm[2].trim(), j = i + 1;
      while (j < lines.length && lines[j].trim() && indentOf(lines[j]) > 0
             && !/^\s*(with|where|controller|do)\b/.test(lines[j])) {
        sig += " " + lines[j].trim(); j++;
        if (!/->\s*$|:\s*$/.test(sig) && !/^\s*[-=]/.test(lines[j] ?? "")) break;
      }
      if (sig) functions.push({ name: fm[1], signature: sig.trim() });
    }
    // The DEFINITION, not the signature: `name a b c = …`, body running to the next column-0 line.
    // Without this, every create/fetch/archive inside a top-level helper is invisible — and a choice
    // that does its archiving through one looked like a choice that archives nothing.
    // Split on the first `=` and validate the two halves separately. The obvious single regex —
    // `^(name)((?:\s+param)*)\s*=` — has nested quantifiers, and on any column-0 line WITHOUT an
    // `=` the engine explores every way to partition the line. That is not slow, it is
    // non-terminating in practice: it took Splice from under a second to never finishing.
    const eq = lines[i].indexOf("=");
    if (eq > 0 && !/^(import|module)\b/.test(lines[i]) && lines[i][eq + 1] !== "=") {
      const lhs = lines[i].slice(0, eq);
      // `==`, `/=`, `<=`, `>=`, `!=` are comparisons, not definitions.
      if (!/[=/<>!]$/.test(lhs)) {
        const nameM = /^([a-z_][\w']*)/.exec(lhs);
        const rest = nameM ? lhs.slice(nameM[1].length) : null;
        if (nameM && /^[\w'\s(){}@\[\],.]*$/.test(rest)) {
          let end = i + 1;
          while (end < lines.length && !(lines[end].trim() && indentOf(lines[end]) === 0)) end++;
          defs.push({
            name: nameM[1],
            params: rest.trim().split(/\s+/).filter(Boolean),
            body: [lines[i].slice(eq + 1), ...lines.slice(i + 1, end)].join("\n"),
            line: i + 1,
          });
        }
      }
    }
  }
  return { module: moduleName, path: rel, templates, functions, defs };
}

/**
 * Bind lambda parameters that iterate a list of contract ids.
 *
 *   mapA (\cid -> do h <- fetch cid …) reserveHoldingCids
 *   forA holdingCids (\cid -> …)
 *
 * `cid` is an element of the list, so its type is the list's element type. This has to be a pre-pass
 * over the whole body rather than part of the line scan, because in the `mapA` form the list appears
 * AFTER the lambda body — a line-by-line reader meets `fetch cid` several lines before it learns
 * what `cid` is.
 *
 * Matched by balance-counting the lambda's parentheses, not by regex: the body can contain nested
 * parens and `->`, and a regex that appears to work on the samples to hand is exactly how a tool
 * starts inventing targets. If the form is not matched exactly, nothing is bound and the edge stays
 * a hole.
 */
function lambdaBinders(body, typeOf) {
  const bound = new Map();
  const ITER = /\b(mapA_?|forA_?|mapM_?|forM_?)\s*/g;
  let m;
  while ((m = ITER.exec(body)) !== null) {
    let i = ITER.lastIndex;
    const isFor = m[1].startsWith("for");
    let listVar = null, param = null;

    const readIdent = () => {
      const r = /^[a-z_][\w']*/.exec(body.slice(i));
      if (!r) return null;
      i += r[0].length;
      return r[0];
    };
    const skipWs = () => { while (i < body.length && /\s/.test(body[i])) i++; };

    skipWs();
    if (isFor) {
      listVar = readIdent();
      skipWs();
    }
    // Expect `(\param ->`
    if (body[i] !== "(") continue;
    const open = i;
    i++; skipWs();
    if (body[i] !== "\\") continue;
    i++;
    param = readIdent();
    if (!param) continue;
    if (!isFor) {
      // Balance to the lambda's closing paren, then the next identifier is the list.
      let depth = 1, j = open + 1;
      while (j < body.length && depth > 0) {
        if (body[j] === "(") depth++;
        else if (body[j] === ")") depth--;
        j++;
      }
      if (depth !== 0) continue;
      const rest = body.slice(j);
      const r = /^\s*([a-z_][\w']*)/.exec(rest);
      if (!r) continue;
      listVar = r[1];
    }
    if (!listVar || !param) continue;
    const t = typeOf.get(listVar);
    if (t) bound.set(param, t);   // cidType already strips [ ], so this is the ELEMENT type
  }
  return bound;
}

function resolveEdges(choice, owningTemplate, ctx) {
  const { choiceIndex, templateNames, returnsOf, helperReturns } = ctx;
  // Choice args shadow the unit's own fields, both are in scope in a choice body.
  const typeOf = new Map([
    ...(owningTemplate.fields ?? []).map((f) => [f.name, cidType(f.type)]),
    ...choice.args.map((a) => [a.name, cidType(a.type)]),
  ]);
  // Pre-pass: lambda parameters iterating a list of cids. Must run before the line scan, because in
  // `mapA (\x -> …) xs` the list is named after the body that uses x.
  const bound = lambdaBinders(choice.body, typeOf);
  // RULE 1: an exercise-result binding can WRAP onto the next line.
  //   (a, b, c, escrowRemainder) <-
  //     exercise cid SomeChoice with ...
  // The line-by-line scan below sees `<-` and `exercise` on separate lines and binds nothing, so
  // every later use of those variables cascades into a hole. Running the same match over the WHOLE
  // body fixes it, because `\s*` spans newlines — that, and not any joining, is the mechanism.
  // Worth 2 holes on a real protocol; proved by removing this block and watching 97% fall to 96%.
  {
    // The binder is matched as EITHER a parenthesised list OR a bare identifier, never as one
    // optional-paren form. The earlier version was
    //     /\(?\s*([\w',\s]+?)\s*\)?\s*<-\s*.../
    // where `\s` sits inside the character class AND in the `\s*` on both sides of it. Every
    // whitespace run can therefore be divided between the class and the quantifiers in
    // exponentially many ways, and on a body that is mostly blank lines with no `<-` to
    // terminate on, the engine never comes back. It parsed every corpus to hand and then hung
    // outright on Canton's Bong.daml — a choice whose body is `return ()` followed by 800
    // characters of whitespace left behind by a stripped block comment.
    //
    // Both alternatives below are unambiguous: `[^()\n]*` cannot match the `)` that follows it,
    // and `[\w']*` cannot match the whitespace or `<` that follows it. No overlap, no backtracking.
    const RE = /(?:\(([^()\n]*)\)|([A-Za-z_][\w']*))\s*<-\s*exercise\s+[\w'.]+\s+((?:[A-Z]\w*\.)*[A-Z]\w*)\b/g;
    let m;
    while ((m = RE.exec(choice.body)) !== null) {
      const vars = (m[1] ?? m[2] ?? "").split(",").map((v) => v.trim()).filter((v) => v && v !== "_");
      const comps = returnsOf.get(m[3].split(".").pop());
      if (comps) vars.forEach((v, i) => { if (comps[i]) bound.set(v, comps[i]); });
    }
  }
  const edges = [];
  let caseVar = null;
  let caseTuple = null;

  for (const line of choice.body.split("\n")) {
    let m;
    if ((m = /\bcase\s+([a-z_][\w'.]*)\s+of\b/.exec(line))) {
      caseVar = m[1].split(".")[0];
      caseTuple = null;
      const r = /^\s*([a-z_][\w']*)\s*<-\s*case\b/.exec(line);
      if (r) { const t = typeOf.get(caseVar) ?? bound.get(caseVar); if (t) bound.set(r[1], t); }
    }
    // RULE 2: a LITERAL TUPLE scrutinee — `case (upfrontFee > 0, feeMintDelegationCid) of`.
    // The components are ordinary expressions, so the second one's type is knowable even though
    // the tuple as a whole has no name. A positional pattern arm then types its binders.
    if ((m = /\bcase\s*\(([^)]*)\)\s+of\b/.exec(line))) {
      caseVar = null;
      caseTuple = m[1].split(",").map((x) => {
        const id = /^[\s(]*([a-z_][\w']*)[\s)]*$/.exec(x);
        return id ? (typeOf.get(id[1]) ?? bound.get(id[1]) ?? null) : null;
      });
    }
    if (caseTuple && (m = /^\s*\(([^)]*)\)\s*->/.exec(line))) {
      m[1].split(",").map((x) => x.trim()).forEach((pat, i) => {
        // `Some x` or a bare `x`; anything else (a literal, a constructor we do not model) is skipped.
        const v = /^(?:Some\s+)?([a-z_][\w']*)$/.exec(pat);
        if (v && caseTuple[i]) bound.set(v[1], caseTuple[i]);
      });
    }
    // RULE 3: list and cons patterns over a list-typed scrutinee. `cidType` already strips `[ ]`,
    // so the scrutinee's recorded type IS the element type.
    if (caseVar && (m = /^\s*(?:\[\s*([a-z_][\w']*)\s*\]|\(\s*([a-z_][\w']*)\s*::[^)]*\))\s*->/.exec(line))) {
      const t = typeOf.get(caseVar) ?? bound.get(caseVar);
      const v = m[1] ?? m[2];
      if (t && v) bound.set(v, t);
    }
    if (caseVar && (m = /\bSome\s+([a-z_][\w']*)\s*->/.exec(line))) {
      const t = typeOf.get(caseVar) ?? bound.get(caseVar); if (t) bound.set(m[1], t);
    }
    // A choice can be MODULE-QUALIFIED: `exercise cid AR.AccrueInterest`. Capturing only the first
    // capitalised token takes the alias `AR` as the choice name, the return lookup misses, the
    // result variable never binds — and every later fetch or exercise on it cascades into a hole.
    // That single omission accounted for most of one real codebase's remaining unresolved edges.
    if ((m = /^\s*\(?\s*([\w',\s]+?)\s*\)?\s*<-\s*exercise\s+[\w'.]+\s+((?:[A-Z]\w*\.)*[A-Z]\w*)\b/.exec(line))) {
      const vars = m[1].split(",").map((v) => v.trim()).filter((v) => v && v !== "_");
      const comps = returnsOf.get(m[2].split(".").pop());
      if (comps) vars.forEach((v, i) => { if (comps[i]) bound.set(v, comps[i]); });
    }

    const look = (v) => typeOf.get(v) ?? bound.get(v) ?? null;

    if ((m = /\b([a-z_][\w']*)\s*<-\s*fetch\s+\(fromInterfaceContractId\s+@([\w.]+)\s+[\w']+\)/.exec(line))) {
      const t = m[2].split(".").pop(); bound.set(m[1], t);
      edges.push(edge({ kind: EDGE.READ, target: t, raw: line })); continue;
    }
    if ((m = /\b([a-z_][\w']*)\s*<-\s*fetch\s+([a-z_][\w']*)/.exec(line))) {
      const t = look(m[2]); if (t) bound.set(m[1], t);
      edges.push(edge({ kind: EDGE.READ, target: t, raw: line, via: m[2] })); continue;
    }
    if ((m = /\bfetch\s+([a-z_][\w']*)/.exec(line))) {
      edges.push(edge({ kind: EDGE.READ, target: look(m[1]), raw: line, via: m[1] })); continue;
    }
    if ((m = /\barchive\s+\(fromInterfaceContractId\s+@([\w.]+)/.exec(line))) {
      edges.push(edge({ kind: EDGE.DESTROY, target: m[1].split(".").pop(), raw: line })); continue;
    }
    if ((m = /\barchive\s+([a-z_][\w'.]*)/.exec(line))) {
      const v = m[1].split(".")[0];
      edges.push(edge({ kind: EDGE.DESTROY, target: look(v), raw: line, via: m[1] })); continue;
    }
    if ((m = /\bexercise\s+([a-z_][\w'.()@ ]*?)\s+((?:[A-Z]\w*\.)*[A-Z]\w*)\b/.exec(line))) {
      const cidExpr = m[1].trim();
      const ch = m[2].split(".").pop();   // strip the module alias; the choice is the last segment
      const byName = choiceIndex.get(ch);
      const viaVar = look(cidExpr.split(".")[0]);
      const target = byName?.length === 1 ? byName[0] : viaVar;
      edges.push(edge({ kind: EDGE.CALL, target, raw: line, via: cidExpr,
        external: !target || !templateNames.has(target), meta: { choice: ch } }));
      continue;
    }
    if (/\bcreate\s+this\b/.test(line)) {
      edges.push(edge({ kind: EDGE.CREATE, target: owningTemplate.name, raw: line, self: true })); continue;
    }
    if ((m = /\bcreate\s+([A-Z]\w*)\b/.exec(line))) {
      edges.push(edge({ kind: EDGE.CREATE, target: m[1], raw: line,
        external: !templateNames.has(m[1]) })); continue;
    }
    if ((m = /\bcreate\s+([a-z_][\w']*)\s+with\b/.exec(line))) {
      edges.push(edge({ kind: EDGE.CREATE, target: bound.get(m[1]) ?? null, raw: line, via: m[1] })); continue;
    }
    if ((m = /\bcreate\s+\(([a-z_][\w']*)/.exec(line))) {
      const t = helperReturns.get(m[1]) ?? null;
      edges.push(edge({ kind: EDGE.CREATE, target: t, raw: line,
        external: !!t && !templateNames.has(t), meta: { helper: m[1] } })); continue;
    }
  }
  return edges;
}

/**
 * Split a type signature on its TOP-LEVEL arrows, so `(a -> b) -> C` is two parameters and not
 * three. Done by depth-counting rather than `split("->")`, because the naive split silently
 * mis-assigns every parameter after a higher-order one and the damage is invisible.
 */
function arrowParts(sig) {
  const out = [];
  let depth = 0, buf = "";
  for (let i = 0; i < sig.length; i++) {
    const c = sig[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    if (depth === 0 && c === "-" && sig[i + 1] === ">") { out.push(buf.trim()); buf = ""; i++; continue; }
    buf += c;
  }
  out.push(buf.trim());
  return out;
}

/**
 * Edges reached THROUGH a top-level helper function.
 *
 * Daml choices routinely delegate their ledger work to plain functions:
 *
 *   archiveMirror mirrorCid = archive mirrorCid
 *   … and eight choices call it
 *
 * Reading only choice bodies, those eight choices archive nothing — and the report said so, in
 * as many words, on a lifecycle card: "nothing ends it". That is the tool asserting a fact about
 * the protocol that the protocol does not have, which is worse than any hole. (The EVM adapter has
 * folded internal calls in from the start; the Daml side simply never did.)
 *
 * Folded edges keep `via` set to the helper that owns them, so the report can say where an edge
 * really lives rather than pretending the choice wrote it inline.
 */
function helperClosure(defs, ctx) {
  const bySig = ctx.signatures;
  const own = new Map();
  for (const d of defs) {
    // Zip declared parameter names against the signature's argument types, so a `ContractId T`
    // parameter is typed and the helper's `fetch`/`archive` on it resolves like any other.
    const sig = bySig.get(d.name);
    const types = sig ? arrowParts(sig).slice(0, -1) : [];
    const args = d.params.map((nm, i) => ({ name: nm, type: types[i] ?? "" }));
    own.set(d.name, resolveEdges({ args, body: d.body }, { name: null, fields: [] }, ctx));
  }

  // Transitive: a helper may call another helper. Cycle-guarded, and a helper never absorbs itself.
  //
  // Identifiers are extracted from the body ONCE and intersected with the helper set, rather than
  // testing one compiled RegExp per helper per body. The per-helper form is quadratic and it did
  // not merely run slow — on Splice (694+ top-level bindings) it stopped returning altogether. A
  // tool that hangs on a large codebase is broken whatever it finds on a small one.
  const cache = new Map();
  const idsCache = new Map();
  const identifiers = (body) => {
    let set = idsCache.get(body);
    if (set) return set;
    set = new Set();
    // Skip qualified names: in `M.foo`, `foo` is that module's, not a local helper of the same name.
    const RE = /(^|[^\w'.])([a-z_][\w']*)/g;
    let m;
    while ((m = RE.exec(body)) !== null) set.add(m[2]);
    idsCache.set(body, set);
    return set;
  };
  const names = new Set(own.keys());
  const calls = (body, self) => {
    const out = [];
    for (const n of identifiers(body)) if (n !== self && names.has(n)) out.push(n);
    return out;
  };
  // Reachability by BREADTH-FIRST WALK with one visited set, not recursion with a depth-0 cache.
  // The recursive form re-derived every shared sub-helper once per path to it; on a helper graph
  // with any width that is exponential. A visited set makes it linear and cycle-safe by
  // construction — a mutually recursive pair is visited once, not chased.
  const byName = new Map(defs.map((d) => [d.name, d]));
  const closureOf = (name) => {
    if (cache.has(name)) return cache.get(name);
    const out = [];
    const visited = new Set([name]);
    const queue = [name];
    while (queue.length) {
      const n = queue.shift();
      for (const e of own.get(n) ?? []) out.push({ ...e, through: e.through ?? n });
      for (const next of calls(byName.get(n)?.body ?? "", n)) {
        if (!visited.has(next)) { visited.add(next); queue.push(next); }
      }
    }
    cache.set(name, out);
    return out;
  };
  return { names: [...names], edgesVia: closureOf, calls };
}

const IGNORE_RETURNS = new Set(["Party","Text","Int","Decimal","Bool","Time","Date","ChoiceContext","Update","()"]);

export function parse(root, opts = {}) {
  const files = findSources(root, opts);
  const base = fs.statSync(root).isFile() ? path.dirname(root) : root;
  const mods = files.map((f) => parseModule(f, base));
  const templates = mods.flatMap((m) => m.templates);
  const templateNames = new Set(templates.map((t) => t.name));

  const choiceIndex = new Map();
  for (const t of templates) for (const c of t.choices) {
    if (!choiceIndex.has(c.name)) choiceIndex.set(c.name, []);
    choiceIndex.get(c.name).push(t.name);
  }
  const returnsOf = new Map();
  for (const t of templates) for (const c of t.choices) {
    if (c.returns) returnsOf.set(c.name, tupleComponents(c.returns));
  }
  const helperReturns = new Map();
  for (const f of mods.flatMap((m) => m.functions)) {
    const last = f.signature.split("->").pop().trim().replace(/^Update\s*\(?/, "").replace(/\)?\s*$/, "");
    const t = /^[A-Z]\w*(?:\.[A-Z]\w*)*$/.test(last) ? last.split(".").pop() : null;
    if (t && !IGNORE_RETURNS.has(t)) helperReturns.set(f.name, t);
  }
  const signatures = new Map(mods.flatMap((m) => m.functions).map((f) => [f.name, f.signature]));
  const ctx = { choiceIndex, templateNames, returnsOf, helperReturns, signatures };

  // Edges a choice reaches through top-level helpers — see helperClosure. Built once, over every
  // module, because helpers are freely imported across modules.
  const closure = helperClosure(mods.flatMap((m) => m.defs), ctx);

  const entries = [];
  const units = templates.map((t) => {
    const es = t.choices.map((c) => {
      const direct = resolveEdges(c, t, ctx);
      // Fold in what the helpers this choice calls do on the ledger. Deduped against the direct
      // edges by kind+target+via, so a choice that both archives inline and calls an archiving
      // helper is not double-counted.
      const viaHelpers = closure.calls(c.body, null).flatMap((n) => closure.edgesVia(n));
      const seen = new Set(direct.map((e) => `${e.kind}|${e.target}|${e.raw}`));
      const edges = [...direct];
      for (const e of viaHelpers) {
        const k = `${e.kind}|${e.target}|${e.raw}`;
        if (!seen.has(k)) { seen.add(k); edges.push(e); }
      }
      const createsSelf = edges.some((e) => e.kind === EDGE.CREATE && e.self);
      const e = entry({
        name: c.name, unit: t.name, module: t.module, path: t.path,
        line: c.line, endLine: c.endLine,
        // `a :: b :: optionalToList c` is Daml's cons-list controller form; `?x` marks the optional
        // arm, because "this party consents only when configured" is a real distinction.
        authority: String(c.controller ?? "").split(/,|::/).map((s) => s.trim()).filter(Boolean)
          .map((s) => s.replace(/^optionalToList\s+/, "?")),
        args: c.args, guards: c.guards, edges,
        effect: !c.consuming ? EFFECT.NONE : createsSelf ? EFFECT.TRANSITION : EFFECT.TERMINAL,
        returns: c.returns || null, source: c.rawBody || null, bodyLine: c.bodyLine,
      });
      entries.push(e);
      return e;
    });
    return unit({
      name: t.name, module: t.module, path: t.path, line: t.line, endLine: t.endLine,
      signatories: t.signatory ? [t.signatory] : [],
      observers: t.observer ? [t.observer] : [],
      fields: t.fields,
      invariants: t.ensure ? [t.ensure] : [],
      keys: t.key ? [t.key] : [],
      entries: es,
    });
  });

  return model({
    language: "daml", root,
    modules: mods.map((m) => ({ module: m.module, path: m.path,
                                units: m.templates.map((t) => t.name), functions: m.functions.length })),
    units, entries,
    notes: files.length === 0 ? ["no .daml source found under this path"] : [],
  });
}

export default { parse, findSources, stripComments, language: "daml" };
