import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import daml from "../src/adapters/daml.mjs";
import { render } from "../src/report.mjs";
import { model, unit, entry, edge, EDGE, EFFECT } from "../src/model.mjs";
import { viewData } from "../src/view.mjs";

const FIX = path.join(import.meta.dirname, "fixtures");
const html = render(daml.parse(FIX), { title: "test report" });

test("is self-contained — no network, no server, no external asset", () => {
  // An audit report gets emailed, opened offline, and read years later. Anything fetched at open
  // time is a report that will one day render blank.
  assert.equal(/src\s*=\s*["']https?:/.test(html), false, "external script");
  assert.equal(/href\s*=\s*["']https?:/.test(html), false, "external stylesheet or link");
  assert.equal(/@import/.test(html), false, "css @import");
  // The page DOES carry a filter script now. What must stay true is that it fetches nothing:
  // a report that reaches the network is a report that renders blank offline.
  assert.equal(/\b(fetch|XMLHttpRequest|importScripts|WebSocket)\s*\(/.test(html), false,
    "script performs network access");
});

test("every fact is in the HTML before any script runs — the script only filters", () => {
  // Progressive enhancement is the rule, and it is testable: strip the script and the document must
  // still state everything. If a fact were computed at runtime it would vanish here, and a reader
  // with JS off (or printing, or reading it in five years) would silently get less.
  const noScript = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  const m = daml.parse(FIX);
  for (const u of m.units) assert.ok(noScript.includes(u.name), `unit ${u.name} lost without script`);

  // Scoped to each entry's OWN section. A whole-document `includes` is worthless here: the word
  // "owner" appears in signatories, the surface table and the source listing, so moving a fact into
  // a data-attribute would still "pass". Verified by mutation — this assertion only became real
  // once it looked inside the section rather than at the page.
  for (const e of m.entries) {
    const id = `id="e-${e.unit}-${e.name}"`;
    const at = noScript.indexOf(id);
    assert.notEqual(at, -1, `entry ${e.name} has no section`);
    const end = noScript.indexOf("</section>", at);
    // TEXT, not markup. Stripping tags is the point: `data-auth="owner"` sits inside the section
    // and would satisfy a substring check while rendering an empty cell to a reader with JS off.
    // Two earlier versions of this assertion passed under mutation for exactly that reason.
    const sec = noScript.slice(at, end === -1 ? undefined : end);
    const text = sec.replace(/<[^>]*>/g, " ");
    for (const a of e.authority) {
      assert.ok(text.includes(a), `authority "${a}" of ${e.name} is not visible text in its section`);
    }
  }
  if (m.holes.length) assert.ok(noScript.includes("could not determine"), "holes lost without script");
  assert.ok(/resolution/i.test(noScript));
});

test("the script hides rather than reveals — nothing starts hidden", () => {
  // If the document shipped with rows hidden and only the script showed them, JS-off readers would
  // see a truncated report and not know it.
  assert.equal(/<section[^>]*\bhidden\b/.test(html), false, "content ships hidden");
});

test("escapes source text — Daml guards are full of < and >", () => {
  // `assertMsg ("sum (" <> show x <> ") below"` would otherwise open a bogus tag and swallow the
  // rest of the document. Verified against content the fixture actually contains.
  const danger = render(model({
    language: "daml", root: "/x",
    units: [], entries: [], modules: [],
    notes: ['<script>alert("x")</script> & "quoted"'],
  }));
  assert.equal(danger.includes("<script>alert"), false, "note was not escaped");
  assert.ok(danger.includes("&lt;script&gt;"), "expected escaped form");
});

test("an empty model renders a valid page rather than crashing", () => {
  const empty = render(model({ language: "daml", root: "/nowhere", notes: ["no .daml source found"] }));
  assert.ok(empty.startsWith("<!doctype html>"));
  assert.ok(empty.trimEnd().endsWith("</html>"));
  assert.ok(empty.includes("no .daml source found"));
});

test("holes are rendered as holes, never as a resolved target", () => {
  // The fixture has one deliberate unresolvable edge.
  assert.ok(html.includes("could not determine"), "hole not surfaced");
  assert.ok(html.includes("Holes — what could not be determined"));
});

test("every unit and entry is linkable, so the surface table can jump to detail", () => {
  const m = daml.parse(FIX);
  for (const u of m.units) assert.ok(html.includes(`id="u-${u.name}"`), `no anchor for unit ${u.name}`);
  for (const e of m.entries) assert.ok(html.includes(`id="e-${e.unit}-${e.name}"`), `no anchor for ${e.name}`);
});

test("tags balance — an unclosed section would swallow the rest of the report", () => {
  // Counted on the markup only. The inlined map script and data are not markup, and a tag-like
  // string inside them must not be able to make an unbalanced page pass or a balanced one fail.
  const markup = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  for (const tag of ["section", "table", "details", "div", "main"]) {
    const open = (markup.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? []).length;
    const close = (markup.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
    assert.equal(open, close, `${tag}: ${open} open vs ${close} closed`);
  }
});

test("a nonconsuming entry that creates is never labelled as only reading", () => {
  // Regression. EFFECT.NONE means "does not consume its own unit" — it says NOTHING about whether
  // the entry moves value. A real `nonconsuming choice` that mints tokens and
  // creates a Holding; an earlier page rendered it "reads only" with "creates: Holding" in the very
  // next cell. A reviewer skimming the effect column would have skipped a mint.
  const m = model({
    language: "daml", root: "/x", modules: ["M"],
    units: [unit({ name: "Delegation", module: "M", path: "M.daml", line: 1, signatories: ["issuer"] }),
            unit({ name: "Holding", module: "M", path: "M.daml", line: 40, signatories: ["registrar"] })],
    entries: [entry({
      name: "DelegatedMint", unit: "Delegation", module: "M", path: "M.daml", line: 10,
      authority: ["recipient"], effect: EFFECT.NONE,
      edges: [edge({ kind: EDGE.CREATE, target: "Holding", raw: "create Holding with .." })],
    })],
  });
  const page = render(m);
  const v = viewData(m);
  const mint = v.entries.find((e) => e.name === "DelegatedMint");
  assert.ok(v.doors.includes(mint.i), "a minting action an outsider can take must be one of the doors");
  assert.equal(v.labels[mint.effect], "repeatable");
  const listing = page.replace(/<script[\s\S]*?<\/script>/gi, "");
  for (const lie of ["reads only", "read-only", "read only"]) {
    assert.ok(!listing.includes(lie), `the listing must not call a creating entry "${lie}"`);
    assert.ok(!Object.values(v.labels).includes(lie), `the map's labels must not include "${lie}"`);
  }
});

test("the page carries the map: its data, its script, and a listing to fall back to", () => {
  assert.ok(html.includes('id="app"'), "no mount point for the map");
  assert.ok(/<script type="application\/json" id="st-data">/.test(html), "no embedded view data");
  const json = html.match(/<script type="application\/json" id="st-data">([\s\S]*?)<\/script>/)[1];
  const data = JSON.parse(json);
  assert.equal(data.units.length, daml.parse(FIX).units.length, "embedded data does not match the model");
  assert.ok(html.includes('id="code"'), "no listing for JS-off readers");
  // A broken map must fall back to the listing, not leave a blank page.
  assert.ok(html.includes('classList.remove("js")'), "no fallback when the map fails");
});

test("text from source is never handed to the browser as markup", () => {
  // Contract code is full of angle brackets. The map assigns it with textContent only.
  const script = html.match(/<script>\s*try \{([\s\S]*?)\} catch \(err\)/)[1];
  assert.equal(/\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write/.test(script), false,
    "the map script builds DOM from strings");
});

test("an action that archives and re-creates a contract is never offered as proof nothing ends it", () => {
  // Regression, found on a real pool: its withdraw archives a deposit position always and creates
  // one only `if createResidual`. The card listed it only under "Replaced by" and named a single
  // ending — so it told the reader a full withdrawal never ends a position. The map script must list
  // replacers under Ended by as a possibility, and must not claim "Nothing in this code ends it"
  // while any exist.
  const script = html.match(/<script>\s*try \{([\s\S]*?)\} catch \(err\)/)[1];
  const ended = script.slice(script.indexOf('"Ended by"'), script.indexOf("Nothing in this code ends it"));
  assert.ok(ended.includes("life.replaced"), "replacers are not shown under Ended by");
  assert.ok(/life\.ended\.length \|\| closedElsewhere \|\| life\.replaced\.length \? null/.test(script),
    "'Nothing in this code ends it' can still be shown while replacers exist");
});
