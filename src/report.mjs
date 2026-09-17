// One self-contained HTML file: an interactive map on top, the plain listing underneath.
//
// Still deliberately NOT a web app. An audit report gets emailed, opened on a plane, attached to a
// ticket, and read two years later when the tool that made it no longer runs. So: one file, no
// server, no network, no CDN — the map's script, styles and data are all inlined.
//
// What you see first is the MAP (src/client/app.js): who can act, which contracts they touch, and —
// press play — what one action archives, creates and calls. It exists because a listing of facts,
// however accurate, left the reader to do the traversal in their head. The page should show it.
//
// What sits underneath is the LISTING: every unit, entry, authority, edge, hole and source body as
// plain HTML. It is the Code tab when JavaScript runs, and the whole page when it does not. The rule
// from the first version still holds and is still tested — every fact is in the document before any
// script runs. The map draws from data computed in Node (src/view.mjs); it works nothing out.
//
// It stores NO findings and knows nothing about any issue tracker. It shows what the code does and
// what could not be determined. Deciding what is WRONG is the reader's job, kept in their register.

import fs from "node:fs";
import path from "node:path";
import { attackSurface, graph } from "./model.mjs";
import { viewData, embed, EFFECT_LABEL } from "./view.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Maps get attached to tickets and posted. The path above the folder that was read — a username, a
 *  client's name — is nobody's business, so a map names the folder alone. */
const folder = (root) => path.basename(String(root ?? "")) || String(root ?? "");

/** Entry anchors are shared with the map, which reads each action's source out of the listing. */
export const anchor = (unit, name) => `e-${unit}-${name}`.replace(/[^\w-]/g, "_");

const CLIENT_JS = fs.readFileSync(new URL("./client/app.js", import.meta.url), "utf8");
const CLIENT_CSS = fs.readFileSync(new URL("./client/app.css", import.meta.url), "utf8");

/** Resolution decides how much of the rest to believe, so it is graded, not scored. */
function trustNote(r) {
  if (r === null) return "No edges found — nothing to resolve.";
  if (r >= 95) return "Nearly all wiring resolved. The graph below is close to complete.";
  if (r >= 80) return "Most wiring resolved. Read the holes before relying on the graph.";
  if (r >= 50) return "A significant share is unresolved. Treat the graph as partial.";
  return "Most edges are unresolved. The graph is not a reliable picture of this codebase.";
}

// The listing's own styles, scoped to #code so they cannot leak into the map, and built on the
// map's colour tokens so both views change theme together.
const LISTING_CSS = `
#code{--bg:var(--ground);--fg:var(--ink);--dim:var(--muted);--card:var(--surface);--accent:var(--flow);
  --warn:var(--blind);--hole:var(--end);--code:var(--raised);font:15px/1.6 var(--sans);color:var(--fg)}
#code .wrap{max-width:1100px;margin:0 auto;padding:32px 20px 96px}
#code code,#code pre,#code .raw{font-family:var(--mono);font-size:.88em}
#code .code-top h1{margin:0 0 4px;font-size:26px;letter-spacing:-.01em}
#code .code-top .sub{color:var(--dim);font-size:14px;margin-bottom:22px}
#code h2{font-size:19px;margin:42px 0 6px;padding-top:14px;border-top:1px solid var(--line)}
#code h3{font-size:16px;margin:26px 0 8px}
#code h4{font-size:14px;margin:18px 0 6px;font-weight:600}
#code .lede{color:var(--dim);margin:4px 0 14px;max-width:70ch}
#code .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:18px 0 8px}
#code .stat{background:var(--card);border:1px solid var(--line);border-radius:9px;padding:12px 14px}
#code .stat .k{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.07em}
#code .stat .v{font-size:24px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:2px}
#code .stat .n{color:var(--dim);font-size:12px;margin-top:2px}
#code .trust{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--accent);
  border-radius:8px;padding:12px 15px;margin:14px 0 4px}
#code .t{width:100%;border-collapse:collapse;margin:10px 0;font-size:13.5px;display:block;overflow-x:auto}
#code .t th{text-align:left;font-weight:600;color:var(--dim);font-size:11px;text-transform:uppercase;
  letter-spacing:.06em;padding:7px 10px;border-bottom:1px solid var(--line)}
#code .t td{padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
#code .t.sm td{padding:4px 10px}
#code .t .num{text-align:right;font-variant-numeric:tabular-nums}
#code .dim{color:var(--dim)}#code .warn{color:var(--warn);font-weight:600}
#code .hole{color:var(--hole);font-weight:600}#code .ok{color:var(--make)}
#code .pill{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;
  border:1px solid var(--line);background:var(--code);color:var(--dim);white-space:nowrap}
#code .pill.solo{color:var(--warn);border-color:var(--warn)}
#code .pill.anyone{color:var(--power);border-color:var(--power);font-weight:600}
#code .pill.ext{opacity:.75}
#code .k-create{color:var(--make)}#code .k-destroy{color:var(--end)}#code .k-call{color:var(--flow)}
#code .f-terminal{color:var(--end)}#code .f-transition{color:var(--flow)}
#code .kv{display:flex;gap:10px;padding:2px 0;font-size:13.5px}
#code .kv>span:first-child{color:var(--dim);min-width:104px;flex-shrink:0}
#code .unit{background:var(--card);border:1px solid var(--line);border-radius:11px;padding:16px 18px;margin:16px 0;scroll-margin-top:64px}
#code .entry{border-top:1px solid var(--line);padding-top:12px;margin-top:14px;scroll-margin-top:64px}
#code details{margin:7px 0}#code summary{cursor:pointer;color:var(--dim);font-size:13px;user-select:none}
#code summary:hover{color:var(--fg)}
#code pre.src{background:var(--code);border:1px solid var(--line);border-radius:7px;padding:11px 13px;
  overflow-x:auto;margin:7px 0;line-height:1.5}
#code .guards code{display:block;background:var(--code);border-radius:5px;padding:4px 8px;margin:3px 0}
#code a{color:var(--accent);text-decoration:none}#code a:hover{text-decoration:underline}
#code .toc{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px}
#code .toc a{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:3px 9px;font-size:12.5px}
#code .sm-note{font-size:12px;margin-top:6px;max-width:72ch}
#code .toolbar{position:sticky;top:0;z-index:5;display:flex;gap:14px;align-items:center;flex-wrap:wrap;
  background:var(--bg);border-bottom:1px solid var(--line);padding:10px 0;margin-top:18px}
.view-code #code .toolbar{top:52px}
#code .toolbar input[type=search]{flex:1;min-width:220px;background:var(--card);color:var(--fg);
  border:1px solid var(--line);border-radius:7px;padding:7px 11px;font:inherit;font-size:14px}
#code .toolbar label{display:flex;gap:6px;align-items:center;color:var(--dim);font-size:13px;cursor:pointer}
#code .toolbar #count{margin-left:auto;font-size:12.5px;font-variant-numeric:tabular-nums}
#code .noscript{background:var(--blind-soft);color:var(--ink);border-radius:8px;padding:10px 14px;margin:0 0 18px}
#code footer{margin-top:52px;padding-top:16px;border-top:1px solid var(--line);color:var(--dim);font-size:12.5px}
@media print{#code .toolbar{display:none}#code details{display:block}#code details>summary{display:none}}
`;

export function render(model, { title = "sourcetruth report", generatedAt = null } = {}) {
  const s = model.stats;
  const surface = attackSurface(model);
  const g = graph(model);
  const view = viewData(model, { title });
  const holesByOwner = new Map();
  for (const h of model.holes) {
    if (!holesByOwner.has(h.owner)) holesByOwner.set(h.owner, []);
    holesByOwner.get(h.owner).push(h);
  }

  const statCard = (label, value, note = "") =>
    `<div class="stat"><div class="k">${esc(label)}</div><div class="v">${esc(value)}</div>${
      note ? `<div class="n">${esc(note)}</div>` : ""}</div>`;

  const holesSection = model.holes.length === 0
    ? `<p class="ok">Every edge resolved to a target in source. Nothing was guessed and nothing is missing.</p>`
    : `<p class="lede">These are edges whose target could not be determined from source. They are
         <strong>not guessed and not omitted</strong> — they are the places to read by hand.</p>
       <table class="t">
         <thead><tr><th>Entry</th><th>Kind</th><th>Source line</th><th>File</th></tr></thead>
         <tbody>${[...holesByOwner].map(([owner, hs]) => hs.map((h, i) => `
           <tr>
             <td>${i === 0 ? `<code>${esc(owner)}</code>` : ""}</td>
             <td><span class="pill k-${esc(h.kind)}">${esc(h.kind)}</span></td>
             <td><code class="raw">${esc(h.raw)}</code></td>
             <td class="dim">${esc(h.path)}</td>
           </tr>`).join("")).join("")}</tbody>
       </table>`;

  const surfaceSection = surface.length === 0
    ? `<p class="dim">No entry can be fired by a single principal and also change state.</p>`
    : `<p class="lede">Entries that change state and need <strong>at most one principal’s consent</strong>.
         <code>anyone</code> means no access check at all — the most open case there is, so those sort first.</p>
       <table class="t">
         <thead><tr><th>Alone</th><th>Entry</th><th>Effect</th><th class="num">Moves</th><th class="num">Holes</th><th>Where</th></tr></thead>
         <tbody>${surface.map((e) => `
           <tr>
             <td>${e.unguarded ? `<span class="pill anyone">anyone</span>` : `<code class="who">${esc(e.authority)}</code>`}</td>
             <td><a href="#${esc(anchor(e.unit, e.name))}"><code>${esc(e.unit)}.${esc(e.name)}</code></a></td>
             <td><span class="pill f-${esc(e.effect)}">${esc(EFFECT_LABEL[e.effect] ?? e.effect)}</span></td>
             <td class="num">${e.moves}</td>
             <td class="num${e.holes ? " warn" : ""}">${e.holes}</td>
             <td class="dim">${esc(e.path)}:${e.line}</td>
           </tr>`).join("")}</tbody>
       </table>`;

  const entryDetail = (e) => `
    <section class="entry" id="${esc(anchor(e.unit, e.name))}"
       data-name="${esc(`${e.unit}.${e.name}`.toLowerCase())}"
       data-holes="${e.holes}" data-solo="${e.authority.length <= 1 ? 1 : 0}">
      <h4><code>${esc(e.unit)}.${esc(e.name)}</code>
        <span class="pill f-${esc(e.effect)}">${esc(EFFECT_LABEL[e.effect] ?? e.effect)}</span>
        ${e.soloAuthority ? `<span class="pill solo">one principal</span>` : ""}
        ${e.inherited ? `<span class="pill ext">inherited from ${esc(e.inherited)}</span>` : ""}
        ${e.declared ? `<span class="pill ext">declared only</span>` : ""}
        ${e.deployOnly ? `<span class="pill ext">runs once at deployment</span>` : ""}
        ${e.unread?.length ? `<span class="pill warn">relies on unread code: ${esc(e.unread.join(", "))}</span>` : ""}
      </h4>
      <div class="kv"><span>Authority</span><code>${esc(e.authority.join(", ") || "—")}</code></div>
      ${e.returns ? `<div class="kv"><span>Returns</span><code>${esc(e.returns)}</code></div>` : ""}
      <div class="kv"><span>Where</span><code>${esc(e.path)}:${e.line}</code></div>
      ${e.args.length ? `<details><summary>${e.args.length} argument(s)</summary><table class="t sm"><tbody>${
        e.args.map((a) => `<tr><td><code>${esc(a.name)}</code></td><td class="dim"><code>${esc(a.type)}</code></td></tr>`).join("")
      }</tbody></table></details>` : ""}
      ${e.guards.length ? `<details><summary>${e.guards.length} guard(s)</summary><div class="guards">${
        e.guards.map((gd) => `<code class="raw">${esc(gd)}</code>`).join("")
      }</div></details>` : ""}
      ${e.edges.length ? `<details open><summary>${e.edges.length} edge(s)${
        e.holes ? ` — <span class="warn">${e.holes} unresolved</span>` : ""
      }</summary><table class="t sm"><tbody>${
        e.edges.map((x) => `<tr>
          <td><span class="pill k-${esc(x.kind)}">${esc(x.kind)}</span></td>
          <td>${x.resolved
            ? `<a href="#u-${esc(x.target)}"><code>${esc(x.target)}</code></a>${x.external ? ` <span class="pill ext">external</span>` : ""}${
              x.through ? ` <span class="dim">via <code>${esc(x.through)}</code></span>` : ""}`
            : `<span class="hole">could not determine</span>`}</td>
          <td class="dim"><code class="raw">${esc(x.raw)}</code></td>
        </tr>`).join("")
      }</tbody></table></details>` : ""}
      ${e.source ? `<details><summary>source</summary><pre class="src">${esc(e.source)}</pre>
        <p class="dim sm-note">Shown with comments intact. Comments are stripped before parsing and
        were never used to produce anything above.</p></details>` : ""}
    </section>`;

  const unitsSection = model.units.map((u) => `
    <section class="unit" id="u-${esc(u.name)}" data-name="${esc(u.name.toLowerCase())}">
      <h3>${esc(u.name)} <span class="dim">${esc(u.module)}</span></h3>
      <div class="kv"><span>Signatories</span><code>${esc(u.signatories.join(", ") || "—")}</code></div>
      ${u.observers.length ? `<div class="kv"><span>Observers</span><code>${esc(u.observers.join(", "))}</code></div>` : ""}
      ${u.keys.length ? `<div class="kv"><span>Key</span><code>${esc(u.keys.join(", "))}</code></div>` : ""}
      ${u.invariants.length ? `<div class="kv"><span>Invariant</span><code>${esc(u.invariants.join(", "))}</code></div>` : ""}
      <div class="kv"><span>Where</span><code>${esc(u.path)}:${u.line}</code></div>
      ${u.entries.length ? u.entries.map(entryDetail).join("") : `<p class="dim">No entries.</p>`}
    </section>`).join("");

  const graphSection = g.edges.length === 0
    ? `<p class="dim">No resolved edges between units.</p>`
    : `<table class="t">
         <thead><tr><th>From</th><th></th><th>To</th><th>Via</th></tr></thead>
         <tbody>${g.edges.map((e) => `
           <tr>
             <td><a href="#u-${esc(e.from)}"><code>${esc(e.from)}</code></a></td>
             <td><span class="pill k-${esc(e.kind)}">${esc(e.kind)}</span></td>
             <td>${e.external ? `<code>${esc(e.to)}</code> <span class="pill ext">external</span>`
                               : `<a href="#u-${esc(e.to)}"><code>${esc(e.to)}</code></a>`}</td>
             <td class="dim">${esc(e.via.join(", "))}</td>
           </tr>`).join("")}</tbody>
       </table>
       <p class="dim sm-note">Unresolved edges are deliberately absent here — they are in Holes above.
       A graph that quietly drew a guessed target would be worse than one with a gap in it.</p>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<script>document.documentElement.classList.add("js")</script>
<style>
${CLIENT_CSS}
${LISTING_CSS}
</style></head>
<body>
<div id="app"></div>

<main id="code"><div class="wrap">
<noscript><p class="noscript">The interactive map needs JavaScript. Everything it shows is listed below.</p></noscript>
<header class="code-top">
  <h1>${esc(title)}</h1>
  <div class="sub">${esc(folder(model.root))} · ${esc(model.language)}${generatedAt ? ` · ${esc(generatedAt)}` : ""}</div>
</header>

<div class="stats">
  ${statCard("Units", s.units)}
  ${statCard("Entries", s.entries)}
  ${statCard("Edges", s.edges)}
  ${statCard("Resolution", s.resolution === null ? "—" : `${s.resolution}%`, `${s.holes} unresolved`)}
  ${statCard("Fireable alone", s.soloAuthority)}
  ${statCard("End state", s.terminal)}
</div>
<div class="trust">${esc(trustNote(s.resolution))}</div>
${model.notes.map((n) => `<p class="warn">${esc(n)}</p>`).join("")}

<div class="toolbar" data-enhance>
  <input id="q" type="search" placeholder="Filter units and entries…" autocomplete="off" spellcheck="false">
  <label><input type="checkbox" id="only-holes"> only entries with holes</label>
  <label><input type="checkbox" id="only-open"> only fireable by one principal</label>
  <span id="count" class="dim"></span>
</div>

<h2 id="holes">Holes — what could not be determined</h2>
${holesSection}

<h2 id="surface">Surface — what one principal can do alone</h2>
${surfaceSection}

<h2 id="wiring">Wiring</h2>
${graphSection}

<h2 id="units">Units</h2>
<div class="toc">${model.units.map((u) => `<a href="#u-${esc(u.name)}">${esc(u.name)}</a>`).join("")}</div>
${unitsSection}

<footer>
  Generated by <strong>sourcetruth</strong> from source. Comments were stripped before parsing and
  contributed nothing to this report — where source is shown, it is for reading, not evidence.
  Unresolved edges are reported as holes rather than guessed, so a gap here is a gap in what the
  tool could prove, not an assertion that nothing is there.
</footer>
</div></main>

<script type="application/json" id="st-data">${embed(view)}</script>
<script>
// The listing's filter. PROGRESSIVE ENHANCEMENT ONLY: it hides rows that do not match, and reads,
// fetches and computes nothing that is not already printed above.
(function () {
  var q = document.getElementById("q");
  var onlyHoles = document.getElementById("only-holes");
  var onlySolo = document.getElementById("only-open");
  var count = document.getElementById("count");
  var units = [].slice.call(document.querySelectorAll("section.unit"));
  var entries = [].slice.call(document.querySelectorAll("section.entry"));
  var total = entries.length;

  function apply() {
    var term = (q.value || "").trim().toLowerCase();
    var wantHoles = onlyHoles.checked, wantSolo = onlySolo.checked;
    var shown = 0;
    entries.forEach(function (e) {
      var ok = (!term || e.dataset.name.indexOf(term) !== -1)
        && (!wantHoles || Number(e.dataset.holes) > 0)
        && (!wantSolo || e.dataset.solo === "1");
      e.hidden = !ok;
      if (ok) shown++;
    });
    units.forEach(function (u) {
      var anyVisible = [].slice.call(u.querySelectorAll("section.entry")).some(function (e) { return !e.hidden; });
      var unitMatches = !term || u.dataset.name.indexOf(term) !== -1;
      // A unit whose own name matches stays visible even with every entry filtered out, so a
      // search for a contract still shows you that it exists.
      u.hidden = !(anyVisible || (unitMatches && !wantHoles && !wantSolo));
    });
    count.textContent = shown === total ? total + " entries" : shown + " of " + total + " entries";
  }
  [q, onlyHoles, onlySolo].forEach(function (el) {
    el.addEventListener("input", apply);
    el.addEventListener("change", apply);
  });
  // Deep links must survive filtering: if someone arrives at #e-Vault-Close, clear the filter.
  window.addEventListener("hashchange", function () {
    var t = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (t && t.hidden) { q.value = ""; onlyHoles.checked = false; onlySolo.checked = false; apply(); t.scrollIntoView(); }
  });
  apply();
})();
</script>
<script>
try {
${CLIENT_JS}
} catch (err) {
  // A broken map must never leave a blank page: drop back to the listing, which needs no script.
  document.documentElement.classList.remove("js");
  console.error("sourcetruth map failed; showing the listing instead", err);
}
</script>
</body></html>`;
}

export default { render };
