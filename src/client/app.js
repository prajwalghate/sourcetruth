/* sourcetruth — the map, in the browser.
 *
 * This script RENDERS. Every fact it draws — who is outside, what an action touches, whose authority
 * it carries, where each card sits — was computed in Node and embedded as #st-data. It decides
 * nothing about the code, and it fetches nothing.
 *
 * Text that came from source is only ever assigned with textContent. Contract code is full of angle
 * brackets, and a report that parsed it as markup would be the least trustworthy thing on the page.
 */
(() => {
  "use strict";

  const dataEl = document.getElementById("st-data");
  const mount = document.getElementById("app");
  if (!dataEl || !mount) return;

  const D = JSON.parse(dataEl.textContent);
  const U = D.units;
  const G = D.ghosts;
  const E = D.entries;
  const A = D.actors;
  const W = D.card.w;
  const H = D.card.h;
  const NS = "http://www.w3.org/2000/svg";
  const TOUR_KEY = "sourcetruth.tour.v1";
  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const nodeById = new Map([...U, ...G].map((n) => [n.id, n]));
  const actorIndex = new Map(A.map((a, i) => [a.name, i]));
  const bare = (p) => String(p).replace(/^\?/, "");
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ── tiny DOM helpers ────────────────────────────────────────────────────────────────────────────
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k === "style") Object.assign(el.style, v);
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : String(v));
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
    for (const kid of kids.flat()) if (kid) el.append(kid);
    return el;
  }

  const PATHS = {
    create: ["M8 3.2v9.6", "M3.2 8h9.6"],
    destroy: ["M4.3 4.3l7.4 7.4", "M11.7 4.3l-7.4 7.4"],
    call: ["M4.6 11.4l6.8-6.8", "M6.2 4.6h5.2v5.2"],
    read: ["M1.7 8s2.3-4.3 6.3-4.3S14.3 8 14.3 8s-2.3 4.3-6.3 4.3S1.7 8 1.7 8z", "M8 9.7a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4z"],
    blind: ["M6.3 6.2a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.8-.9 1.4v.2", "M8 11.5v.1"],
    none: ["M12.7 6.2A5 5 0 1 0 13 9.2", "M13.2 2.8v3.4H9.8"],
    transition: ["M2.8 5.7h9l-2.3-2.3", "M13.2 10.3h-9l2.3 2.3"],
    terminal: ["M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z", "M6 6l4 4", "M10 6l-4 4"],
    back: ["M9.8 3.8L5.6 8l4.2 4.2"],
    chev: ["M6.2 3.8L10.4 8l-4.2 4.2"],
    code: ["M5.6 4.2L2 8l3.6 3.8", "M10.4 4.2L14 8l-3.6 3.8"],
    fit: ["M2.6 6V2.6H6", "M10 2.6h3.4V6", "M13.4 10v3.4H10", "M6 13.4H2.6V10"],
    plus: ["M8 3.5v9", "M3.5 8h9"],
    minus: ["M3.5 8h9"],
    stamp: ["M5.7 2.3h4.6v3.1L8.9 7.2H7.1L5.7 5.4z", "M2.8 9.4h10.4v3.9H2.8z"],
    arrow: ["M2.5 8h11", "M9.5 4l4 4-4 4"],
    down: ["M8 2.8v10.4", "M4.2 9.4L8 13.2l3.8-3.8"],
    map: ["M2.5 4l3.8-1.5 3.4 1.5 3.8-1.5v9.5l-3.8 1.5-3.4-1.5-3.8 1.5z", "M6.3 2.5V12", "M9.7 4v9.5"],
    learn: ["M1.8 5.2L8 2.6l6.2 2.6L8 7.8z", "M4.4 6.4v3.4c0 1 1.6 2.1 3.6 2.1s3.6-1.1 3.6-2.1V6.4"],
    tour: ["M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z", "M6.8 5.6l3.4 2.4-3.4 2.4z"],
    mark: ["M5.2 2.8H3v10.4h2.2", "M10.8 2.8H13v10.4h-2.2", "M8 9.3a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6z"],
  };
  function icon(name, extra = "") {
    if (name === "play" || name === "replay") {
      const el = s("svg", { class: `i solid ${extra}`, viewBox: "0 0 16 16", "aria-hidden": "true" });
      el.append(s("path", { d: name === "play" ? "M5 3.1v9.8l7.9-4.9z" : "M8 2.2a5.8 5.8 0 1 1-5.5 4h1.8A4.1 4.1 0 1 0 8 3.9V6L4.9 3.1 8 .2z" }));
      return el;
    }
    const el = s("svg", { class: `i ${extra}`, viewBox: "0 0 16 16", "aria-hidden": "true" });
    if (name === "blind") el.append(s("circle", { cx: 8, cy: 8, r: 6.1, "stroke-dasharray": "2 2.1" }));
    for (const d of PATHS[name] ?? []) el.append(s("path", { d }));
    return el;
  }

  // ── people and their chips ──────────────────────────────────────────────────────────────────────
  const actorOf = (name) => A[actorIndex.get(bare(name))];
  function initial(name) {
    const a = actorOf(name);
    if (a?.anyone) return "*";
    if (a?.unseen) return "?";
    if (a?.expr) return "ƒ";
    return bare(name).replace(/^[^A-Za-z0-9]+/, "").charAt(0) || "?";
  }
  function avatar(name) {
    return h("span", { class: "avatar", "aria-hidden": "true", text: initial(name) });
  }
  function chip(name) {
    const a = actorOf(name);
    let cls = "chip";
    if (a?.anyone) cls += " anyone";
    else if (a && a.side === "outside") cls += " outside";
    if (String(name).startsWith("?")) cls += " optional";
    if (a?.expr) cls += " expr";
    const title = a?.anyone ? "No access check: anyone can call this"
      : a?.expr ? "An expression, not a named party — who this is is decided when the code runs"
      : String(name).startsWith("?") ? `${bare(name)} — only when configured`
      : a ? (a.side === "outside" ? `${a.name} — outside the protocol` : `${a.name} — inside the protocol`) : null;
    return h("span", { class: cls, title }, avatar(name), bare(name));
  }
  function whoChips(e) {
    if (e.anyone) return [chip("anyone")];
    if (e.unseen) return [h("span", { class: "chip", title: "The controller could not be read from source" }, avatar("(unreadable)"), "unreadable")];
    return e.auth.map((p) => chip(p));
  }
  const stamp = (p, cls = "") => h("span", { class: `stamp ${cls}`, text: p });

  // ── state ───────────────────────────────────────────────────────────────────────────────────────
  const S = { view: "map", sel: null, hist: [], trail: [], playing: null };
  const same = (a, b) => a && b && a.t === b.t && a.i === b.i && a.id === b.id;

  // ── shell ───────────────────────────────────────────────────────────────────────────────────────
  const tabsEl = h("nav", { class: "tabs", "aria-label": "Views" });
  const topEl = h("header", { class: "top" });
  const peopleEl = h("aside", { class: "people", "aria-label": "Who can act" });
  const mapEl = h("div", { class: "map", role: "application", "aria-label": "Contract map" });
  const inspEl = h("aside", { class: "inspect", "aria-live": "polite", "aria-label": "Details" });
  const learnEl = h("section", { class: "learn", hidden: true, "aria-label": "How to read this" });
  mount.className = "app";
  mount.append(topEl, peopleEl, mapEl, inspEl, learnEl);

  function renderTop() {
    const tab = (view, label, ic) => h("button", {
      class: "tab", "data-view": view, "aria-selected": String(S.view === view), onclick: () => setView(view),
    }, icon(ic), " ", label);
    tabsEl.replaceChildren(tab("map", "Map", "map"), tab("learn", "Learn", "learn"), tab("code", "Code", "code"));
    const st = D.stats;
    // Declarations and constructors are not actions anyone takes; the count says what the map shows.
    const callable = E.filter((e) => !e.declared && !e.deployOnly).length;
    const traced = st.resolution == null ? 100 : st.resolution;
    topEl.replaceChildren(
      h("div", { class: "brand" },
        h("span", { class: "brand-mark", "aria-hidden": "true" }, icon("mark")),
        h("span", { class: "brand-name", text: "sourcetruth" }),
        h("span", { class: "brand-title", text: D.title, title: D.title })),
      tabsEl,
      h("div", { class: "top-right" },
        h("span", { class: "counts" }, h("b", { text: String(st.units) }), ` contract${st.units === 1 ? "" : "s"} · `,
          h("b", { text: String(callable) }), ` action${callable === 1 ? "" : "s"}`),
        h("span", { class: "trace", title: `${traced}% of links between contracts could be traced from source` },
          h("span", { class: "trace-bar", "aria-hidden": "true" }, h("span", { style: { width: `${traced}%` } })),
          `${traced}% traced`),
        st.holes > 0 ? h("button", {
          class: "btn blind", onclick: () => { setView("map"); select({ t: "blind" }); },
          title: "Links the tool could not trace. It does not guess them.",
        }, icon("blind"), plural(st.holes, "blind spot")) : null,
        h("button", { class: "btn", onclick: () => startTour() }, icon("tour"), "Tour")),
    );
  }

  function setView(view) {
    S.view = view;
    document.documentElement.classList.toggle("view-code", view === "code");
    learnEl.hidden = view !== "learn";
    for (const b of tabsEl.querySelectorAll(".tab")) b.setAttribute("aria-selected", String(b.dataset.view === view));
    if (view === "code") window.scrollTo(0, 0);
    if (view === "map" && !fitted) requestAnimationFrame(() => home(false));
  }

  // ── the map ─────────────────────────────────────────────────────────────────────────────────────
  const world = h("div", { class: "world" });
  const linksSvg = s("svg", { class: "links", width: D.size.w, height: D.size.h + 80 });
  const fxSvg = s("svg", { class: "fx", width: D.size.w, height: D.size.h + 80 });
  const tokenLayer = h("div", { style: { position: "absolute", left: "0", top: "0" } });
  const cardById = new Map();
  const linkEls = [];
  const view = { x: 0, y: 0, k: 1 };
  let fitted = false;
  let dragMoved = false;

  function marker(id, cls) {
    return s("marker", { id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" },
      s("path", { d: "M0,0 L10,5 L0,10 z", class: cls }));
  }
  function curve(a, b) {
    const sx = a.x + W, sy = a.y + H / 2, tx = b.x, ty = b.y + H / 2;
    if (tx >= sx + 12) {
      const c = Math.max(36, (tx - sx) * 0.5);
      return `M${sx},${sy} C${sx + c},${sy} ${tx - c},${ty} ${tx},${ty}`;
    }
    // Backwards, or in the same column: loop underneath rather than drawing through the cards.
    const bx = a.x + W * 0.62, by = a.y + H, ex = b.x + W * 0.38, ey = b.y + H;
    const dip = Math.max(by, ey) + 42;
    return `M${bx},${by} C${bx},${dip} ${ex},${dip} ${ex},${ey}`;
  }

  function buildMap() {
    if (U.length === 0) {
      mapEl.append(h("div", { class: "map-empty", text: D.notes[0] || "No contracts found under this path." }));
      return;
    }
    const defs = s("defs", null,
      marker("m-base", "arrow-head"),
      s("marker", { id: "m-lit", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" },
        s("path", { d: "M0,0 L10,5 L0,10 z", style: "fill: var(--flow)" })));
    linksSvg.append(defs);
    for (const l of D.links) {
      const a = nodeById.get(l.from);
      const b = nodeById.get(l.to);
      if (!a || !b || a.x == null || b.x == null) continue;
      const via = l.via.map((i) => `${U[E[i].unit].name}.${E[i].name}`);
      const p = s("path", { class: `link ${l.k}`, d: curve(a, b), "marker-end": "url(#m-base)" });
      const t = s("title");
      t.textContent = `${via.join(", ")} ${l.k === "create" ? "creates" : "calls"} ${b.name}`;
      p.append(t);
      linksSvg.append(p);
      linkEls.push({ el: p, l });
    }
    world.append(linksSvg);
    if (D.size.standaloneTop > 0) {
      world.append(h("div", {
        class: "standalone-label", style: { left: "2px", top: `${D.size.standaloneTop - 24}px` },
        text: "Standalone", title: "Nothing in this code creates or calls these, and they create or call nothing",
      }));
    }
    for (const u of U) if (u.x != null) world.append(cardEl(u));
    for (const g of G) if (g.x != null) world.append(cardEl(g));
    world.append(fxSvg, tokenLayer);
    mapEl.append(world,
      h("div", { class: "legend", "aria-hidden": "true" },
        h("span", null, legendLine(false), "creates"),
        h("span", null, legendLine(true), "calls"),
        G.some((g) => g.x != null) ? h("span", null, h("span", { class: "lg-box" }), "outside this code") : null),
      h("div", { class: "map-tools" },
        h("button", { class: "btn", title: "Zoom in", "aria-label": "Zoom in", onclick: () => zoomBy(1.2) }, icon("plus")),
        h("button", { class: "btn", title: "Zoom out", "aria-label": "Zoom out", onclick: () => zoomBy(1 / 1.2) }, icon("minus")),
        h("button", { class: "btn", title: "Fit to screen", "aria-label": "Fit to screen", onclick: () => fit(true) }, icon("fit"))));
    wireMap();
  }
  function legendLine(dashed) {
    return s("svg", { viewBox: "0 0 26 10" },
      s("path", { d: "M1 5h19", style: `stroke: var(--line-strong); stroke-width: 1.6; fill: none;${dashed ? " stroke-dasharray: 4 3;" : ""}` }),
      s("path", { d: "M18 1.5 L25 5 L18 8.5 z", style: "fill: var(--line-strong)" }));
  }

  function cardEl(n) {
    const ghost = Boolean(n.ghost);
    const el = h("button", {
      class: `card${ghost ? " ghost" : ""}`, style: { left: `${n.x}px`, top: `${n.y}px` }, "data-id": n.id,
      "aria-label": ghost ? `${n.name}, defined outside this code` : `${n.name}, ${plural(n.actions, "action")}`,
      onclick: () => { if (dragMoved) return; select(ghost ? { t: "ghost", id: n.id } : { t: "unit", i: n.i }); },
    },
    h("span", { class: "card-name", text: n.name, title: n.name }),
    h("span", { class: "card-signers" },
      ghost ? h("span", { class: "card-kind muted", text: "outside this code" })
        : n.signers.length ? n.signers.map((p) => stamp(p)) : h("span", { class: "card-kind muted", text: n.kind })),
    h("span", { class: "card-foot" },
      ghost ? null : h("span", { text: plural(n.actions, "action") }),
      !ghost && n.holes ? h("span", { class: "qbadge", title: plural(n.holes, "blind spot") }, icon("blind"), String(n.holes)) : null));
    cardById.set(n.id, el);
    return el;
  }

  function applyView(glide) {
    world.classList.toggle("glide", Boolean(glide) && !reduceMotion());
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  }
  function fit(glide) {
    const r = mapEl.getBoundingClientRect();
    if (!r.width || !r.height || !D.size.w) return;
    const pad = 56;
    const k = clamp(Math.min((r.width - pad * 2) / D.size.w, (r.height - pad * 2 - 30) / (D.size.h + 40)), 0.28, 1.05);
    view.k = k;
    view.x = (r.width - D.size.w * k) / 2;
    view.y = Math.max(pad * 0.6, (r.height - D.size.h * k) / 2 - 16);
    applyView(glide);
    fitted = true;
  }
  /**
   * The opening view. If the whole protocol can be drawn at a size you can read, draw all of it.
   * Otherwise start where the risk is — the riskiest outside action's contract and what it makes and
   * calls — at a readable zoom, and leave the whole picture one click away on Fit. A complete map
   * at 28% is a picture of boxes, and shows nothing.
   */
  function home(glide) {
    const r = mapEl.getBoundingClientRect();
    if (!r.width || !r.height || !D.size.w) return;
    const pad = 56;
    const whole = Math.min((r.width - pad * 2) / D.size.w, (r.height - pad * 2 - 30) / (D.size.h + 40));
    if (whole >= 0.62) { fit(glide); return; }
    const door = D.doors.length ? E[D.doors[0]] : null;
    const ids = door
      ? [`u${door.unit}`, ...door.steps.filter((st) => st.to && (st.k === "create" || st.k === "call")).map((st) => st.to)]
      : [U[0].id];
    const ns = ids.map((id) => nodeById.get(id)).filter((n) => n && n.x != null);
    const minX = Math.min(...ns.map((n) => n.x)), minY = Math.min(...ns.map((n) => n.y));
    const maxX = Math.max(...ns.map((n) => n.x + W)), maxY = Math.max(...ns.map((n) => n.y + H));
    const k = clamp(Math.min((r.width - 110) / (maxX - minX), (r.height - 150) / (maxY - minY)), 0.62, 0.95);
    view.k = k;
    view.x = r.width / 2 - ((minX + maxX) / 2) * k;
    view.y = (r.height - 40) / 2 - ((minY + maxY) / 2) * k;
    applyView(glide);
    fitted = true;
  }
  function zoomBy(f, cx, cy) {
    const r = mapEl.getBoundingClientRect();
    const px = cx ?? r.width / 2, py = cy ?? r.height / 2;
    const k = clamp(view.k * f, 0.22, 2.2);
    view.x = px - (px - view.x) * (k / view.k);
    view.y = py - (py - view.y) * (k / view.k);
    view.k = k;
    applyView(false);
  }
  /** Bring these cards into view, zooming out only if they cannot all fit at the current zoom. */
  function frame(ids) {
    const ns = ids.map((id) => nodeById.get(id)).filter((n) => n && n.x != null);
    const r = mapEl.getBoundingClientRect();
    if (!ns.length || !r.width) return;
    const minX = Math.min(...ns.map((n) => n.x)), minY = Math.min(...ns.map((n) => n.y));
    const maxX = Math.max(...ns.map((n) => n.x + W)), maxY = Math.max(...ns.map((n) => n.y + H));
    const m = 60;
    const inside = view.x + minX * view.k >= m && view.y + minY * view.k >= m
      && view.x + maxX * view.k <= r.width - m && view.y + maxY * view.k <= r.height - m;
    if (inside) return;
    // Zoom out to fit only as far as a card stays legible. Past that, centre on the first id — the
    // thing selected — and let the highlighted lines lead off-screen to the rest.
    const need = Math.min((r.width - m * 2) / (maxX - minX), (r.height - m * 2) / (maxY - minY));
    const k = Math.max(0.58, Math.min(view.k < 0.58 ? 0.75 : view.k, need));
    const focus = need >= 0.58 ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : { x: ns[0].x + W / 2, y: ns[0].y + H / 2 };
    view.k = k;
    view.x = r.width / 2 - focus.x * k;
    view.y = r.height / 2 - focus.y * k;
    applyView(true);
  }

  function wireMap() {
    let drag = null;
    mapEl.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      drag = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y };
      dragMoved = false;
    });
    window.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!dragMoved && Math.hypot(dx, dy) < 5) return;
      dragMoved = true;
      mapEl.classList.add("dragging");
      view.x = drag.vx + dx;
      view.y = drag.vy + dy;
      applyView(false);
    });
    window.addEventListener("pointerup", () => {
      if (!drag) return;
      drag = null;
      mapEl.classList.remove("dragging");
      setTimeout(() => { dragMoved = false; }, 0);
    });
    mapEl.addEventListener("click", (ev) => {
      if (!dragMoved && (ev.target === mapEl || ev.target === world)) select(null);
    });
    mapEl.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const r = mapEl.getBoundingClientRect();
      if (ev.ctrlKey || ev.metaKey) zoomBy(Math.exp(-ev.deltaY * 0.0085), ev.clientX - r.left, ev.clientY - r.top);
      else { view.x -= ev.deltaX; view.y -= ev.deltaY; applyView(false); }
    }, { passive: false });
    window.addEventListener("resize", () => { if (!S.sel) home(false); });
  }

  // ── what an action does, as steps ───────────────────────────────────────────────────────────────
  /** The consuming effect is implicit in Daml, so it is shown as the first step rather than left out. */
  function txSteps(e) {
    const own = `u${e.unit}`;
    const out = [];
    if (D.daml && e.effect !== "none") out.push({ k: "destroy", to: own, name: U[e.unit].name, consumed: true, n: 1 });
    if (!D.daml && e.effect === "transition") out.push({ k: "write", to: own, name: U[e.unit].name, n: 1 });
    for (const st of e.steps) out.push(st);
    return out;
  }
  /** Archives, creates, calls and blind spots — the steps that can change something — in source order. */
  const changes = (e) => txSteps(e).filter((st) => st.k !== "read");
  const readsOf = (e) => txSteps(e).filter((st) => st.k === "read");
  function verb(st, e) {
    if (st.k === "destroy") return st.consumed ? "archived — consumed by this action" : "archived";
    if (st.k === "create") return st.to === `u${e.unit}` ? "new version made" : "created";
    if (st.k === "call") return D.daml ? "action exercised" : "called";
    if (st.k === "read") return D.daml ? "fetched" : "read";
    if (st.k === "write") return "its storage can change";
    if (st.eth) return `sends ETH to ${st.recv ?? "an address"} — can't follow the receiver`;
    if (st.low) return `low-level ${st.low}${st.lib ? ` via ${st.lib}` : ""} — the target can't be named`;
    if (st.recv) return `couldn't tell what ${st.recv} is — read this line`;
    return "couldn't trace — read this line";
  }
  const KIND_ICON = { create: "create", destroy: "destroy", call: "call", read: "read", blind: "blind", write: "transition" };
  const TAG = { create: "made", destroy: "archived", call: "called", read: "read", blind: "?", write: "writes" };

  function tag(card, kind, text) {
    if (!card) return;
    let box = card.querySelector(".hit-tags");
    if (!box) {
      box = h("span", { class: "hit-tags", style: { position: "absolute", top: "-11px", right: "8px", display: "flex", gap: "4px" } });
      card.append(box);
    }
    if (box.querySelector(`[data-k="${kind}"]`)) return;
    box.append(h("span", { class: `hit-tag ${kind === "write" ? "call" : kind}`, "data-k": kind, style: { position: "static" } },
      icon(KIND_ICON[kind]), text));
  }
  function linkFor(from, to, kind) {
    return linkEls.find((x) => x.l.from === from && x.l.to === to && (!kind || x.l.k === kind));
  }
  function fxPath(from, to, cls) {
    const a = nodeById.get(from), b = nodeById.get(to);
    if (!a || !b || a.x == null || b.x == null || a === b) return;
    fxSvg.append(s("path", { class: cls, d: curve(a, b) }));
  }
  function applyStep(e, st, live) {
    const from = `u${e.unit}`;
    const card = st.to ? cardById.get(st.to) : null;
    if (st.k === "blind") { tag(cardById.get(from), "blind", TAG.blind); return; }
    if (card) {
      card.classList.add(st.k === "write" ? "hit-call" : `hit-${st.k === "destroy" ? "destroy" : st.k}`);
      tag(card, st.k, TAG[st.k]);
    }
    if (st.k === "create" || st.k === "call") {
      const link = linkFor(from, st.to, st.k);
      if (link) {
        link.el.classList.add(live ? `run-${st.k}` : "lit");
        link.el.setAttribute("marker-end", "url(#m-lit)");
      } else if (st.to && st.to !== from) fxPath(from, st.to, st.k === "call" ? "fx-call" : "fx-read");
    }
    if (st.k === "read" && st.to && st.to !== from) fxPath(from, st.to, "fx-read");
  }

  function clearMap() {
    for (const el of cardById.values()) {
      el.classList.remove("on", "lit", "hit-create", "hit-destroy", "hit-call", "hit-read");
      el.querySelector(".hit-tags")?.remove();
    }
    for (const { el } of linkEls) {
      el.classList.remove("lit", "run-create", "run-call");
      el.setAttribute("marker-end", "url(#m-base)");
    }
    fxSvg.replaceChildren();
    tokenLayer.replaceChildren();
  }

  function paintMap() {
    clearMap();
    const sel = S.sel;
    mapEl.classList.toggle("focus", Boolean(sel) && sel.t !== "blind");
    if (!sel) return;
    const on = new Set();
    const lit = new Set();
    const litLink = (x) => { x.el.classList.add("lit"); x.el.setAttribute("marker-end", "url(#m-lit)"); };
    if (sel.t === "actor") {
      const a = A[sel.i];
      for (const i of a.entries) {
        on.add(`u${E[i].unit}`);
        for (const st of E[i].steps) if (st.to && (st.k === "create" || st.k === "call")) lit.add(st.to);
      }
      for (const x of linkEls) if (x.l.via.some((i) => a.entries.includes(i))) litLink(x);
    } else if (sel.t === "unit" || sel.t === "ghost") {
      const id = sel.t === "unit" ? `u${sel.i}` : sel.id;
      on.add(id);
      for (const x of linkEls) if (x.l.from === id || x.l.to === id) { litLink(x); lit.add(x.l.from); lit.add(x.l.to); }
    } else if (sel.t === "entry") {
      const e = E[sel.i];
      on.add(`u${e.unit}`);
      for (const st of e.steps) if (st.to) lit.add(st.to);
      if (S.playing !== e.i) {
        for (const st of txSteps(e)) applyStep(e, st, false);
        addToken(e);
      }
    }
    for (const id of on) cardById.get(id)?.classList.add("on");
    for (const id of lit) if (!on.has(id)) cardById.get(id)?.classList.add("lit");
  }

  function addToken(e) {
    const own = U[e.unit];
    if (own.x == null) return;
    const names = e.anyone ? ["anyone"] : e.unseen ? ["(unreadable)"] : e.auth.map(bare);
    tokenLayer.replaceChildren(h("div", {
      class: `token${e.anyone ? " anyone" : ""}`, style: { left: `${own.x}px`, top: `${own.y - 34}px`, maxWidth: `${W * 1.6}px`, overflow: "hidden", textOverflow: "ellipsis" },
    }, avatar(names[0]), `${names.join(" + ")} → ${e.name}`));
  }

  // ── play ────────────────────────────────────────────────────────────────────────────────────────
  let timers = [];
  function stopPlay() {
    for (const t of timers) clearTimeout(t);
    timers = [];
    S.playing = null;
  }
  function play(i) {
    stopPlay();
    const e = E[i];
    if (!same(S.sel, { t: "entry", i })) select({ t: "entry", i }, { trail: "keep", center: false });
    S.playing = i;
    paintMap();
    const steps = changes(e);
    const rows = [...inspEl.querySelectorAll(".tx.changes .row")];
    const btn = inspEl.querySelector(".play");
    frame([`u${e.unit}`, ...steps.map((st) => st.to).filter(Boolean)]);
    addToken(e);
    const reads = readsOf(e);
    const quick = reduceMotion();
    rows.forEach((r) => r.classList.add("pending"));
    if (btn) btn.replaceChildren(icon("play"), "Playing…");
    const gap = 820;
    steps.forEach((st, k) => {
      const run = () => {
        rows.forEach((r, j) => {
          r.classList.toggle("now", j === k && !quick);
          if (j <= k) r.classList.remove("pending");
        });
        applyStep(e, st, !quick);
        rows[k]?.scrollIntoView({ block: "nearest", behavior: quick ? "auto" : "smooth" });
      };
      if (quick) run(); else timers.push(setTimeout(run, 650 + k * gap));
    });
    const done = () => {
      for (const st of reads) applyStep(e, st, false);
      rows.forEach((r) => r.classList.remove("now", "pending"));
      S.playing = null;
      if (btn) btn.replaceChildren(icon("replay"), "Play again");
    };
    if (quick) done(); else timers.push(setTimeout(done, 650 + steps.length * gap + 500));
  }

  // ── selection ───────────────────────────────────────────────────────────────────────────────────
  function select(sel, opts = {}) {
    stopPlay();
    if (!sel && S.sel) requestAnimationFrame(() => home(true));
    if (opts.push !== false && S.sel && !same(S.sel, sel)) S.hist.push(S.sel);
    if (!sel) S.hist = [];
    S.sel = sel;
    if (sel && sel.t === "entry") {
      if (opts.trail === "continue") S.trail = [...S.trail.filter((x) => x !== sel.i), sel.i];
      else if (typeof opts.trail === "number") S.trail = S.trail.slice(0, opts.trail + 1);
      else if (opts.trail !== "keep") S.trail = [sel.i];
    }
    renderPeople();
    renderInspector();
    paintMap();
    if (sel && opts.center !== false) frameSelection();
  }
  function frameSelection() {
    const sel = S.sel;
    if (!sel) return;
    if (sel.t === "entry") frame([`u${E[sel.i].unit}`, ...changes(E[sel.i]).map((x) => x.to).filter(Boolean)]);
    else if (sel.t === "unit") frame([`u${sel.i}`]);
    else if (sel.t === "ghost") frame([sel.id]);
    else if (sel.t === "actor") frame([...new Set(A[sel.i].entries.map((i) => `u${E[i].unit}`))]);
  }
  function goBack() {
    const prev = S.hist.pop() ?? null;
    select(prev, { push: false, trail: "keep" });
  }

  // ── people rail ─────────────────────────────────────────────────────────────────────────────────
  function renderPeople() {
    const person = (a, i) => h("button", {
      class: `person ${a.side}${a.anyone ? " anyone" : ""}${a.unseen ? " unseen" : ""}${a.expr ? " expr" : ""}`,
      "data-actor": i, "aria-pressed": String(S.sel?.t === "actor" && S.sel.i === i),
      title: a.side === "outside" ? `${a.name} can act without the protocol's own parties` : `${a.name} runs the protocol, or only acts with it`,
      onclick: () => select(S.sel?.t === "actor" && S.sel.i === i ? null : { t: "actor", i }),
    },
    avatar(a.name),
    h("span", { class: "person-name mono", text: a.name === "(unreadable)" ? "unreadable" : a.name }),
    a.side === "outside" && a.borrows ? h("span", { class: "pdot", title: "Carries authority it does not hold itself" }) : null,
    h("span", { class: "person-n", text: String(a.entries.length) }));
    const outside = A.map((a, i) => [a, i]).filter(([a]) => a.side === "outside");
    const insiders = A.map((a, i) => [a, i]).filter(([a]) => a.side === "inside");
    peopleEl.replaceChildren(
      h("div", { class: "label", title: "Can act without any of the protocol's own parties" }, "Outside"),
      outside.length ? h("div", { class: "group" }, outside.map(([a, i]) => person(a, i)))
        : h("div", { class: "row-sub", style: { padding: "0 8px" }, text: "No one" }),
      h("div", { class: "label", title: "Runs the protocol, or only ever acts alongside it" }, "Inside"),
      h("div", { class: "group" }, insiders.map(([a, i]) => person(a, i))),
    );
  }

  // ── inspector building blocks ───────────────────────────────────────────────────────────────────
  function powerMark(e) {
    return h("span", { class: "power-mark", title: `Runs with the authority of ${e.borrowed.join(", ")}` }, icon("stamp"));
  }
  function entryRow(i, opts = {}) {
    const e = E[i];
    return h("button", {
      class: `row${opts.cls ? ` ${opts.cls}` : ""}`, "data-entry": i,
      onclick: opts.onclick ?? (() => select({ t: "entry", i }, { trail: opts.trail ?? "reset" })),
    },
    h("span", { class: `fx-icon ${e.effect}`, title: D.labels[e.effect] }, icon(e.effect)),
    h("span", { class: "row-main" },
      h("span", { class: "row-title mono", text: e.name, title: `${U[e.unit].name}.${e.name}` }),
      h("span", { class: "row-sub" },
        h("span", { class: "chips", style: { display: "inline-flex", verticalAlign: "middle" } }, whoChips(e)),
        opts.unit === false ? null : [" on ", h("span", { class: "mono", text: U[e.unit].name })],
        opts.thr ? h("span", { class: "thr" }, " via ", h("span", { class: "mono", text: opts.thr })) : null)),
    h("span", { class: "row-marks" },
      e.alone && e.borrowed.length ? powerMark(e) : null,
      e.holes ? h("span", { class: "qmark", title: plural(e.holes, "blind spot") }, icon("blind")) : null));
  }
  function fold(title, body, open = false) {
    return h("details", { class: "fold", open }, h("summary", null, icon("chev"), title), body);
  }
  function backBtn() {
    return S.hist.length ? h("button", { class: "back", onclick: goBack }, icon("back"), "Back")
      : h("button", { class: "back", onclick: () => select(null) }, icon("back"), "Start");
  }
  function codeButton(anchor) {
    return h("button", { class: "btn", onclick: () => openCode(anchor) }, icon("code"), "Code");
  }
  function openCode(anchor) {
    setView("code");
    const target = document.getElementById(anchor);
    if (target) {
      if (location.hash !== `#${anchor}`) location.hash = anchor;
      requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
    }
  }
  function sourceOf(e) {
    const sec = document.getElementById(e.anchor);
    const pre = sec?.querySelector("pre.src");
    return pre ? pre.textContent : null;
  }

  // ── inspector panels ────────────────────────────────────────────────────────────────────────────
  function renderInspector() {
    const sel = S.sel;
    let body;
    if (!sel) body = homePanel();
    else if (sel.t === "actor") body = actorPanel(A[sel.i]);
    else if (sel.t === "unit") body = unitPanel(U[sel.i]);
    else if (sel.t === "ghost") body = ghostPanel(nodeById.get(sel.id));
    else if (sel.t === "entry") body = entryPanel(E[sel.i]);
    else if (sel.t === "blind") body = blindPanel();
    inspEl.replaceChildren(...[body].flat().filter(Boolean));
    inspEl.scrollTop = 0;
  }

  let showAllDoors = false;
  function homePanel() {
    const limit = showAllDoors ? D.doors.length : 7;
    return [
      h("p", { class: "hero-q", text: "Where can someone outside get in?" }),
      D.doors.length
        ? h("p", { class: "sub", text: `${plural(D.doors.length, "action")} they can take alone — riskiest first.` })
        : h("p", { class: "sub", text: "No action here can be taken by someone outside on their own." }),
      h("div", { class: "rows" }, D.doors.slice(0, limit).map((i) => entryRow(i, { cls: "door" }))),
      D.doors.length > limit ? h("button", {
        class: "more", onclick: () => { showAllDoors = true; renderInspector(); },
      }, `Show all ${D.doors.length}`) : null,
      ...D.notes.map((n) => h("p", { class: "strip blind", text: n })),
      h("div", { class: "tour-card" },
        h("p", { text: "Not sure where to start?" }),
        h("div", { class: "btns" },
          h("button", { class: "btn primary", onclick: () => startTour() }, icon("tour"), "Show me how"),
          h("button", { class: "btn", onclick: () => setView("learn") }, icon("learn"), D.daml ? "Daml in pictures" : "Solidity in pictures"))),
    ];
  }

  function actorPanel(a) {
    const byUnit = new Map();
    for (const i of a.entries) {
      if (!byUnit.has(E[i].unit)) byUnit.set(E[i].unit, []);
      byUnit.get(E[i].unit).push(i);
    }
    return [
      backBtn(),
      h("div", { class: "who-line" }, chip(a.name === "(unreadable)" ? "(unreadable)" : a.name),
        h("span", { class: "muted", text: a.side === "outside" ? "outside the protocol" : "inside the protocol" })),
      h("p", { class: "sub", text: `${plural(a.entries.length, "action")} on ${plural(byUnit.size, "contract")}` }),
      ...[...byUnit].map(([ui, list]) => h("div", { class: "section" },
        h("div", { class: "label" },
          h("button", { class: "unit-link", onclick: () => select({ t: "unit", i: ui }), text: U[ui].name })),
        h("div", { class: "rows" }, list
          .sort((x, y) => E[y].risk - E[x].risk)
          .map((i) => entryRow(i, { unit: false, trail: "reset" }))))),
    ];
  }

  function unitPanel(u) {
    const life = D.life[u.i];
    const own = E.filter((e) => e.unit === u.i);
    const repeatable = own.filter((e) => e.effect === "none");
    const rowsOf = (list, empty) => list.length
      ? h("div", { class: "rows" }, list.map((x) => entryRow(x.e ?? x.i, { thr: x.thr })))
      : h("div", { class: "empty", text: empty });
    const closedElsewhere = life.archived.length > 0;
    return [
      backBtn(),
      h("div", { class: "label", style: { margin: "0 0 4px" }, text: D.daml ? "Contract" : u.kind }),
      h("p", { class: "h big", text: u.name }),
      h("div", { class: "on-line" },
        u.signers.length ? [h("span", { text: "signed by" }), ...u.signers.map((p) => stamp(p))] : null,
        h("span", { class: "muted", text: `${u.path}:${u.line}` })),
      h("div", { class: "actions-bar" }, codeButton(u.anchor)),
      h("div", { class: "life" },
        h("div", { class: "stage" },
          h("div", { class: "stage-head" }, icon("create"), "Made by"),
          rowsOf(life.made, "Nothing in this code makes it")),
        h("div", { class: "joint", "aria-hidden": "true" }, icon("down")),
        h("div", { class: "stage core" },
          h("div", { class: "stage-head" }, icon("transition"), D.daml ? "Replaced by" : "Changed by"),
          rowsOf([...life.changed, ...life.replaced], D.daml ? "Nothing replaces it — once made it stays as it is" : "Nothing changes it"),
          repeatable.length ? [
            h("div", { class: "stage-head", style: { marginTop: "10px" } }, icon("none"), "Repeatable on it"),
            rowsOf(repeatable.map((e) => ({ e: e.i })), ""),
          ] : null),
        h("div", { class: "joint", "aria-hidden": "true" }, icon("down")),
        h("div", { class: "stage" },
          h("div", { class: "stage-head" }, icon("terminal"), "Ended by"),
          life.ended.length ? rowsOf(life.ended, "") : null,
          closedElsewhere ? [
            h("div", { class: "row-sub", style: { margin: "6px 2px 2px" }, text: "archived from another contract:" }),
            rowsOf(life.archived, ""),
          ] : null,
          // The tool cannot see branches. An action that archives this contract and creates one may
          // do both every time — or create only on some paths and END it on the rest. A real
          // pool's withdraw does exactly that (`create … if createResidual`), and a card that
          // listed it only under "Replaced by" said a full withdrawal never ends a position.
          life.replaced.length ? [
            h("div", { class: "row-sub", style: { margin: "6px 2px 2px" }, text: "archive it, and may not make a new one:" }),
            rowsOf(life.replaced, ""),
          ] : null,
          life.ended.length || closedElsewhere || life.replaced.length ? null
            : h("div", { class: `strip ${life.changed.length || repeatable.length ? "warn" : ""}`, style: { margin: "2px 0" } },
              icon("terminal"), "Nothing in this code ends it"))),
      life.read.length ? fold(`Read by · ${life.read.length}`, rowsOf(life.read, "")) : null,
    ];
  }

  function ghostPanel(g) {
    const touching = E.filter((e) => e.steps.some((st) => st.to === g.id));
    return [
      backBtn(),
      h("div", { class: "label", style: { margin: "0 0 4px" }, text: "Outside this code" }),
      h("p", { class: "h big", text: g.name }),
      h("p", { class: "sub", text: "Defined in a dependency — the tool can see who uses it, not what it does." }),
      h("div", { class: "rows" }, touching.map((e) => entryRow(e.i))),
    ];
  }

  function nextTargets(e) {
    const ids = [];
    for (const st of e.steps) {
      if (st.k !== "create" || !st.to || !st.to.startsWith("u")) continue;
      if (!ids.includes(st.to)) ids.push(st.to);
    }
    return ids.map((id) => U[Number(id.slice(1))]);
  }

  /** One step of an action. Clicking a step that lands on a contract opens that contract. */
  function stepRow(st, e) {
    const target = st.to ? nodeById.get(st.to) : null;
    return h("button", {
      class: `row${target ? "" : " static"}`, title: st.raw || null,
      onclick: () => {
        if (!target) return;
        select(target.ghost ? { t: "ghost", id: target.id } : { t: "unit", i: target.i });
      },
    },
    h("span", { class: `fx-icon ${KIND_ICON[st.k] === "transition" ? "transition" : st.k}` }, icon(KIND_ICON[st.k])),
    h("span", { class: "row-main" },
      h("span", { class: "row-title mono", text: st.k === "blind" ? st.raw : (st.name ?? "") }),
      h("span", { class: "row-sub" }, verb(st, e),
        st.thr ? h("span", { class: "thr" }, " · in ", h("span", { class: "mono", text: st.thr })) : null,
        target?.ghost ? " · outside this code" : null)),
    st.n > 1 ? h("span", { class: "times", text: `×${st.n}` }) : null);
  }

  function entryPanel(e) {
    const u = U[e.unit];
    const steps = txSteps(e);
    const reads = steps.filter((st) => st.k === "read");
    const src = sourceOf(e);
    const trail = S.trail.length > 1 || (S.trail.length === 1 && S.trail[0] !== e.i) ? h("nav", { class: "trail", "aria-label": "Path so far" },
      S.trail.map((i, k) => [
        k ? h("span", { class: "sep", "aria-hidden": "true", text: "›" }) : null,
        h("button", {
          "aria-current": i === e.i ? "step" : null, title: `${U[E[i].unit].name}.${E[i].name}`,
          onclick: () => select({ t: "entry", i }, { trail: k }), text: E[i].name,
        }),
      ])) : null;

    const next = nextTargets(e);
    return [
      backBtn(),
      trail,
      h("div", { class: "who-line" }, whoChips(e)),
      h("p", { class: "h big", text: e.name }),
      h("div", { class: "on-line" },
        h("span", { text: "on" }),
        h("button", { class: "unit-link", onclick: () => select({ t: "unit", i: e.unit }), text: u.name }),
        h("span", { class: `effect ${e.effect}` }, icon(e.effect), D.labels[e.effect])),
      e.borrowed.length ? h("div", { class: "strip power", title: "Every action runs with the authority of the contract's signers as well as its caller" },
        icon("stamp"), "also carries the authority of", e.borrowed.map((p) => stamp(p))) : null,
      e.anyone && e.effect !== "none" ? h("div", { class: "strip power" }, icon("stamp"), "No access check — anyone can call this") : null,
      e.argParties.length ? h("div", { class: "strip power", title: "The controller is one of this action's own arguments" },
        icon("stamp"), "who acts is an argument — the caller names", e.argParties.map((p) => stamp(p))) : null,
      e.unseen ? h("div", { class: "strip blind" }, icon("blind"), "Who can take this action could not be read from source") : null,
      e.inherited ? h("div", { class: "strip", style: { background: "var(--raised)", color: "var(--muted)" } },
        icon("code"), "inherited from", stamp(e.inherited), "— written outside this code, runs as part of", stamp(u.name)) : null,
      e.unread.length ? h("div", { class: "strip blind", title: "An access check may live in code the tool could not read" },
        icon("blind"), "relies on code that isn't on disk:", e.unread.map((x) => stamp(x))) : null,
      h("div", { class: "actions-bar" },
        h("button", { class: "btn flow play", onclick: () => play(e.i) }, icon("play"), "Play"),
        codeButton(e.anchor)),
      h("div", { class: "section" },
        h("div", { class: "label", text: "What it changes, in order" }),
        h("div", { class: "tx changes" }, steps.filter((st) => st.k !== "read").map((st) => stepRow(st, e)))),
      reads.length ? fold(`What it reads · ${reads.length}`, h("div", { class: "tx" }, reads.map((st) => stepRow(st, e)))) : null,
      e.cidArgs.length ? h("div", { class: "strip", style: { background: "var(--raised)", color: "var(--muted)" },
        title: "Each of these is chosen by whoever calls. The action must check it received the contract it expected." },
        icon("blind"), `the caller picks ${e.cidArgs.length === 1 ? "this contract id" : `these ${e.cidArgs.length} contract ids`}`,
        e.cidArgs.map((p) => stamp(p))) : null,
      e.guards.length ? fold(`Checks · ${e.guards.length}`, e.guards.map((g) => h("div", { class: "check", text: g }))) : null,
      src ? fold("Code", h("pre", { class: "code-snippet", text: src })) : null,
      next.length ? h("div", { class: "section" },
        h("div", { class: "label", text: "Then, what can happen next" }),
        next.slice(0, 3).map((t) => {
          const list = E.filter((x) => x.unit === t.i).sort((a, b) => Number(b.alone) - Number(a.alone) || b.risk - a.risk);
          return h("div", { style: { marginBottom: "10px" } },
            h("div", { class: "row-sub", style: { margin: "4px 2px" } }, "on ",
              h("button", { class: "unit-link", onclick: () => select({ t: "unit", i: t.i }), text: t.name })),
            list.length ? h("div", { class: "rows" }, list.slice(0, 4).map((x) => entryRow(x.i, { unit: false, trail: "continue" })))
              : h("div", { class: "empty", style: { color: "var(--faint)", padding: "2px" }, text: "No actions on it — nothing further happens to it here" }),
            list.length > 4 ? h("button", { class: "more", onclick: () => select({ t: "unit", i: t.i }) }, `All ${list.length}`) : null);
        })) : null,
    ];
  }

  function blindPanel() {
    const rows = [];
    for (const e of E) {
      for (const st of e.steps) {
        if (st.k !== "blind") continue;
        rows.push(h("button", { class: "row", onclick: () => select({ t: "entry", i: e.i }) },
          h("span", { class: "fx-icon blind" }, icon("blind")),
          h("span", { class: "row-main" },
            h("span", { class: "row-title mono", text: st.raw }),
            h("span", { class: "row-sub mono", text: `${U[e.unit].name}.${e.name} · ${e.path}:${e.line}` }))));
      }
    }
    return [
      backBtn(),
      h("p", { class: "h", text: plural(D.stats.holes, "blind spot") }),
      h("p", { class: "sub", text: "The tool couldn't tell what these lines point at, so it drew nothing. Read them yourself." }),
      h("div", { class: "rows" }, rows),
    ];
  }

  // ── learn: each idea, drawn with this codebase's own contracts ──────────────────────────────────
  function mini(name, stamps = [], cls = "", glow = []) {
    return h("div", { class: `mc ${cls}` },
      h("b", { text: name }),
      stamps.length ? h("div", { class: "stamps" }, stamps.map((p) => stamp(p, glow.includes(p) ? "borrowed a-glow" : ""))) : null);
  }
  const arrow = (cls = "") => h("span", { class: `art-arrow ${cls}` }, icon("arrow"));
  function art(key, e, u) {
    const unitName = u?.name ?? "Contract";
    const signers = u?.signers ?? [];
    const firstCreate = e?.steps.find((st) => st.k === "create" && st.to !== `u${e.unit}`);
    const createdName = firstCreate?.name ?? "New";
    const createdSigners = firstCreate?.to?.startsWith("u") ? U[Number(firstCreate.to.slice(1))].signers : [];
    const who = () => (e ? whoChips(e)[0] : chip("anyone"));
    switch (key) {
      case "contract": return mini(unitName, signers);
      case "action": return [who(), arrow(), mini(unitName, signers)];
      case "changes": return D.daml
        ? [mini(unitName, signers, "a-old"), arrow(), mini(unitName, signers, "a-new")]
        : [who(), arrow(), mini(unitName, [], "a-glow")];
      case "ends": return [mini(unitName, signers, "a-old"), arrow(), h("span", { class: "fx-icon terminal a-p2" }, icon("terminal"))];
      case "repeatable": return [mini(unitName, signers), arrow(),
        h("div", { class: "art-col", style: { gap: "4px" } },
          mini(createdName, [], "a-p1"), mini(createdName, [], "a-p2"), mini(createdName, [], "a-p3"))];
      // Two rows: who fires it on which contract, then what that makes — carrying the borrowed stamps.
      case "borrowed": return h("div", { class: "art-col" },
        h("div", { class: "art-row" }, who(), arrow(), mini(unitName, signers, "", e?.borrowed ?? [])),
        h("div", { class: "art-row indent" }, h("span", { class: "art-arrow" }, icon("down")),
          mini(createdName, createdSigners.length ? createdSigners : (e?.borrowed ?? []), "a-new", e?.borrowed ?? [])));
      // The caller fires the action — and separately hands over an id nobody checked they may choose.
      case "cid": return h("div", { class: "art-col" },
        h("div", { class: "art-row" }, who(), arrow(), mini(unitName, signers)),
        h("div", { class: "art-row indent" }, h("span", { class: "art-arrow" }, icon("call")),
          h("span", { class: "mc ghost a-pulse" }, h("b", null, icon("blind"), " ", e?.cidArgs[0] ?? "someCid"))));
      case "blind": return [mini(unitName, signers), arrow("a-pulse"), h("span", { class: "mc ghost a-pulse" }, h("b", null, icon("blind"), " ?"))];
      case "anyone": return [chip("anyone"), arrow(), mini(unitName)];
      case "guarded": return [who(), arrow(), mini(unitName)];
      case "calls": return [mini(unitName), arrow(), mini(e?.steps.find((st) => st.k === "call")?.name ?? "Other", [], "a-new")];
      case "creates": return [mini(unitName), arrow(), mini(createdName, [], "a-new")];
      case "type": {
        const door = D.doors[0] != null ? E[D.doors[0]] : E[0];
        return h("div", { class: "type-demo" },
          h("span", { class: "src", text: door ? `${U[door.unit].name}.${door.name}` : "Vault.Close" }),
          h("span", { class: "say", text: door ? `the tool: ${D.labels[door.effect]}` : "the tool: ends it" }));
      }
      default: return null;
    }
  }
  function buildLearn() {
    learnEl.replaceChildren(
      h("div", { class: "learn-head" },
        h("h2", { text: D.daml ? "Daml, in pictures" : "Solidity, in pictures" }),
        h("p", { text: "Every picture uses a contract from the code you pointed at." })),
      h("div", { class: "tiles" }, D.concepts.map((c) => {
        const e = c.entry != null ? E[c.entry] : null;
        const u = c.unit != null ? U[c.unit] : e ? U[e.unit] : null;
        const target = e ? { t: "entry", i: e.i } : u ? { t: "unit", i: u.i } : null;
        return h("article", { class: "tile" },
          h("div", { class: "stage-art", "aria-hidden": "true" }, art(c.key, e, u)),
          h("div", { class: "tile-body" },
            h("div", { class: "tile-title", text: c.title }),
            h("div", { class: "tile-line", text: c.line }),
            c.note ? h("details", null, h("summary", { text: "What to check" }), h("p", { text: c.note })) : null,
            target ? h("div", { class: "tile-eg" }, "See it:",
              h("button", {
                onclick: () => { setView("map"); select(target, { trail: "reset" }); },
                text: e ? `${U[e.unit].name}.${e.name}` : u.name,
              }))
              : c.key !== "type" ? h("div", { class: "tile-eg", text: "Not in this code." }) : null));
      })));
  }

  // ── tour ────────────────────────────────────────────────────────────────────────────────────────
  let tourEl = null;
  let tourCleanup = null;
  // A step can schedule work (play starts after the panel renders). Moving on must cancel it, or a
  // quick Next lets the late play drag the view back to a step the reader has already left.
  let tourTimer = null;
  function tourSteps() {
    const door = D.doors[0];
    const e = door != null ? E[door] : null;
    const ai = e ? A.findIndex((a) => a.side === "outside" && a.entries.includes(door)) : A.findIndex((a) => a.side === "outside");
    const made = e ? txSteps(e).find((st) => st.k === "create" && st.to?.startsWith("u") && st.to !== `u${e.unit}`) : null;
    return [
      { el: () => peopleEl, text: "These are the parties the code lets act. Outside means they don't need the protocol to do it.",
        run: () => { setView("map"); select(null); } },
      ai >= 0 && { el: () => peopleEl.querySelector(`[data-actor="${ai}"]`), text: "Pick one. The map lights up every contract they can touch.",
        run: () => select({ t: "actor", i: ai }) },
      e && { el: () => inspEl.querySelector(`[data-entry="${door}"]`) ?? inspEl, text: "Pick one of their actions to see exactly what it does.",
        run: () => { if (!(S.sel?.t === "actor" && S.sel.i === ai)) select({ t: "actor", i: ai }); } },
      e && { el: () => inspEl.querySelector(".play"), text: "Press play and watch: what it archives, what it creates, what it calls.",
        run: () => { select({ t: "entry", i: door }, { trail: "reset" }); tourTimer = setTimeout(() => play(door), 450); } },
      made && { el: () => inspEl.querySelector(".life") ?? inspEl, text: "Every contract has a life: what makes it, what replaces it, what ends it.",
        run: () => select({ t: "unit", i: Number(made.to.slice(1)) }) },
      D.stats.holes > 0 && { el: () => topEl.querySelector(".btn.blind"), text: "Amber means the tool couldn't trace a line. It never guesses — read those yourself.",
        run: () => {} },
      { el: () => tabsEl.querySelector('[data-view="learn"]'), text: "New to this language? Learn shows each idea using this code.",
        run: () => {} },
    ].filter(Boolean);
  }
  function endTour() {
    clearTimeout(tourTimer);
    tourCleanup?.();
    tourCleanup = null;
    tourEl?.remove();
    tourEl = null;
  }
  function startTour() {
    endTour();
    const steps = tourSteps();
    let k = 0;
    const hole = h("div", { class: "tour-hole" });
    const tip = h("div", { class: "tour-tip", role: "dialog", "aria-label": "Tour" });
    tourEl = h("div", { class: "tour" }, hole, tip);
    document.body.append(tourEl);
    const place = () => {
      const el = steps[k].el();
      if (!el) return;
      const r = el.getBoundingClientRect();
      const pad = 6;
      Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
      const tw = 290, th = tip.offsetHeight || 120, vw = window.innerWidth, vh = window.innerHeight;
      let x = r.right + 16, y = r.top;
      if (x + tw > vw - 10) x = r.left - tw - 16;
      if (x < 10) { x = clamp(r.left, 10, vw - tw - 10); y = r.bottom + 14; }
      if (y + th > vh - 10) y = Math.max(10, r.top - th - 14);
      Object.assign(tip.style, { left: `${clamp(x, 10, vw - tw - 10)}px`, top: `${clamp(y, 10, vh - th - 10)}px` });
    };
    const show = () => {
      clearTimeout(tourTimer);
      stopPlay();
      steps[k].run?.();
      tip.replaceChildren(
        h("p", { text: steps[k].text }),
        h("div", { class: "tour-actions" },
          h("span", { class: "n", text: `${k + 1} / ${steps.length}` }),
          h("button", { class: "btn ghost", onclick: endTour, text: "Skip" }),
          h("button", { class: "btn primary", onclick: next, text: k === steps.length - 1 ? "Done" : "Next" })));
      requestAnimationFrame(() => requestAnimationFrame(place));
      setTimeout(place, 600);
      tip.querySelector(".btn.primary")?.focus({ preventScroll: true });
    };
    const next = () => { if (++k >= steps.length) endTour(); else show(); };
    const onKey = (ev) => {
      if (ev.key === "Escape") endTour();
      else if (ev.key === "ArrowRight") next();
    };
    window.addEventListener("resize", place);
    document.addEventListener("keydown", onKey, true);
    tourCleanup = () => { window.removeEventListener("resize", place); document.removeEventListener("keydown", onKey, true); };
    show();
    try { localStorage.setItem(TOUR_KEY, "1"); } catch { /* storage can be unavailable; the tour still works */ }
  }

  // ── start ───────────────────────────────────────────────────────────────────────────────────────
  renderTop();
  buildMap();
  renderPeople();
  renderInspector();
  buildLearn();
  // Frame the map once it has a size. Opened in a background tab — or a hidden pane — it measures 0×0
  // at load, and a view computed then leaves every card off-screen with nothing to retry it.
  let framedOnce = false;
  const firstFrame = () => {
    if (framedOnce) return;
    const r = mapEl.getBoundingClientRect();
    if (!r.width || !r.height) return;
    framedOnce = true;
    if (S.sel) frameSelection(); else home(false);
  };
  if (typeof ResizeObserver === "function") new ResizeObserver(firstFrame).observe(mapEl);
  requestAnimationFrame(firstFrame);

  document.addEventListener("keydown", (ev) => {
    if (tourEl || ev.defaultPrevented) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "");
    if (ev.key === "Escape" && S.view === "map" && S.sel) { ev.preventDefault(); goBack(); }
    else if (!typing && (ev.key === "p" || ev.key === "P") && S.sel?.t === "entry") play(S.sel.i);
  });

  // Links open things on the map: #e-Unit-action, #u-Unit, #a-party. Followed on load AND while the
  // page is open, so a guide beside the map can drive it one step at a time.
  const followLink = () => {
    const hash = decodeURIComponent(location.hash.slice(1));
    if (!hash) return false;
    if (hash === "map" || hash === "learn") {
      endTour();
      setView(hash);
      if (hash === "map") select(null);
      return true;
    }
    const linkedEntry = E.find((e) => e.anchor === hash);
    const linkedUnit = U.find((u) => u.anchor === hash);
    const linkedActor = hash.startsWith("a-") ? A.findIndex((a) => a.name === hash.slice(2)) : -1;
    if (!linkedEntry && !linkedUnit && linkedActor < 0) return false;
    endTour();
    setView("map");
    if (linkedEntry) select({ t: "entry", i: linkedEntry.i }, { trail: "reset" });
    else if (linkedUnit) select({ t: "unit", i: linkedUnit.i });
    else select({ t: "actor", i: linkedActor });
    return true;
  };
  const hash = location.hash.slice(1);
  followLink();
  window.addEventListener("hashchange", () => { if (S.view !== "code") followLink(); });

  let seen = true;
  try { seen = localStorage.getItem(TOUR_KEY) === "1"; } catch { seen = true; }
  if (!seen && !hash && D.doors.length) setTimeout(startTour, 700);
})();
