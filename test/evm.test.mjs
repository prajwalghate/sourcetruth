import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import evm from "../src/adapters/evm.mjs";
import { EDGE, EFFECT, attackSurface } from "../src/model.mjs";

const FIX = path.join(import.meta.dirname, "fixtures-evm");
const m = evm.parse(FIX);
const E = (n) => m.entries.find((e) => e.name === n);

test("contracts and interfaces become units; only external/public are entries", () => {
  assert.ok(m.units.some((u) => u.name === "Vault"));
  assert.ok(m.units.some((u) => u.name === "IERC20"));
  assert.ok(E("deposit"), "external function missing");
  assert.equal(m.entries.some((e) => e.name === "_drain"), false, "internal leaked in as an entry");
});

test("comments are not read — the fixture's comments contradict the code", () => {
  // "Vault.sweep is onlyOwner and safe" is a lie in the fixture.
  assert.deepEqual(E("sweep").authority, []);
});

test("authority comes from modifiers AND from require(msg.sender == x)", () => {
  assert.deepEqual(E("adminSet").authority, ["onlyOwner"]);
  assert.deepEqual(E("guardedByHand").authority, ["owner"]);
});

test("no modifier and no sender check means ANYONE — the most open case", () => {
  assert.deepEqual(E("sweep").authority, []);
  const s = attackSurface(m);
  const sweep = s.find((x) => x.name === "sweep");
  assert.equal(sweep.unguarded, true);
  assert.equal(sweep.authority, null);
  // Unguarded must sort ABOVE guarded: on Solidity that is the exposed case, not the safe one.
  assert.ok(s.findIndex((x) => x.name === "sweep") < s.findIndex((x) => x.name === "adminSet"));
});

test("view/pure change nothing; a state-changing function steps state", () => {
  assert.equal(E("peek").effect, EFFECT.NONE);
  assert.equal(E("deposit").effect, EFFECT.TRANSITION);
});

test("a cast call resolves THROUGH a nested paren — IERC20(address(x)).transfer()", () => {
  // A flat [^)]* misses this, which was most of the calls in a real codebase.
  assert.ok(E("deposit").edges.some((x) => x.kind === EDGE.CALL && x.target === "IERC20"));
});

test("an entry inherits the edges of the internal helpers it reaches", () => {
  // sweep() itself contains no call — it calls _drain(), which transfers.
  assert.ok(E("sweep").edges.some((x) => x.kind === EDGE.CALL && x.target === "IERC20"),
    "internal-call closure did not attribute the helper's edge");
});

test("a low-level .call is a HOLE — the callee cannot be named from source", () => {
  const e = E("risky");
  const hole = e.edges.find((x) => !x.resolved);
  assert.ok(hole, "low-level call not reported");
  assert.equal(hole.kind, EDGE.CALL);
  assert.equal(hole.target, null);
});

test("new Contract() is a CREATE edge", () => {
  assert.ok(E("spawn").edges.some((x) => x.kind === EDGE.CREATE && x.target === "Helper"));
});

test("block comments containing braces and quotes do not break the parser", () => {
  assert.ok(E("deposit"), "a brace inside a block comment broke contract-body matching");
});

test("a modifier is authority only if its body checks the caller — a lock is not a person", () => {
  // Regression. Every modifier used to be reported as authority, so `nonReentrant` appeared in the
  // list of who can act and `withdrawAll` looked guarded. It is callable by anyone. On a map of
  // principals that was a false picture of exactly the function a reviewer most needs to see.
  const g = evm.parse(path.join(FIX, "Guards.sol"));
  const G = (n) => g.entries.find((e) => e.name === n);
  assert.deepEqual(G("withdrawAll").authority, [], "a reentrancy lock does not restrict WHO");
  assert.ok(G("withdrawAll").guards.includes("modifier nonReentrant"), "…but it is still shown, as a guard");
  assert.deepEqual(G("pokeLive").authority, [], "a liveness check does not restrict who either");
  assert.deepEqual(G("setAdmin").authority, ["onlyAdmin"], "a body that checks msg.sender IS authority");
  assert.deepEqual(G("gated").authority, ["gate"], "_msgSender() counts, whatever the modifier is called");
  // Unknown, undefined, not `onlyX`: reported as open rather than hidden behind a name.
  assert.deepEqual(G("mystery").authority, []);
  assert.ok(G("mystery").guards.includes("modifier auth"));
});

test("a base-constructor call is not a modifier", () => {
  const g = evm.parse(path.join(FIX, "Guards.sol"));
  const ctor = g.entries.find((e) => e.name === "constructor");
  assert.ok(ctor, "constructor should be an entry");
  assert.equal(ctor.authority.includes("ERC20"), false, "ERC20(\"Name\",\"SYM\") was read as authority");
  assert.equal(ctor.guards.some((x) => x.includes("ERC20")), false);
});

test("tests and scripts are not reported as deployed code unless asked", () => {
  // Regression. Foundry test contracts are public and unguarded, so they topped the list of what
  // anyone can call on a real vault — where they were more than half the files. They are never
  // deployed; counting them was a false statement about what is on chain.
  const root = path.join(import.meta.dirname, "fixtures-evm-tests");
  const plain = evm.parse(root);
  assert.deepEqual(plain.units.map((u) => u.name), ["Pool"]);
  const withTests = evm.parse(root, { includeTests: true });
  assert.deepEqual(withTests.units.map((u) => u.name).sort(), ["Pool", "PoolTest"]);
});

// ── tracing, audited against a fixture that exercises every shape a real vault used ─────────────
const FLOWS = path.join(import.meta.dirname, "fixtures-evm-flows");
const fm = evm.parse(FLOWS);
const F = (n) => fm.entries.find((e) => e.name === n && e.unit === "Flows");
const calls = (e) => e.edges.filter((x) => x.resolved && x.kind === EDGE.CALL).map((x) => x.target);

test("a guard written as a helper call in a grandparent is authority — not 'anyone'", () => {
  // Regression, from a real strategy: eleven admin functions call `onlyManager();`, defined as a
  // plain function two contracts up. Reading only modifiers showed every one as callable by anyone.
  assert.deepEqual(F("setStrategy").authority, ["manager"]);
  assert.ok(F("setStrategy").guards.some((g) => g.startsWith("onlyManager() →")), "the page must show where the check lives");
});

test("a check that only runs on some paths is NOT credited", () => {
  // `if (v > 0) { onlyManager(); }` — with v = 0 there is no check. Crediting it hides an open function.
  assert.deepEqual(F("maybeGuarded").authority, []);
});

test("access expressions: || means either, mappings and reversed comparisons count", () => {
  assert.deepEqual(F("either").authority, ["manager or owner"]);
  assert.deepEqual(F("keeperOnly").authority, ["keepers[msg.sender]"]);
  assert.deepEqual(F("reversed").authority, ["manager"]);
});

test("calls through typed state vars, params, locals and mappings are traced — none silently dropped", () => {
  // Regression: only `IFoo(x).bar()` casts were recognised; `strategy.harvest()` was invisible — not a
  // hole, just absent — so a vault's most common calls never reached the map.
  for (const n of ["viaStateVar", "viaParam", "viaLocal", "viaMapping", "multiLine"]) {
    assert.deepEqual(calls(F(n)), ["IStrategy"], `${n} did not trace to IStrategy`);
  }
});

test("libraries: using-for and static calls hit the token; a pure library function is not a call", () => {
  assert.deepEqual(calls(F("viaUsing")), ["IToken"]);
  assert.deepEqual(calls(F("viaLibrary")), ["IToken"]);
  assert.equal(F("pureMath").edges.length, 0);
});

test("`this.`, ETH sends and untraceable receivers are reported, never dropped", () => {
  assert.deepEqual(calls(F("viaThis")), ["Flows"]);
  const eth = F("sendsEth").edges.find((x) => !x.resolved);
  assert.ok(eth?.meta?.eth, "an ETH send must be a hole marked as ETH");
  assert.ok(F("unknownReceiver").edges.some((x) => x.resolved && x.target === "IStrategy"), "a return-typed receiver resolves");
});

test("overloads are matched by argument count, not merged", () => {
  assert.deepEqual(calls(F("overloaded")), ["IStrategy"]);
  assert.deepEqual(calls(F("overloadedArg")), ["IToken"]);
});

test("an inherited helper's edges belong to the entry that reaches it", () => {
  const e = F("throughHelper").edges.find((x) => x.target === "IToken");
  assert.ok(e, "edge from Base._move missing");
  assert.equal(e.through, "_move");
});

test("a vendored parent's public function is on the child, dispatched to the child's override", () => {
  // Regression: a vault built on OpenZeppelin's ERC4626 is deposited into through OpenZeppelin's
  // deposit(), which runs the repo's own `_deposit`. None of it was on the map.
  const dep = fm.entries.find((e) => e.unit === "Flows" && e.name === "deposit");
  assert.ok(dep, "inherited deposit() missing from Flows");
  assert.equal(dep.inherited, "Share");
  assert.deepEqual(dep.authority, ["manager"], "the override's check must apply through virtual dispatch");
  assert.ok(calls(dep).includes("IStrategy"), "the override's call must be traced from the inherited entry");
});

test("imports resolve through remappings and nested dependencies; a missing one is said out loud", () => {
  const own = fm.entries.find((e) => e.unit === "Flows" && e.name === "transferOwned");
  assert.ok(own, "a parent found only inside a nested dependency was not read");
  assert.deepEqual(own.authority, ["onlyOwned"]);
  assert.ok(fm.notes.some((n) => /not on disk/.test(n) && n.includes("@gone/Missing.sol")), "missing import not reported");
});

test("constructors, interface declarations and TestContracts are never ways in", () => {
  assert.equal(F("constructor").deployOnly, true);
  assert.ok(fm.entries.filter((e) => e.unit === "IToken").every((e) => e.declared), "interface functions are declarations");
  assert.equal(fm.units.some((u) => u.name === "Harness"), false, "TestContracts/ is test code");
});

test("a lowercase event after emit is not mistaken for a helper that could hide a check", () => {
  assert.deepEqual(F("maybeGuarded").unread, []);
});
