// What the page draws — computed here and embedded as data.
//
// The browser only RENDERS. Every fact the map shows — who sits outside the protocol, which action
// carries whose authority, what a contract's life looks like, where each card sits — is decided in
// Node, from the parsed model, where it can be tested. A page that worked facts out at open time
// would show a picture nobody had checked.

import { EDGE, EFFECT } from "./model.mjs";
import { layout, CARD } from "./layout.mjs";

/**
 * What an action does to the contract it is ON. Never "reads only": a nonconsuming Daml choice can
 * mint and move value — it just does not consume itself — and a real delegated-mint choice was
 * once labelled exactly that, next to a cell saying it creates a Holding.
 */
export const EFFECT_LABEL = Object.freeze({
  [EFFECT.NONE]: "repeatable",
  [EFFECT.TRANSITION]: "changes it",
  [EFFECT.TERMINAL]: "ends it",
});

const bare = (p) => String(p).trim().replace(/^\?/, "");

/** `"protocol, owner"` -> ["protocol", "owner"]. Daml signatories arrive as one source string. */
export function splitParties(list) {
  return [...new Set((list ?? [])
    .flatMap((s) => String(s).split(/,|::/))
    .map((s) => s.trim().replace(/^[([]+|[)\]]+$/g, ""))
    .filter((s) => /^[a-z_][\w']*$/.test(s)))];
}

/**
 * Who runs the protocol, and who uses it — derived from the code, never from a list of names.
 *
 * A hard-coded operator list was tried and it was wrong in the most damaging direction: it treated
 * `owner` as an operator because Solidity's `onlyOwner` means admin. In a Daml CDP, `owner` is the
 * borrower — the protocol's main outside user — so every one of the borrower's actions vanished
 * from "where outsiders get in".
 *
 * Daml: the parties who sign the contracts nothing in this code creates are INSIDE; so are the
 * signers of any contract that is only ever created with an inside party's consent. Everyone else
 * who can act without an inside party is OUTSIDE. A party who only ever acts alongside an inside
 * one (an oracle pusher, a mint recipient) cannot do anything alone, so is grouped inside.
 *
 * Solidity: there are no signatories. A named access check is a privilege; no check is `anyone`.
 */
export function sides(m) {
  const daml = m.language === "daml";
  const byName = new Map();
  for (const u of m.units) if (!byName.has(u.name)) byName.set(u.name, u);
  const signers = (name) => splitParties(byName.get(name)?.signatories);
  const inside = new Set();

  if (daml) {
    const makers = new Map();
    for (const e of m.entries) {
      for (const x of e.edges) {
        if (x.kind !== EDGE.CREATE || !x.resolved || x.target === e.unit || !byName.has(x.target)) continue;
        if (!makers.has(x.target)) makers.set(x.target, []);
        makers.get(x.target).push(e);
      }
    }
    for (const u of m.units) if (!makers.has(u.name)) for (const p of signers(u.name)) inside.add(p);
    for (let grew = true; grew;) {
      grew = false;
      for (const [target, es] of makers) {
        // EVERY maker needs an inside party. With `some`, one admin migration path would make the
        // borrower an operator.
        if (!es.every((e) => e.authority.some((p) => inside.has(bare(p))))) continue;
        for (const p of signers(target)) if (!inside.has(p)) { inside.add(p); grew = true; }
      }
    }
  } else {
    for (const e of m.entries) for (const p of e.authority) inside.add(bare(p));
  }

  const actors = new Map();
  const touch = (name, i, optional) => {
    // `expr`: the source names no party at all — `Set.toList (controllersOf x)`, `signatory this` —
    // so who acts is decided at run time. Drawn differently, never with a person's initial.
    if (!actors.has(name)) actors.set(name, { name, entries: [], optional: true, unseen: false, anyone: false,
      expr: !/^[A-Za-z_][\w']*$/.test(name) });
    const a = actors.get(name);
    a.entries.push(i);
    a.optional &&= optional;
  };
  m.entries.forEach((e, i) => {
    // A declaration is not code, and a constructor runs once at deployment: neither is an action
    // anyone takes, so neither may put a name in "who can act".
    if (e.declared || e.deployOnly) return;
    if (e.authority.length === 0) {
      // In Solidity an empty authority IS the fact: anyone. In Daml every choice names a
      // controller, so an empty list is a parse gap — and saying "anyone" would be inventing it.
      if (daml) { touch("(unreadable)", i, false); actors.get("(unreadable)").unseen = true; }
      else { touch("anyone", i, false); actors.get("anyone").anyone = true; }
      return;
    }
    for (const p of e.authority) touch(bare(p), i, String(p).trim().startsWith("?"));
  });
  const alone = (e) => e.authority.length > 0 && e.authority.every((p) => !inside.has(bare(p)));
  for (const a of actors.values()) {
    // Decided by the flag, never by the name: Canton's own code has a Daml party literally called
    // `anyone`, and styling it as "no access check" would have been this page inventing a fact.
    const outside = a.anyone || a.unseen
      || (!inside.has(a.name) && a.entries.some((i) => alone(m.entries[i])));
    a.side = outside ? "outside" : "inside";
  }
  return { inside, actors: [...actors.values()], alone, signers };
}

/** One step of an action, as drawn: what it touches and how. Duplicates collapse to a count. */
function stepsOf(e, nodeOf) {
  const out = [];
  const idx = new Map();
  for (const x of e.edges) {
    const kind = x.resolved ? x.kind : "blind";
    const to = x.resolved ? nodeOf(x.target) : null;
    const key = `${kind}|${to}|${x.through ?? ""}|${x.resolved ? "" : x.raw}`;
    if (idx.has(key)) { out[idx.get(key)].n++; continue; }
    idx.set(key, out.length);
    out.push({
      k: kind, to, name: x.resolved ? x.target : null, raw: x.raw,
      thr: x.through ?? null, self: Boolean(x.self), n: 1,
      eth: Boolean(x.meta?.eth), low: x.meta?.lowLevel ?? null, lib: x.meta?.library ?? null,
      recv: x.resolved ? null : (x.meta?.receiver ?? null),
    });
  }
  return out;
}

/** Examples for the "how to read this" tiles, picked from THIS codebase rather than invented. */
function concepts(m, entries, units) {
  const daml = m.language === "daml";
  const risky = (a, b) => b.risk - a.risk || a.i - b.i;
  // Prefer an entry no earlier tile used: eight tiles all illustrated by the same liquidation teach
  // one example eight times. Falls back to a repeat rather than to nothing.
  const used = new Set();
  const pick = (pred) => {
    const all = [...entries].filter((e) => !e.declared && !e.deployOnly && pred(e)).sort(risky);
    const hit = all.find((e) => !used.has(e.i)) ?? all[0];
    if (hit) used.add(hit.i);
    return hit?.i ?? null;
  };
  const hasEdge = (e, kind) => e.steps.some((s) => s.k === kind);
  const COPY = {
    contract: daml
      ? ["Contract", "A record on the ledger. The stamps are who signed it.",
        "Signers are bound by it — and lend their authority to every action taken on it."]
      : ["Contract", "Code with its own storage. Calls change that storage in place.",
        "There is no history on-chain of what a value used to be — read what each function writes."],
    action: ["Action", "A named step on a contract. Only the listed party can take it.",
      "One name means that party acts alone. Two means both must agree."],
    changes: daml
      ? ["Changes it", "Nothing is edited in place: the old contract is archived and a new one made.",
        "Compare old and new fields. A value carried over unchanged is where stale state hides."]
      : ["Changes it", "Writes to the contract's own storage.",
        "Check every value written against every value later read — in every order of calls."],
    ends: ["Ends it", "Archived, with nothing made in its place.",
      "Follow what leaves when it ends, and who receives it."],
    repeatable: ["Repeatable", "The contract stays, so the action can run again and again.",
      "Nothing limits repeats unless the code does. Check totals and rates."],
    borrowed: ["Borrowed authority", "An action also carries the authority of everyone who signed its contract.",
      "The caller's reach is not their own. It is the most-missed rule in Daml."],
    cid: ["Ids passed in", "A contract id in the arguments is chosen by whoever calls.",
      "If the action doesn't check it received the contract it expected, the caller can swap it."],
    anyone: ["Anyone", "No access check at all: anyone can call it.",
      "This is Solidity's default, not an oversight to assume away. Start here."],
    guarded: ["Guarded", "An access modifier or caller check limits who can call.",
      "Find who holds that role. They can do everything listed under it."],
    calls: ["Calls out", "The action calls into another contract.",
      "State written after an external call is the reentrancy pattern."],
    creates: ["Creates", "The action brings a new contract into existence.",
      "Check who controls the new contract once it exists."],
    blind: ["Blind spot", "The tool couldn't tell what this points at, so it doesn't guess.",
      daml ? "A missing arrow means unproven — never 'nothing there'. Read these yourself."
        : "Low-level call and delegatecall targets are always blind. delegatecall to a caller-chosen address hands over the contract."],
    type: ["Two typefaces", "Monospace is copied from the source. Sans is the tool talking.", null],
  };
  const tile = (key, example) => ({ key, title: COPY[key][0], line: COPY[key][1], note: COPY[key][2], ...example });
  const widest = [...units].sort((a, b) => b.signers.length - a.signers.length || b.actions - a.actions)[0];
  const busiest = [...units].filter((u) => !u.ghost).sort((a, b) => b.actions - a.actions)[0];

  if (daml) {
    return [
      tile("contract", { unit: widest?.i ?? null }),
      tile("action", { entry: pick((e) => e.alone && e.unit === widest?.i) ?? pick((e) => e.alone) }),
      tile("changes", { entry: pick((e) => e.effect === EFFECT.TRANSITION && e.alone) ?? pick((e) => e.effect === EFFECT.TRANSITION) }),
      tile("ends", { entry: pick((e) => e.effect === EFFECT.TERMINAL && e.alone) ?? pick((e) => e.effect === EFFECT.TERMINAL) }),
      tile("repeatable", { entry: pick((e) => e.effect === EFFECT.NONE && hasEdge(e, EDGE.CREATE)) }),
      tile("borrowed", { entry: pick((e) => e.borrowed.length > 0 && e.alone && hasEdge(e, EDGE.CREATE)) ?? pick((e) => e.borrowed.length > 0) }),
      tile("cid", { entry: pick((e) => e.cidArgs.length > 0 && e.alone) ?? pick((e) => e.cidArgs.length > 0) }),
      tile("blind", { entry: pick((e) => e.holes > 0) }),
      tile("type", {}),
    ];
  }
  return [
    tile("contract", { unit: busiest?.i ?? null }),
    tile("anyone", { entry: pick((e) => e.anyone && e.effect !== EFFECT.NONE) }),
    tile("guarded", { entry: pick((e) => !e.anyone && e.effect !== EFFECT.NONE) }),
    tile("calls", { entry: pick((e) => hasEdge(e, EDGE.CALL)) }),
    tile("creates", { entry: pick((e) => hasEdge(e, EDGE.CREATE)) }),
    tile("blind", { entry: pick((e) => e.holes > 0) }),
    tile("type", {}),
  ];
}

export function viewData(m, { title = "sourcetruth" } = {}) {
  const daml = m.language === "daml";
  const who = sides(m);

  // ── nodes: every unit, plus a ghost for anything created or called that is not defined here ──
  const unitIndex = new Map();
  m.units.forEach((u, i) => { if (!unitIndex.has(u.name)) unitIndex.set(u.name, i); });
  const ghosts = new Map();
  const nodeOf = (name) => {
    if (name == null) return null;
    if (unitIndex.has(name)) return `u${unitIndex.get(name)}`;
    return `g:${name}`;
  };

  const entryIndexOf = new Map(m.entries.map((e, i) => [e, i]));
  const entries = m.entries.map((e, i) => {
    const own = unitIndex.get(e.unit);
    const borrowed = daml ? who.signers(e.unit).filter((p) => !e.authority.map(bare).includes(p)) : [];
    const steps = stepsOf(e, nodeOf);
    const anyone = !daml && e.authority.length === 0;
    const alone = anyone || who.alone(e);
    const moves = e.edges.filter((x) => x.kind === EDGE.CREATE || x.kind === EDGE.DESTROY).length;
    const changesSomething = e.effect !== EFFECT.NONE
      || (daml && e.edges.some((x) => x.kind === EDGE.CREATE || x.kind === EDGE.DESTROY || x.kind === EDGE.CALL));
    const risk = (anyone && changesSomething ? 1000 : 0)
      + (alone && borrowed.some((p) => who.inside.has(p)) ? 400 : 0)
      + (e.effect === EFFECT.TERMINAL ? 120 : e.effect === EFFECT.TRANSITION ? 80 : 0)
      + 20 * Math.min(moves, 10) + 30 * e.holes
      + (e.edges.some((x) => x.resolved && !unitIndex.has(x.target) && x.kind !== EDGE.READ) ? 50 : 0);
    return {
      i, unit: own, name: e.name, auth: e.authority, alone, anyone,
      unseen: daml && e.authority.length === 0,
      effect: e.effect, holes: e.holes, path: e.path, line: e.line,
      guards: e.guards, borrowed, steps, risk,
      door: !e.declared && !e.deployOnly && alone && changesSomething,
      declared: Boolean(e.declared), deployOnly: Boolean(e.deployOnly),
      inherited: e.inherited ?? null, unread: e.unread ?? [],
      // A controller that is one of the choice's own ARGUMENTS: whoever exercises it names who acts.
      argParties: daml ? e.authority.map(bare).filter((p) => (e.args ?? []).some((a) => a.name === p)) : [],
      cidArgs: (e.args ?? []).filter((a) => /ContractId\b/.test(a.type ?? "")).map((a) => a.name),
      anchor: `e-${e.unit}-${e.name}`.replace(/[^\w-]/g, "_"),
    };
  });
  void entryIndexOf;

  // ── links between nodes: who makes or calls whom. Reads are left for the per-action view ──────
  const linkMap = new Map();
  entries.forEach((e) => {
    const from = `u${e.unit}`;
    for (const s of e.steps) {
      if ((s.k !== EDGE.CREATE && s.k !== EDGE.CALL) || !s.to || s.to === from) continue;
      if (s.to.startsWith("g:") && !ghosts.has(s.to)) ghosts.set(s.to, { id: s.to, name: s.name, ghost: true });
      const key = `${from}|${s.to}|${s.k}`;
      if (!linkMap.has(key)) linkMap.set(key, { from, to: s.to, k: s.k, via: [] });
      const l = linkMap.get(key);
      if (!l.via.includes(e.i)) l.via.push(e.i);
    }
  });
  // Ghosts reached only by reads still need a place to point at when an action is played.
  entries.forEach((e) => e.steps.forEach((s) => {
    if (s.to && s.to.startsWith("g:") && !ghosts.has(s.to)) ghosts.set(s.to, { id: s.to, name: s.name, ghost: true, readOnly: true });
  }));

  // ── lifecycle of each unit ────────────────────────────────────────────────────────────────────
  const life = m.units.map(() => ({ made: [], changed: [], replaced: [], ended: [], read: [], archived: [] }));
  const add = (arr, i, thr) => { if (!arr.some((x) => x.e === i && x.thr === thr)) arr.push({ e: i, thr }); };
  entries.forEach((e) => {
    if (e.effect === EFFECT.TRANSITION) add(life[e.unit].changed, e.i, null);
    if (e.effect === EFFECT.TERMINAL) add(life[e.unit].ended, e.i, null);
    for (const s of e.steps) {
      if (!s.to || !s.to.startsWith("u")) continue;
      const t = Number(s.to.slice(1));
      if (s.k === EDGE.CREATE && !(s.self && t === e.unit)) add(life[t].made, e.i, s.thr);
      else if (s.k === EDGE.READ) add(life[t].read, e.i, s.thr);
      else if (s.k === EDGE.DESTROY && t !== e.unit) add(life[t].archived, e.i, s.thr);
    }
  });

  // An action on ANOTHER contract that both archives this one and creates it is replacing it — how a
  // Daml position is updated from its pool. Counting only this contract's own choices told a
  // reader that a deposit position "stays as it is" while four pool actions rewrite it.
  //
  // `replaced` is kept apart from `archived` because it is AMBIGUOUS, not because it is safe: the
  // parser cannot see branches, and a real pool's withdraw archives the position always but
  // creates one only `if createResidual`. So a replacement may also be an ending; the page shows it
  // under both, and never lets it support the claim that nothing ends a contract.
  for (const l of life) {
    const makers = new Set(l.made.map((x) => x.e));
    l.replaced = l.archived.filter((x) => makers.has(x.e));
    l.archived = l.archived.filter((x) => !makers.has(x.e));
  }

  // ── cards ─────────────────────────────────────────────────────────────────────────────────────
  const units = m.units.map((u, i) => {
    const own = entries.filter((e) => e.unit === i && !e.declared && !e.deployOnly);
    return {
      i, id: `u${i}`, name: u.name, module: u.module, path: u.path, line: u.line,
      kind: u.abstract ? "abstract contract" : (u.kind ?? (daml ? "template" : "contract")),
      signers: splitParties(u.signatories),
      actions: own.length,
      holes: own.reduce((n, e) => n + e.holes, 0),
      anchor: `u-${u.name}`,
    };
  });
  const ghostList = [...ghosts.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
  const links = [...linkMap.values()];
  const placed = layout(
    [...units.map((u) => ({ id: u.id, sort: `${u.module}/${u.name}` })),
     ...ghostList.filter((g) => !g.readOnly).map((g) => ({ id: g.id, sort: `~${g.name}` }))],
    links,
  );
  for (const n of [...units, ...ghostList]) {
    const p = placed.pos.get(n.id);
    if (p) Object.assign(n, { x: p.x, y: p.y, standalone: p.standalone });
  }

  const actors = who.actors
    .map((a) => ({
      name: a.name, side: a.side, optional: a.optional, unseen: a.unseen, anyone: a.anyone, expr: a.expr,
      entries: a.entries,
      doors: a.entries.filter((i) => entries[i].door).length,
      borrows: a.entries.some((i) => entries[i].alone && entries[i].borrowed.length > 0),
    }))
    .sort((a, b) =>
      (a.side === b.side ? 0 : a.side === "outside" ? -1 : 1)
      || Number(b.anyone) - Number(a.anyone)
      || b.doors - a.doors || b.entries.length - a.entries.length
      || (a.name < b.name ? -1 : 1));

  const view = {
    title, language: m.language, daml,
    stats: m.stats, notes: m.notes,
    card: CARD, size: { w: placed.width, h: placed.height, standaloneTop: placed.standaloneTop },
    labels: EFFECT_LABEL,
    units, ghosts: ghostList, links, entries, actors, life,
    doors: entries.filter((e) => e.door).sort((a, b) => b.risk - a.risk || a.i - b.i).map((e) => e.i),
  };
  view.concepts = concepts(m, entries, units);
  return view;
}

/** Embed as a JSON script block that cannot close itself early, whatever the source text says. */
export function embed(view) {
  // JSON may legally contain U+2028/U+2029; older script parsers treat them as line breaks. And a
  // raw `</script>` inside any source string would end the block and spill the rest into the page.
  return JSON.stringify(view)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
