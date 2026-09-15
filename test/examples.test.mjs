// The examples ship with the tool and the docs point at them, so what they demonstrate is pinned.
// If a change to the parser makes an example stop showing its idea, the docs have become untrue.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import daml from "../src/adapters/daml.mjs";
import evm from "../src/adapters/evm.mjs";
import { viewData } from "../src/view.mjs";

const EX = path.join(import.meta.dirname, "..", "examples");
const pick = (v, unit, name) => v.entries.find((e) => v.units[e.unit].name === unit && e.name === name);

test("daml-lending shows outside parties, borrowed authority, caller-chosen ids and a blind spot", () => {
  const v = viewData(daml.parse(path.join(EX, "daml-lending")));
  const side = (n) => v.actors.find((a) => a.name === n)?.side;
  assert.equal(side("owner"), "outside");
  assert.equal(side("liquidator"), "outside");
  assert.equal(side("operator"), "inside");
  const liq = pick(v, "Position", "Liquidate");
  assert.deepEqual(liq.borrowed, ["operator", "owner"]);
  assert.deepEqual(liq.argParties, ["liquidator"]);
  assert.ok(liq.cidArgs.includes("priceCid"));
  assert.ok(liq.steps.some((s) => s.k === "blind"), "the let-destructured fetch should be a blind spot");
  assert.equal(pick(v, "Position", "Close").effect, "terminal");
  assert.equal(pick(v, "Pool", "OpenPosition").effect, "none", "nonconsuming: repeatable");
});

test("solidity-vault shows an open fee function, a helper-guarded harvest and a delegatecall blind spot", () => {
  const m = evm.parse(path.join(EX, "solidity-vault"));
  const v = viewData(m);
  const fee = pick(v, "Vault", "takeFee");
  assert.equal(fee.anyone, true);
  assert.equal(fee.door, true);
  assert.deepEqual(pick(v, "Vault", "harvest").auth, ["keepers[msg.sender]"]);
  assert.deepEqual(pick(v, "Strategy", "emergencyExit").auth, ["vault"]);
  const exec = pick(v, "Vault", "execute");
  assert.deepEqual(exec.auth, ["onlyOwner"]);
  assert.ok(exec.steps.some((s) => s.k === "blind" && s.low === "delegatecall"));
  assert.equal(pick(v, "Vault", "constructor").door, false, "a constructor is not a way in");
  assert.deepEqual(m.notes, [], "every import in the example resolves");
});
