// The language-neutral model. Every adapter emits this shape and nothing else.
//
// Written BEFORE the second adapter exists, deliberately. A model derived from one language is that
// language's AST wearing a hat; the EVM adapter would then be bolted on and the abstraction would
// leak in exactly the places that matter. So the vocabulary below is defined against two languages
// from the start, and the Daml adapter has to fit it rather than define it.
//
//   neutral        Daml                        Solidity / EVM
//   ------------   -------------------------   ----------------------------------
//   Unit           template                    contract
//   Entry          choice                      external/public function
//   authority      controller                  modifier, require(msg.sender == …)
//   CREATE         create                      new C(...)
//   CALL           exercise                    external call, delegatecall
//   READ           fetch                       storage read, staticcall
//   DESTROY        archive                     selfdestruct
//   stateEffect    consuming + re-creates self  mutates its own storage
//   Guard          assertMsg / ensure          require / revert
//   Hole           unresolved edge target      unresolved callee address
//
// THE HOLE IS THE POINT. Every other tool in this space reports what it found. An auditor's first
// question is "what could you not see?", and a tool that answers it by silently resolving to its
// best guess is worse than one that answers nothing. An edge whose target cannot be determined from
// source is recorded as a hole, with the raw line, and it is never guessed.

/** Edge kinds. Deliberately few — anything finer is a language detail and belongs in `raw`. */
export const EDGE = Object.freeze({
  CREATE: "create",
  CALL: "call",
  READ: "read",
  DESTROY: "destroy",
});

/** What an entry does to the state of its own Unit. */
export const EFFECT = Object.freeze({
  /** Leaves its Unit untouched (a view, a nonconsuming choice, a `view` function). */
  NONE: "none",
  /** Consumes its Unit and produces a successor — the state machine's step. */
  TRANSITION: "transition",
  /** Consumes its Unit and produces no successor — the state machine's exit. */
  TERMINAL: "terminal",
});

/** An edge from an Entry to some Unit. `target: null` means UNRESOLVED — see the note above. */
export function edge({ kind, target = null, raw = "", via = null, through = null,
                       external = false, self = false, meta = {} }) {
  if (!Object.values(EDGE).includes(kind)) throw new Error(`unknown edge kind: ${kind}`);
  // `via`     — the contract-id EXPRESSION the edge went through (`riskCid`, `feed.activeCid`).
  // `through` — the top-level FUNCTION the edge is written in, when a choice reached it by
  //             calling a helper rather than writing it inline. Distinct questions; reusing one
  //             field for both printed "via riskCid" where a function name belonged.
  return { kind, target, resolved: target !== null, raw: String(raw).trim(), via, through, external, self, meta };
}

/**
 * One callable thing.
 *
 * `authority` is the list of principals that must consent, as the SOURCE names them — not resolved
 * to addresses or parties. "Who can fire this alone" is the single most useful question an auditor
 * asks, and a one-element authority list is the answer.
 */
export function entry({
  name, unit, module: mod, path, line, endLine = null,
  authority = [], args = [], guards = [], edges = [],
  effect = EFFECT.NONE, returns = null, source = null, doc = null, bodyLine = null,
}) {
  return {
    name, unit, module: mod, path, line, endLine, bodyLine,
    authority, args, guards, edges, effect, returns,
    /** Raw source of the body, comments INTACT, for display only. Never parsed. */
    source,
    /** A doc comment if the language has them. Display only. Never evidence. */
    doc,
    soloAuthority: authority.length === 1,
    holes: edges.filter((e) => !e.resolved).length,
  };
}

/** One stateful thing that entries act on. */
export function unit({
  name, module: mod, path, line, endLine = null,
  signatories = [], observers = [], fields = [], invariants = [], keys = [], entries = [],
}) {
  // `keys` is an identity/uniqueness declaration — Daml's `key`. Languages without the concept
  // leave it empty, the same way Solidity leaves `invariants` empty. A neutral model is allowed
  // concepts not every language uses; what it must not do is name them after one language.
  return { name, module: mod, path, line, endLine, signatories, observers, fields, invariants, keys, entries };
}

/** What an adapter returns. */
export function model({ language, root, units = [], entries = [], modules = [], notes = [] }) {
  const edges = entries.flatMap((e) => e.edges);
  const holes = entries.flatMap((e) =>
    e.edges.filter((x) => !x.resolved).map((x) => ({ owner: `${e.unit}.${e.name}`, path: e.path, ...x }))
  );
  return {
    language, root, modules, units, entries, holes,
    stats: {
      modules: modules.length,
      units: units.length,
      entries: entries.length,
      edges: edges.length,
      holes: holes.length,
      /** The headline number. Not a score to maximise — a statement of how much is legible. */
      resolution: edges.length === 0 ? null : Math.round((100 * (edges.length - holes.length)) / edges.length),
      soloAuthority: entries.filter((e) => e.soloAuthority).length,
      terminal: entries.filter((e) => e.effect === EFFECT.TERMINAL).length,
    },
    notes,
  };
}

/** The call graph between units, for drawing. Unresolved edges are omitted — they are in `holes`. */
export function graph(m) {
  const nodes = m.units.map((u) => ({
    id: u.name, module: u.module, signatories: u.signatories, entries: u.entries.length,
  }));
  const seen = new Map();
  for (const e of m.entries) {
    for (const x of e.edges) {
      if (!x.resolved) continue;
      const key = `${e.unit}${x.target}${x.kind}`;
      if (!seen.has(key)) seen.set(key, { from: e.unit, to: x.target, kind: x.kind, via: [], external: x.external });
      seen.get(key).via.push(e.name);
    }
  }
  return { nodes, edges: [...seen.values()] };
}

/**
 * Entries that change state and need AT MOST ONE principal's consent — where review time goes.
 *
 * "At most one", not "exactly one", and the difference is the whole point. Daml makes you declare a
 * controller, so the exposed case is one party acting alone. Solidity's default is no restriction
 * at all: a function with no modifier and no `msg.sender` check is callable by anyone. **Zero
 * consent is strictly more exposed than one**, so filtering on `soloAuthority` would report a real
 * vault's 8 owner-guarded functions and hide its 100 unguarded ones — exactly inverted. Found by
 * measuring a live Solidity codebase, not by reasoning about it.
 *
 * Unguarded entries sort first, for the same reason.
 */
export function attackSurface(m) {
  return m.entries
    .filter((e) => e.authority.length <= 1 && e.effect !== EFFECT.NONE)
    .map((e) => ({
      unit: e.unit, name: e.name,
      authority: e.authority[0] ?? null,   // null means ANYONE — the most open case there is
      unguarded: e.authority.length === 0,
      effect: e.effect,
      path: e.path, line: e.line, holes: e.holes,
      moves: e.edges.filter((x) => x.kind === EDGE.CREATE || x.kind === EDGE.DESTROY).length,
      calls: e.edges.filter((x) => x.kind === EDGE.CALL).length,
    }))
    .sort((a, b) =>
      Number(b.unguarded) - Number(a.unguarded) ||
      b.holes - a.holes || b.moves - a.moves || b.calls - a.calls);
}
