import { extract, palette } from "./palette.js";

const $ = (id) => document.getElementById(id);
const state = { kept: [], rejected: [], handAdded: [], sources: null, rateRemaining: null };
let queue = [];        // candidates to review, in order
let index = -1;        // position in queue
let shown = null;      // the entry on the phone
let history = [];      // last decisions, for undo
let paletteCache = new Map();

// Unsplash URLs take w/h params; AIC IIIF URLs take a !w,h size segment;
// anything else is served as-is (the Met's originals are big but cached).
function sized(url, w, h) {
  if (url.includes("images.unsplash.com")) return url.replace(/([?&])w=\d+&h=\d+/, `$1w=${w}&h=${h}`);
  if (url.includes("/iiif/2/")) return url.replace(/\/!\d+,\d+\//, `/!${w},${h}/`);
  return url;
}
const proxied = (url, w, h) => `/img?u=${encodeURIComponent(sized(url, w, h))}`;
const stageURL = (e) => proxied(e.url, 780, 1690);
const thumbURL = (e) => proxied(e.url, 84, 180);
/// Which library an entry came from, by id prefix.
const SOURCE_BADGE = { unsplash: "U", ill: "ILL", aic: "AIC", met: "MET" };
const ALL_SOURCES = ["unsplash", "ill", "aic", "met"];
function sourceOf(entry) {
  const m = String(entry.id).match(/^([a-z]+)-/);
  return m ? m[1] : "other";
}
function badge(entry) {
  const src = sourceOf(entry);
  const b = document.createElement("span");
  b.className = `badge badge-${src}`;
  b.textContent = SOURCE_BADGE[src] ?? src.toUpperCase();
  b.title = entry.credit?.sourceName ?? (src === "unsplash" ? "Unsplash" : src);
  return b;
}
/// The header's source picker: scopes searches and filters the kept strip.
const selectedSource = () => $("source").value;
const SOURCE_PREFIX = { unsplash: "", ill: "ill: ", aic: "aic: ", met: "met: " };
/// Mirrors DailyCredit.line in the app.
function creditLine(c) {
  if (!c) return "";
  if (c.sourceName) return `${c.name} · ${c.sourceName}`;
  return c.source === "unsplash" ? `Photo by ${c.name} on Unsplash` : `Photo by ${c.name}`;
}

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json;
}

function applyState(s) {
  Object.assign(state, s);
  renderKept();
  renderCounts();
  updateSpreadButton();
  renderPins();
}

// ---- pins: a picture for a specific day

function renderPins() {
  const el = $("pinsList");
  el.innerHTML = "";
  const pins = state.pins ?? [];
  if (!pins.length) { el.textContent = "none yet — pick a photo, type a date on the right, Pin"; return; }
  for (const p of pins) {
    const chip = document.createElement("span");
    chip.className = "pin";
    chip.innerHTML = `<b>${p.date}</b> ${p.image.credit?.name ?? p.image.id}`;
    chip.title = `${creditLine(p.image.credit)} — click to view`;
    chip.onclick = () => { shown = p.image; show(p.image); $("pinDate").value = p.date; };
    const x = document.createElement("span");
    x.className = "x"; x.textContent = "×"; x.title = `unpin ${p.date}`;
    x.onclick = async (ev) => { ev.stopPropagation(); applyState(await api("/api/unpin", { date: p.date })); };
    chip.appendChild(x);
    el.appendChild(chip);
  }
}
$("btnPin").onclick = async () => {
  if (!shown) return alert("show a picture first");
  const date = $("pinDate").value.trim();
  if (!/^(\d{4}-)?\d{2}-\d{2}$/.test(date)) return alert("date must be MM-DD (every year) or YYYY-MM-DD (once)");
  try { applyState(await api("/api/pin", { date, entry: shown })); } catch (err) { alert(err.message); }
};
$("pinDate").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); $("btnPin").click(); } });

function renderCounts() {
  const perSource = {};
  for (const e of state.kept) { const k = sourceOf(e); perSource[k] = (perSource[k] ?? 0) + 1; }
  const parts = Object.entries(perSource).map(([k, n]) => `${n} ${SOURCE_BADGE[k] ?? k}`).join(" · ");
  const sel = selectedSource();
  $("keptCount").textContent = sel === "all" ? `${state.kept.length}${parts ? ` (${parts})` : ""}`
    : `${perSource[sel] ?? 0} ${SOURCE_BADGE[sel] ?? sel} of ${state.kept.length}`;
  $("queueCount").textContent = queue.length ? `${Math.max(index, 0) + 1} / ${queue.length} in queue` : "queue empty — search above";
  $("rate").textContent = state.rateRemaining == null ? "" : `Unsplash: ${state.rateRemaining} requests left this hour`;
}

// ---- the phone mock

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed"));
    img.src = url;
  });
}

async function paletteFor(entry) {
  if (paletteCache.has(entry.id)) return paletteCache.get(entry.id);
  const img = await loadImage(stageURL(entry));
  const colors = extract(img);
  const p = { colors, ...palette(colors) };
  paletteCache.set(entry.id, p);
  return p;
}

async function show(entry) {
  shown = entry;
  const phone = $("phone");
  if (!entry) {
    phone.innerHTML = `<div class="empty">Nothing to show. Search above or load sources.json.</div>`;
    $("meta").textContent = ""; $("swatches").innerHTML = ""; $("paletteMeta").textContent = "";
    return;
  }
  const status = state.kept.some((k) => k.id === entry.id) ? "kept" : state.rejected.includes(entry.id) ? "rejected" : "undecided";
  $("meta").innerHTML = `<b>${entry.credit?.name ?? "Unknown"}</b>${entry.title ? `<br><i>${entry.title}</i>` : ""}${entry.detail ? `<br>${entry.detail}` : ""}<br>${entry.credit?.sourceName ?? (entry.credit?.source === "unsplash" ? "Unsplash" : "")} · ${entry.id}<br>status: <b>${status}</b>`;
  phone.innerHTML = `<div class="photo" style="background-image:url('${stageURL(entry)}')"></div><div class="empty" style="position:absolute;inset:0;display:grid;place-items:center;color:#fff">…</div>`;
  $("swatches").innerHTML = ""; $("paletteMeta").textContent = "reading colours…";
  let p;
  try { p = await paletteFor(entry); } catch { phone.querySelector(".empty").textContent = "image failed to load"; return; }
  if (shown !== entry) return; // moved on meanwhile
  const bg = p.background;
  const stop = (o, at) => `color-mix(in srgb, ${bg} ${o * 100}%, transparent) ${at * 100}%`;
  phone.innerHTML = `
    <div class="photo" style="background-image:url('${stageURL(entry)}')"></div>
    <div class="wash" style="background:linear-gradient(${stop(0.9, 0)}, ${stop(0.6, 0.3)}, ${stop(0, 0.48)}, ${stop(0, 0.66)}, ${stop(0.85, 0.9)}, ${stop(0.95, 1)})"></div>
    <div class="wash" style="background:
      radial-gradient(circle 84px at 195px ${844 - 128 - 46}px, ${stop(0.16, 0)}, ${stop(0.07, 0.55)}, ${stop(0, 1)})"></div>
    <div class="word-pool" style="background:color-mix(in srgb, ${bg} 16%, transparent)"></div>
    <div class="status" style="color:${p.textPrimary}">9:41</div>
    <div class="wordmark memo" style="color:${p.textPrimary}">memo</div>
    <div class="wordmark daddy" style="color:${p.textPrimary}">daddy</div>
    <div class="tuner" style="color:${p.linkAccent}">tuner</div>
    <div class="ring" style="border-color:${p.recordRing}"><div class="fill" style="background:${p.recordFill}"></div></div>
    <div class="credit" style="color:${p.textPrimary}">${creditLine(entry.credit)}</div>
    <div class="nav">
      <span style="left:38px;color:${p.textPrimary}">capture</span>
      <span class="dot" style="background:${p.textPrimary}"></span>
      <span style="left:126px;color:${p.textSecondary}">memos</span>
      <span style="left:204px;color:${p.textSecondary}">favorites</span>
      <span style="left:293px;color:${p.textSecondary}">settings</span>
    </div>`;
  $("swatches").innerHTML = [["bg", p.background], ["card", p.card], ["accent", p.accent], ["tuner", p.linkAccent], ["ring", p.recordRing], ["rec", p.recordFill]]
    .map(([n, c]) => `<div class="swatch" style="background:${c}" title="${c}"><span>${n}</span></div>`).join("");
  const c = p.colors;
  const linkNote = p.linkFallback ? ` · <b style="color:var(--reject)">tuner fell back to the text colour</b> (mixed patch; the fade under it carries it)`
    : p.linkAdjusted ? " · tuner re-depthed to read over the photo" : "";
  $("paletteMeta").innerHTML = `scheme <b>${p.dark ? "dark" : "light"}</b> (luma ${c.averageLuma.toFixed(2)}) · accent hue <b>${Math.round(c.accentHue * 360)}°</b> sat ${c.accentSaturation.toFixed(2)}${c.vivid ? "" : " · <b>no vivid colour</b>, muted accent"}<br>tuner contrast over the photo (worst of mean/dark/light ends) <b>${p.linkContrast.toFixed(1)}:1</b>${linkNote}<br>record ring over its own patch <b>${p.ringContrast == null ? "?" : p.ringContrast.toFixed(1) + ":1"}</b>${p.fillFallback ? " · <b>red kept as-is</b> (no red clears the patch; ring carries it)" : p.fillAdjusted ? " · red re-depthed" : ""}`;
}

// ---- queue

let queueIsKept = false;
let queueTitle = "";
function setQueue(entries, start = 0, isKept = false, title = "") {
  queue = entries;
  queueIsKept = isKept;
  queueTitle = title;
  index = entries.length ? start : -1;
  renderQueue();
  renderCounts();
  show(queue[index] ?? null);
}

function advance(step = 1) {
  if (!queue.length) return show(null);
  index = Math.min(Math.max(index + step, 0), queue.length - 1);
  renderQueue();
  renderCounts();
  show(queue[index]);
  if (queueIsKept) renderKept();
}

function nextUndecided() {
  for (let i = index + 1; i < queue.length; i++) {
    const id = queue[i].id;
    if (!state.kept.some((k) => k.id === id) && !state.rejected.includes(id)) { index = i - 1; return advance(1); }
  }
  index = queue.length - 1;
  renderQueue(); renderCounts();
  show(queue[index] ?? null);
}

function renderQueue() {
  const el = $("queue");
  el.innerHTML = "";
  $("queueLabel").textContent = queueIsKept ? "reviewing kept" : "results";
  $("queueNote").textContent = queueIsKept ? "stepping through the rotation above; search to load new candidates"
    : queue.length ? `${queue.length} for “${queueTitle}” (${(() => { const c = {}; for (const e of queue) { const k = sourceOf(e); c[k] = (c[k] ?? 0) + 1; } return Object.entries(c).map(([k, n]) => `${n} ${SOURCE_BADGE[k] ?? k}`).join(" · "); })()}) — ← → step, K keep, X reject`
    : queueTitle ? `nothing for “${queueTitle}” — try other words (aic: needs every word to match)` : "search above, or load sources.json";
  if (!queue.length && !queueIsKept) {
    const n = document.createElement("div"); n.className = "empty-note";
    n.textContent = queueTitle ? "no results" : "no candidates loaded yet";
    el.appendChild(n);
  }
  queue.forEach((e, i) => {
    const d = document.createElement("div");
    const status = state.kept.some((k) => k.id === e.id) ? "kept" : state.rejected.includes(e.id) ? "rejected" : "";
    d.className = `thumb ${status} ${i === index ? "current" : ""}`;
    d.style.backgroundImage = `url('${thumbURL(e)}')`;
    d.title = `${e.credit?.name ?? e.id} — ${e.credit?.sourceName ?? "Unsplash"}`;
    d.onclick = () => { index = i; renderQueue(); renderCounts(); show(e); };
    d.appendChild(badge(e));
    el.appendChild(d);
  });
  el.querySelector(".current")?.scrollIntoView({ inline: "nearest", block: "nearest" });
}

// ---- kept strip with drag reorder

function renderKept() {
  const el = $("kept");
  el.innerHTML = "";
  const sel = selectedSource();
  const shown = sel === "all" ? state.kept : state.kept.filter((e) => sourceOf(e) === sel);
  if (!shown.length) {
    const n = document.createElement("div"); n.className = "empty-note";
    n.textContent = sel === "all" ? "nothing kept yet" : `nothing kept from ${SOURCE_BADGE[sel] ?? sel} yet`;
    el.appendChild(n);
  }
  shown.forEach((e) => {
    const d = document.createElement("div");
    d.className = "thumb kept" + (shown?.id === e.id ? " current" : "");
    d.draggable = true;
    d.dataset.id = e.id;
    d.style.backgroundImage = `url('${thumbURL(e)}')`;
    d.title = `${e.credit?.name ?? e.id} — ${e.credit?.sourceName ?? "Unsplash"} — click to view, drag to reorder`;
    d.appendChild(badge(e));
    d.onclick = () => { shown = e; show(e); renderKept(); };
    d.ondragstart = (ev) => { ev.dataTransfer.setData("text/plain", e.id); d.classList.add("dragging"); };
    d.ondragend = () => d.classList.remove("dragging");
    d.ondragover = (ev) => { ev.preventDefault(); d.classList.add("over"); };
    d.ondragleave = () => d.classList.remove("over");
    d.ondrop = async (ev) => {
      ev.preventDefault(); d.classList.remove("over");
      const from = ev.dataTransfer.getData("text/plain");
      if (!from || from === e.id) return;
      const ids = state.kept.map((k) => k.id);
      ids.splice(ids.indexOf(from), 1);
      ids.splice(ids.indexOf(e.id), 0, from);
      applyState(await api("/api/order", { ids }));
    };
    el.appendChild(d);
  });
}

// ---- shuffle: mix the libraries through the rotation

/// Fisher–Yates on a copy.
function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/// Shuffle within each library, then spread every library evenly over the
/// whole rotation (13 prints among 121 photos land every ~9 days, not
/// all in the first fortnight as round-robin would). Pure; exposed for
/// testing.
function mixedOrder(kept) {
  const bySource = {};
  for (const e of kept) (bySource[sourceOf(e)] ??= []).push(e);
  const placed = [];
  for (const list of Object.values(bySource)) {
    const items = shuffled(list);
    // fractional slot in [0, 1): the k-th of n sits at (k + 0.5) / n, with a
    // small per-library jitter so different libraries don't collide.
    const jitter = Math.random() * 0.5 / Math.max(items.length, 1);
    items.forEach((e, k) => placed.push({ id: e.id, at: (k + 0.5) / items.length + jitter }));
  }
  return placed.sort((a, b) => a.at - b.at).map((p) => p.id);
}
window.mixedOrder = mixedOrder;

/// New picks (kept since the last shuffle/spread) slotted evenly into the
/// settled order; the settled ones keep their relative order. Pure.
function spreadOrder(kept, settledIDs) {
  const settledSet = new Set(settledIDs ?? []);
  const settled = kept.filter((e) => settledSet.has(e.id)).map((e) => e.id);
  const fresh = kept.filter((e) => !settledSet.has(e.id)).map((e) => e.id);
  const merged = [...settled], total = settled.length + fresh.length;
  fresh.forEach((id, k) => merged.splice(Math.min(merged.length, Math.floor((k + 0.5) / fresh.length * total)), 0, id));
  return merged;
}
window.spreadOrder = spreadOrder;

function updateSpreadButton() {
  const b = $("spread");
  if (!state.settledIDs) { b.disabled = true; b.title = "needs the server restarted once (pkill -f scripts/curate.mjs && npm run curate)"; b.textContent = "Spread new picks"; return; }
  const n = state.kept.filter((e) => !new Set(state.settledIDs).has(e.id)).length;
  b.disabled = n === 0; b.textContent = n ? `Spread ${n} new pick${n === 1 ? "" : "s"}` : "No new picks to spread";
  b.title = "slot the picks kept since the last shuffle or spread evenly into the existing order, leaving everything else where it is";
}
$("spread").onclick = async () => {
  if (!state.settledIDs) return;
  applyState(await api("/api/order", { ids: spreadOrder(state.kept, state.settledIDs), settle: true }));
};

let orderBeforeShuffle = null;
$("shuffle").onclick = async () => {
  if (state.kept.length < 2) return;
  orderBeforeShuffle = state.kept.map((e) => e.id);
  applyState(await api("/api/order", { ids: mixedOrder(state.kept), settle: true }));
  $("unshuffle").hidden = false;
};
$("unshuffle").onclick = async () => {
  if (!orderBeforeShuffle) return;
  applyState(await api("/api/order", { ids: orderBeforeShuffle }));
  orderBeforeShuffle = null;
  $("unshuffle").hidden = true;
};

// ---- decisions

async function decide(kind) {
  if (!shown) return;
  const entry = shown;
  const prev = state.kept.some((k) => k.id === entry.id) ? "kept" : state.rejected.includes(entry.id) ? "rejected" : "clear";
  history.push({ id: entry.id, entry, prev });
  const s = kind === "keep" ? await api("/api/keep", { entry })
    : kind === "reject" ? await api("/api/reject", { id: entry.id })
    : await api("/api/clear", { id: entry.id });
  applyState(s);
  // Reviewing the kept list: just step on. Reviewing new candidates: skip
  // past anything already decided.
  if (queue[index]?.id !== entry.id) show(entry);
  else if (queueIsKept) advance(1);
  else nextUndecided();
}

async function undo() {
  const last = history.pop();
  if (!last) return;
  const s = last.prev === "kept" ? await api("/api/keep", { entry: last.entry })
    : last.prev === "rejected" ? await api("/api/reject", { id: last.id })
    : await api("/api/clear", { id: last.id });
  applyState(s);
  const i = queue.findIndex((e) => e.id === last.id);
  if (i >= 0) { index = i; renderQueue(); renderCounts(); }
  show(last.entry);
}

// ---- fetching candidates

async function search(term, pages = 2) {
  const found = [];
  for (let page = 1; page <= pages; page++) {
    const res = await api(`/api/search?term=${encodeURIComponent(term)}&page=${page}`);
    if (res.rateRemaining != null) state.rateRemaining = res.rateRemaining;
    found.push(...res.candidates);
    if (!res.more) break;
  }
  return found;
}

function dedupe(entries) {
  const seen = new Set();
  return entries.filter((e) => !seen.has(e.id) && seen.add(e.id));
}

/// Round-robin across lists so consecutive candidates come from different libraries.
function interleave(lists) {
  const out = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

$("search").onsubmit = async (ev) => {
  ev.preventDefault();
  let term = $("q").value.trim();
  if (!term) return;
  const sel = selectedSource();
  const hasPrefix = /^[a-z]+:/i.test(term);
  try {
    let found, title;
    if (sel === "all" && !hasPrefix) {
      // Every library at once: Unsplash (two pages), AIC and the Met (one
      // page each; the Met is slow), interleaved. A failing library is
      // skipped, not fatal.
      const terms = ALL_SOURCES.map((k) => SOURCE_PREFIX[k] + term);
      const results = await Promise.allSettled(terms.map((t, i) => search(t, ALL_SOURCES[i] === "unsplash" ? 2 : 1)));
      const lists = results.map((r) => (r.status === "fulfilled" ? r.value : []));
      const failed = results.map((r, i) => (r.status === "rejected" ? terms[i].split(":")[0] : null)).filter(Boolean);
      if (failed.length) console.warn("search failed for", failed, results.filter((r) => r.status === "rejected").map((r) => r.reason?.message));
      found = interleave(shuffled(lists).map(shuffled));
      title = `${term} (all sources${failed.length ? `; ${failed.join(", ")} failed` : ""})`;
    } else {
      if (sel !== "all" && !hasPrefix) term = SOURCE_PREFIX[sel] + term;
      found = await search(term);
      title = term;
    }
    const fresh = found.filter((e) => e.status === "new");
    setQueue(dedupe(fresh.length ? fresh : found), 0, false, title);
  } catch (err) { alert(err.message); }
};

$("loadSources").onclick = async () => {
  const s = state.sources ?? {};
  const terms = [...(s.collections ?? []).map((c) => `collection:${c}`), ...(s.queries ?? [])];
  if (!terms.length) return alert("sources.json has no collections or queries");
  try {
    const lists = [];
    for (const t of terms) lists.push(await search(t, 1));
    // interleave like the manifest builder used to, so moods mix
    const out = [];
    const longest = Math.max(...lists.map((l) => l.length));
    for (let i = 0; i < longest; i++) for (const l of lists) if (l[i]) out.push(l[i]);
    setQueue(dedupe(out.filter((e) => e.status === "new")), 0, false, "sources.json");
  } catch (err) { alert(err.message); }
};

// ---- keyword-less browsing per library

let browsePage = 0;
async function browseOnce(source, page) {
  const res = await api(`/api/browse?source=${source}&page=${page}`);
  if (res.rateRemaining != null) state.rateRemaining = res.rateRemaining;
  return res.candidates;
}
async function browse(append = false) {
  const sel = selectedSource();
  browsePage = append ? browsePage + 1 : 1;
  const sources = sel === "all" ? shuffled(ALL_SOURCES) : [sel];
  $("browse").disabled = true; $("browseMore").disabled = true;
  $("queueNote").textContent = `loading ${sources.map((k) => SOURCE_BADGE[k]).join(" · ")}…`;
  try {
    const results = await Promise.allSettled(sources.map((k) => browseOnce(k, browsePage)));
    const lists = results.map((r) => (r.status === "fulfilled" ? r.value : []));
    const failed = sources.filter((_, i) => results[i].status === "rejected");
    // Random order within each library and a random library order, so
    // "All sources" never shows the same mix twice.
    const fresh = interleave(lists.map(shuffled)).filter((e) => e.status === "new");
    const title = `browsing ${sel === "all" ? "all sources" : SOURCE_BADGE[sel]}${failed.length ? ` (${failed.join(", ")} failed)` : ""}`;
    if (append) {
      const seen = new Set(queue.map((e) => e.id));
      const start = queue.length;
      setQueue([...queue, ...fresh.filter((e) => !seen.has(e.id))], start, false, title);
    } else {
      setQueue(dedupe(fresh), 0, false, title);
    }
  } catch (err) { alert(err.message); }
  $("browse").disabled = false; $("browseMore").disabled = false;
}
$("browse").onclick = () => browse(false);
$("browseMore").onclick = () => browse(true);

$("reviewKept").onclick = () => {
  const sel = selectedSource();
  setQueue(sel === "all" ? [...state.kept] : state.kept.filter((e) => sourceOf(e) === sel), 0, true);
};
$("source").onchange = () => { renderKept(); renderCounts(); browse(false); };

$("btnKeep").onclick = () => decide("keep");
$("btnReject").onclick = () => decide("reject");
$("btnSkip").onclick = () => advance(1);

document.addEventListener("keydown", (ev) => {
  if (ev.target instanceof HTMLInputElement) return;
  const k = ev.key;
  if (k === "ArrowRight" || k === "k" || k === "K") { ev.preventDefault(); decide("keep"); }
  else if (k === "ArrowLeft" || k === "x" || k === "X") { ev.preventDefault(); decide("reject"); }
  else if (k === " ") { ev.preventDefault(); advance(1); }
  else if (k === "ArrowUp") { ev.preventDefault(); advance(-1); }
  else if (k === "ArrowDown") { ev.preventDefault(); advance(1); }
  else if (k === "Backspace") { ev.preventDefault(); undo(); }
  else if (k === "u" || k === "U") { ev.preventDefault(); decide("clear"); }
});

// fit the 390×844 phone into the stage
function fit() {
  const stage = document.querySelector(".stage");
  const scale = Math.min(1, (stage.clientHeight - 16) / 844, (stage.clientWidth - 16) / 390);
  $("phone").style.transform = `scale(${scale})`;
  $("phone").style.marginBottom = `${-844 * (1 - scale)}px`;
}
new ResizeObserver(fit).observe(document.querySelector(".stage"));

applyState(await api("/api/state"));
if (state.kept.length) setQueue([...state.kept], 0, true); else show(null);
fit();
