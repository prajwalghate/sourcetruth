import { test } from "node:test";
import assert from "node:assert/strict";
import { model, unit, entry, edge, EDGE, EFFECT } from "../src/model.mjs";
import { viewData, sides, splitParties, embed } from "../src/view.mjs";
import { layout, CARD } from "../src/layout.mjs";
import { render } from "../src/report.mjs";

// A minimal CDP: an admin-made factory, a user who opens a vault through it, and a liquidator.
function cdp() {
  const u = (name, sig) => unit({ name, module: "M", path: "M.daml", line: 1, signatories: [sig] });
  const e = (name, on, authority, effect, edges = [], args = []) =>
    entry({ name, unit: on, module: "M", path: "M.daml", line: 2, authority, effect, edges, args });
  return model({
    language: "daml", root: "/cdp", modules: ["M"],
    units: [u("Admin", "operator"), u("Factory", "operator"), u("Vault", "operator, owner"), u("Receipt", "operator")],
    entries: [
      e("MakeFactory", "Admin", ["operator"], EFFECT.NONE, [edge({ kind: EDGE.CREATE, target: "Factory", raw: "create Factory" })]),
      e("Open", "Factory", ["owner"], EFFECT.NONE, [edge({ kind: EDGE.CREATE, target: "Vault", raw: "create Vault" })]),
      e("Borrow", "Vault", ["owner"], EFFECT.TRANSITION, [edge({ kind: EDGE.CREATE, target: "Vault", raw: "create this", self: true })]),
      e("Liquidate", "Vault", ["liquidator"], EFFECT.TERMINAL,
        [edge({ kind: EDGE.CREATE, target: "Receipt", raw: "create Receipt" })],
        [{ name: "priceCid", type: "ContractId Price" }]),
      e("Push", "Admin", ["operator", "pusher"], EFFECT.NONE, []),
    ],
  });
}

test("signatories arrive as one source string and are split into parties", () => {
  assert.deepEqual(splitParties(["protocol, owner"]), ["protocol", "owner"]);
  assert.deepEqual(splitParties(["a :: b", "a"]), ["a", "b"]);
  assert.deepEqual(splitParties(["(signatories this)"]), [], "an expression is not a party name");
});

test("who is outside is derived from the code — the borrower is outside, not an operator", () => {
  // Regression. A hard-coded operator list treated `owner` as an admin, because Solidity's
  // `onlyOwner` means one. In a Daml CDP the owner is the borrower, and every one of the
  // borrower's actions vanished from "where outsiders get in".
  const who = sides(cdp());
  const side = (n) => who.actors.find((a) => a.name === n)?.side;
  assert.equal(side("owner"), "outside");
  assert.equal(side("liquidator"), "outside");
  assert.equal(side("operator"), "inside");
  // Only ever acts alongside an operator, so can do nothing alone.
  assert.equal(side("pusher"), "inside");
});

test("an action carries the authority of its contract's signers — shown, not left implicit", () => {
  const v = viewData(cdp());
  const liq = v.entries.find((e) => e.name === "Liquidate");
  assert.deepEqual(liq.borrowed, ["operator", "owner"], "a liquidator acting on a vault carries operator's and owner's authority");
  assert.equal(liq.door, true);
  assert.deepEqual(liq.cidArgs, ["priceCid"], "a caller-chosen contract id is surfaced");
  const top = v.entries[v.doors[0]];
  assert.equal(top.name, "Liquidate", "an outsider alone wielding an operator's authority ranks first");
});

test("on Solidity, no access check means anyone — and anyone is outside", () => {
  const m = model({
    language: "solidity", root: "/s", modules: ["V"],
    units: [unit({ name: "V", module: "V", path: "V.sol", line: 1 })],
    entries: [
      entry({ name: "sweep", unit: "V", module: "V", path: "V.sol", line: 2, authority: [], effect: EFFECT.TRANSITION }),
      entry({ name: "peek", unit: "V", module: "V", path: "V.sol", line: 3, authority: [], effect: EFFECT.NONE }),
      entry({ name: "set", unit: "V", module: "V", path: "V.sol", line: 4, authority: ["onlyOwner"], effect: EFFECT.TRANSITION }),
    ],
  });
  const v = viewData(m);
  assert.equal(v.actors.find((a) => a.name === "anyone").side, "outside");
  assert.equal(v.actors.find((a) => a.name === "onlyOwner").side, "inside");
  const doorNames = v.doors.map((i) => v.entries[i].name);
  assert.deepEqual(doorNames, ["sweep"], "a view function changes nothing and is not a door");
});

test("an empty Daml controller is shown as unreadable — never as anyone", () => {
  const m = model({
    language: "daml", root: "/x", modules: ["M"],
    units: [unit({ name: "T", module: "M", path: "M.daml", line: 1, signatories: ["p"] })],
    entries: [entry({ name: "C", unit: "T", module: "M", path: "M.daml", line: 2, authority: [], effect: EFFECT.TERMINAL })],
  });
  const v = viewData(m);
  assert.equal(v.actors.some((a) => a.name === "anyone"), false, "Daml has no 'anyone'; an empty list is a parse gap");
  assert.equal(v.entries[0].unseen, true);
});

test("layout: cards never overlap, and every link runs left to right unless it closes a cycle", () => {
  const nodes = ["A", "B", "C", "D", "E", "F", "G"].map((id) => ({ id }));
  const links = [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"], ["D", "E"], ["E", "B"], ["F", "D"]]
    .map(([from, to]) => ({ from, to }));
  const r = layout(nodes, links);
  const boxes = [...r.pos.values()];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const apart = a.x + CARD.w <= b.x || b.x + CARD.w <= a.x || a.y + CARD.h <= b.y || b.y + CARD.h <= a.y;
      assert.ok(apart, "two cards overlap");
    }
  }
  const back = new Set(r.reversed.map(([f, t]) => `${f}|${t}`));
  for (const l of links) {
    if (back.has(`${l.from}|${l.to}`)) continue;
    assert.ok(r.pos.get(l.from).x < r.pos.get(l.to).x, `${l.from}->${l.to} does not run left to right`);
  }
  assert.equal(r.reversed.length, 1, "the one cycle (B->D->E->B) is broken exactly once, and reported");
  assert.equal(r.pos.get("G").standalone, true, "an unconnected card is set apart, not stacked with the roots");
});

test("layout is deterministic — the same code draws the same map, byte for byte", () => {
  const m = cdp();
  const a = render(m, { title: "t" });
  const b = render(m, { title: "t" });
  assert.equal(a, b);
});

test("source text cannot break out of the embedded data", () => {
  const m = model({
    language: "daml", root: "/x", modules: ["M"],
    units: [unit({ name: "T", module: "M", path: "M.daml", line: 1, signatories: ["p"] })],
    entries: [entry({
      name: "C", unit: "T", module: "M", path: "M.daml", line: 2, authority: ["p"], effect: EFFECT.NONE,
      guards: ['assertMsg "</script><script>alert(1)</script>" (x < y)'],
    })],
  });
  const out = embed(viewData(m));
  assert.equal(out.includes("</script"), false);
  assert.equal(out.includes("<"), false);
  assert.equal(JSON.parse(out).entries[0].guards[0], 'assertMsg "</script><script>alert(1)</script>" (x < y)',
    "escaping must not change the text a reader sees");
});

test("a Daml party NAMED anyone is a party, not the Solidity no-access-check case", () => {
  // Regression: Canton's Bong.daml has `controller anyone`, a choice argument. The page styled it
  // "no access check" because it matched on the name.
  const m = model({
    language: "daml", root: "/x", modules: ["M"],
    units: [unit({ name: "T", module: "M", path: "M.daml", line: 1, signatories: ["initiator"] })],
    entries: [entry({ name: "Abort", unit: "T", module: "M", path: "M.daml", line: 2, authority: ["anyone"],
      effect: EFFECT.TERMINAL, args: [{ name: "anyone", type: "Party" }] })],
  });
  const v = viewData(m);
  const a = v.actors.find((x) => x.name === "anyone");
  assert.equal(a.anyone, false, "a Daml party is never the no-access-check actor");
  assert.equal(v.entries[0].anyone, false);
  assert.deepEqual(v.entries[0].argParties, ["anyone"], "but a controller that is an argument IS flagged");
});

test("a controller expression is drawn as an expression, not as a named party", () => {
  const m = model({
    language: "daml", root: "/x", modules: ["M"],
    units: [unit({ name: "T", module: "M", path: "M.daml", line: 1, signatories: ["dso"] })],
    entries: [entry({ name: "Go", unit: "T", module: "M", path: "M.daml", line: 2,
      authority: ["Set.toList (transferControllers transfer)"], effect: EFFECT.NONE })],
  });
  assert.equal(viewData(m).actors[0].expr, true);
});

test("a contract archived and re-created from another contract is REPLACED, not fixed and not ended", () => {
  // Regression, found on a real pool: a deposit position's card said "Nothing replaces it — once made it
  // stays as it is", while four LendingPool actions archive it and create it again.
  const u = (name, sig) => unit({ name, module: "M", path: "M.daml", line: 1, signatories: [sig] });
  const m = model({
    language: "daml", root: "/x", modules: ["M"],
    units: [u("Pool", "operator"), u("Position", "operator")],
    entries: [
      entry({ name: "Supply", unit: "Pool", module: "M", path: "M.daml", line: 2, authority: ["user"], effect: EFFECT.NONE,
        edges: [edge({ kind: EDGE.DESTROY, target: "Position", raw: "archive posCid" }),
                edge({ kind: EDGE.CREATE, target: "Position", raw: "create Position" })] }),
      entry({ name: "Purge", unit: "Pool", module: "M", path: "M.daml", line: 3, authority: ["operator"], effect: EFFECT.NONE,
        edges: [edge({ kind: EDGE.DESTROY, target: "Position", raw: "archive posCid" })] }),
    ],
  });
  const v = viewData(m);
  const pos = v.life[v.units.find((x) => x.name === "Position").i];
  const names = (list) => list.map((x) => v.entries[x.e].name);
  assert.deepEqual(names(pos.replaced), ["Supply"], "archive + create from outside is a replacement");
  assert.deepEqual(names(pos.archived), ["Purge"], "only an archive with no successor ends it");
  assert.deepEqual(names(pos.made), ["Supply"]);
});
