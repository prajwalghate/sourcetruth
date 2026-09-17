import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import daml from "../src/adapters/daml.mjs";
import { EFFECT, EDGE } from "../src/model.mjs";

const FIX = path.join(import.meta.dirname, "fixtures");
const m = daml.parse(FIX);
const byName = (n) => m.entries.find((e) => e.name === n);

test("finds units and entries", () => {
  // By NAME, not by count. A count assertion breaks whenever a fixture is added, which trains you
  // to bump the number rather than read what it means — and a test you edit reflexively is not a test.
  for (const u of ["Vault", "Escrow", "Config", "Receipt"]) {
    assert.ok(m.units.some((x) => x.name === u), `missing unit ${u}`);
  }
  for (const e of ["Close", "Peek", "Bump"]) {
    assert.ok(m.entries.some((x) => x.name === e), `missing entry ${e}`);
  }
});

test("comments are not read — the fixture's comments contradict the code", () => {
  // "This choice is nonconsuming and touches nothing" is a lie in the fixture.
  assert.equal(byName("Close").effect, EFFECT.TERMINAL);
});

test("resolves a fetch through a CHOICE ARGUMENT", () => {
  const e = byName("Close").edges.find((x) => /configCid/.test(x.raw));
  assert.equal(e.target, "Config");
});

test("resolves a fetch through a TEMPLATE FIELD", () => {
  const e = byName("Close").edges.find((x) => /fetch escrowCid/.test(x.raw));
  assert.equal(e.target, "Escrow");
});

test("consuming + create this is a TRANSITION; without it, TERMINAL", () => {
  assert.equal(byName("Bump").effect, EFFECT.TRANSITION);
  assert.equal(byName("Close").effect, EFFECT.TERMINAL);
  assert.equal(byName("Peek").effect, EFFECT.NONE);
});

test("authority is recorded as source names; solo authority is flagged", () => {
  assert.deepEqual(byName("Close").authority, ["owner"]);
  assert.equal(byName("Close").soloAuthority, true);
  assert.deepEqual(byName("Peek").authority, ["owner", "operator"]);
  assert.equal(byName("Peek").soloAuthority, false);
});

test("archive is a DESTROY edge", () => {
  assert.ok(byName("Close").edges.some((x) => x.kind === EDGE.DESTROY && x.target === "Escrow"));
});

test("an unresolvable target is a HOLE, never a guess", () => {
  // `mysteryCid` is declared but never fetched, so no hole here — the guarantee under test is
  // that nothing is invented: every edge either has a real target or is counted in holes.
  for (const e of m.entries) for (const x of e.edges) {
    assert.equal(x.resolved, x.target !== null);
  }
  assert.equal(m.stats.holes, m.holes.length);
});

test("build output directories are skipped", () => {
  assert.ok(daml.findSources(FIX).every((f) => !f.includes("/.daml/")));
});

// ── binder forms that only show up in codebases we did not write ──────────────────────────
const it = daml.parse(path.join(FIX));
const ent = (n) => it.entries.find((e) => e.name === n);
const targets = (n) => ent(n).edges.map((x) => x.target);

test("Optional (ContractId T) resolves through a Some-arm", () => {
  assert.deepEqual(targets("TakeExisting"), ["Slot"]);
});

test("mapA lambda binds to the list element type, though the list is named after the body", () => {
  assert.deepEqual(targets("SumAll"), ["Slot"]);
});

test("forA lambda binds the same way with the list first", () => {
  assert.deepEqual(targets("SumAllFor"), ["Slot"]);
});

test("a lambda over an untypeable source stays a HOLE — never guessed", () => {
  const e = ent("Unknowable");
  assert.equal(e.edges.length, 1);
  assert.equal(e.edges[0].resolved, false);
  assert.equal(e.edges[0].target, null);
});

test("a module-qualified choice binds its result, so later uses do not cascade into holes", () => {
  // `nextCid <- exercise slotCid3 Q.Advance` then `fetch nextCid`. If the alias `Q` is taken as the
  // choice name the return lookup misses, nextCid never binds, and the fetch becomes a hole.
  const e = ent("ViaQualified");
  assert.ok(e, "fixture entry missing");
  assert.equal(e.edges.filter((x) => !x.resolved).length, 0, "qualified choice left a cascade of holes");
  assert.ok(e.edges.some((x) => x.kind === EDGE.READ && x.target === "Slot"));
});

test("an inline `with` still finds the controller, even across stripped comments", () => {
  // `choice C : T` / `with a : T` (one line) / a comment / `controller x, y`. Matching only the
  // block form of `with` left the scan pointing at the wrong line and reported a Daml choice as
  // callable by ANYONE — which for Daml is impossible. Found via the EVM adapter's unguarded concept.
  const e = ent("InlineWith");
  assert.ok(e, "fixture entry missing");
  assert.deepEqual(e.authority, ["owner", "admin"]);
  assert.equal(e.args.length, 1);
});

// ── pattern-match binders, each measured separately on a real protocol ───────────────────────
test("RULE 1: an exercise-result destructure that WRAPS still binds", () => {
  // `(a, b) <-\n  exercise cid Pair` — the line scan sees `<-` and `exercise` on different lines,
  // so `a` never bound and the later `fetch a` became a hole. Worth 2 holes on a real protocol.
  // Assert the FETCH specifically: the exercise edge resolves either way (via the cid's own type),
  // so checking the edge list as a whole would pass without the rule.
  const e = ent("WrappedResult");
  const f = e.edges.find((x) => /fetch a\b/.test(x.raw));
  assert.ok(f, "fixture changed: no fetch on the destructured variable");
  assert.equal(f.target, "Slot", "wrapped destructure did not bind");
});

test("RULE 2: a literal-tuple scrutinee types its positional pattern binders", () => {
  // `case (upfrontFee > 0, feeMintDelegationCid) of` / `(True, Some fmDelegCid) ->`.
  // The tuple has no name but its components do. Worth 1 hole on a real protocol.
  assert.deepEqual(targets("TupleCase"), ["Slot"]);
});

test("RULE 3: list and cons patterns bind to the scrutinee's element type", () => {
  // `[only] ->` and `(headCid :: _) ->` over a `[ContractId Slot]`.
  assert.deepEqual(targets("ListCase"), ["Slot", "Slot"]);
});

test("a pattern over an UNTYPEABLE scrutinee still stays a hole", () => {
  // The guarantee these rules must not break: binding more must never mean guessing.
  const e = ent("Unknowable");
  assert.equal(e.edges.every((x) => x.resolved), false);
});

test("a body of stripped-comment whitespace does not hang the resolver", () => {
  // REGRESSION, and the only kind of bug an ordinary assertion cannot see: the resolver did not
  // return a wrong answer, it never returned at all. Rule 1's binder was written
  // `\(?\s*([\w',\s]+?)\s*\)?` — `\s` inside the class AND in the `\s*` on either side of it —
  // so every whitespace run could be divided between them in exponentially many ways. With no `<-`
  // in the body to terminate on, the engine explored all of them. It parsed every corpus we had,
  // then blocked outright on Canton's Bong.daml.
  //
  // IT MUST RUN IN A CHILD PROCESS. `node --test`'s own `{ timeout }` cannot interrupt synchronous
  // code — it fires on the event loop, and the event loop is exactly what a runaway regex holds.
  // Written that way (and it was, first), the mutation did not turn the test red: it hung the whole
  // suite past four hundred seconds. A test that hangs CI instead of failing it is worse than no
  // test, because nobody reads a job that never finishes as a bug report. A killed child gives a
  // real, reportable failure.
  const r = spawnSync(process.execPath, [
    "-e",
    `import(${JSON.stringify(pathToFileURL(path.join(import.meta.dirname, "../src/adapters/daml.mjs")).href)})` +
    `.then((m) => { const x = m.default.parse(${JSON.stringify(path.join(import.meta.dirname, "fixtures-hang", "Pathological.daml"))});` +
    ` console.log(JSON.stringify(x.entries.map((e) => [e.name, e.authority]))); });`,
  ], { timeout: 15000, encoding: "utf8" });

  assert.equal(r.signal, null,
    `parsing was killed after 15s — the resolver is non-terminating on this input (signal ${r.signal})`);
  assert.equal(r.status, 0, `child failed: ${r.stderr}`);
  const entries = JSON.parse(r.stdout);
  const abort = entries.find(([n]) => n === "Cancel");
  assert.ok(abort, "the choice before the block comment must still be found");
  assert.deepEqual(abort[1], ["anyone"], "and parsed correctly, not merely quickly");
});

test("rule 1 still binds exercise results after the regex rewrite", () => {
  // The fix narrowed the binder to two unambiguous alternatives. Prove the capability it exists for
  // survived: a wrapped, parenthesised, tuple-destructured exercise result still types its vars.
  const m = daml.parse(path.join(FIX, "Iteration.daml"));
  // `Unknowable` is a hole ON PURPOSE — it fetches a lambda binder over an untyped list, and the
  // fixture exists partly to prove the tool leaves that alone rather than inventing a target. So
  // the assertion is that it is the ONLY one, not that there are none.
  const withHoles = m.entries.filter((e) => e.holes > 0).map((e) => e.name);
  assert.deepEqual(withHoles, ["Unknowable"], `unexpected holes: ${withHoles.join(", ")}`);
  // And the capability itself: `(a, b) <-` wrapping onto `exercise … Advance` still types `a`,
  // so the later `fetch a` resolves to the choice's first return component.
  const wrapped = m.entries.find((e) => e.name === "WrappedResult");
  assert.ok(wrapped, "fixture must still contain the wrapped-result choice");
  const fetched = wrapped.edges.filter((x) => x.kind === "read" && x.resolved).map((x) => x.target);
  assert.ok(fetched.length > 0, "the wrapped exercise result must still bind its variables");
});

test("Daml test packages are not drawn as deployed contracts unless asked", () => {
  // Regression. A real repo's `*-tests` package defined ten test-double templates —
  // malicious factories, fake app rights — over a third of the repo's templates. They are
  // never deployed; on the map they were contracts that do not exist.
  const root = path.join(import.meta.dirname, "fixtures-daml-pkgs");
  const names = (m) => m.units.map((u) => u.name).sort();
  // `checks/` is excluded by its daml.yaml name alone, `tools/tests/` by its directory name alone.
  assert.deepEqual(names(daml.parse(root)), ["Pool"]);
  assert.deepEqual(names(daml.parse(root, { includeTests: true })), ["MaliciousFactory", "Pool", "TestMarker"]);
  // Pointing straight at a test package is asking for it.
  assert.deepEqual(names(daml.parse(path.join(root, "checks"))), ["MaliciousFactory"]);
});

test("`template X with` on one line is a template, and pre/postconsuming choices are choices", () => {
  // Regression, from Canton's own governance code: 10 of 12 templates put `with` on the template
  // line, and every one of them was invisible — the package showed 2 templates and no choices.
  const m = daml.parse(path.join(import.meta.dirname, "fixtures-daml-layouts"));
  const names = m.units.map((u) => u.name).sort();
  assert.deepEqual(names, ["Tally", "Vote"]);
  const vote = m.units.find((u) => u.name === "Vote");
  assert.deepEqual(vote.fields.map((f) => f.name), ["dso", "voter"], "fields of an inline-with template");
  const close = m.entries.find((e) => e.unit === "Vote" && e.name === "Vote_Close");
  assert.ok(close, "postconsuming choice missing");
  assert.equal(close.effect, EFFECT.TERMINAL, "postconsuming still consumes");
  assert.deepEqual(close.authority, ["dso"]);
  const peek = m.entries.find((e) => e.unit === "Vote" && e.name === "Vote_Peek");
  assert.equal(peek.effect, EFFECT.NONE);
  const open = m.entries.find((e) => e.unit === "Tally" && e.name === "Tally_Open");
  assert.ok(open.edges.some((x) => x.resolved && x.target === "Vote"), "create into the inline-with template resolves");
});
