import { extract, palette } from "./palette.js";

const $ = (id) => document.getElementById(id);
const state = { kept: [], rejected: [], handAdded: [], sources: null, rateRemaining: null };
let queue = [];        // candidates to review, in order
let index = -1;        // position in queue
let shown = null;      // the entry on the phone
let history = [];      // last decisions, for undo
let paletteCache = new Map();

const proxied = (url, w, h) => `/img?u=${encodeURIComponent(url.replace(/([?&])w=\d+&h=\d+/, `$1w=${w}&h=${h}`))}`;
const stageURL = (e) => proxied(e.url, 780, 1690);
const thumbURL = (e) => proxied(e.url, 84, 180);

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
}

function renderCounts() {
  $("keptCount").textContent = state.kept.length;
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
  $("meta").innerHTML = `<b>${entry.credit?.name ?? "Unknown"}</b><br>${entry.id}<br>status: <b>${status}</b>`;
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
      radial-gradient(circle 64px at 62px 412px, ${stop(0.38, 0)}, ${stop(0.2, 0.55)}, ${stop(0, 1)}),
      radial-gradient(circle 84px at 195px ${844 - 128 - 46}px, ${stop(0.38, 0)}, ${stop(0.2, 0.55)}, ${stop(0, 1)})"></div>
    <div class="status" style="color:${p.textPrimary}">9:41</div>
    <div class="wordmark memo" style="color:${p.textPrimary}">memo</div>
    <div class="wordmark daddy" style="color:${p.textPrimary}">daddy</div>
    <div class="tuner" style="color:${p.linkAccent}">tuner</div>
    <div class="ring" style="border-color:${p.recordRing}"><div class="fill" style="background:${p.recordFill}"></div></div>
    <div class="credit" style="color:${p.textPrimary}">Photo by ${entry.credit?.name ?? "?"} on Unsplash</div>
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
function setQueue(entries, start = 0, isKept = false) {
  queue = entries;
  queueIsKept = isKept;
  $("queue").hidden = isKept; // the kept strip already shows these
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
  queue.forEach((e, i) => {
    const d = document.createElement("div");
    const status = state.kept.some((k) => k.id === e.id) ? "kept" : state.rejected.includes(e.id) ? "rejected" : "";
    d.className = `thumb ${status} ${i === index ? "current" : ""}`;
    d.style.backgroundImage = `url('${thumbURL(e)}')`;
    d.title = e.credit?.name ?? e.id;
    d.onclick = () => { index = i; renderQueue(); renderCounts(); show(e); };
    el.appendChild(d);
  });
  el.querySelector(".current")?.scrollIntoView({ inline: "nearest", block: "nearest" });
}

// ---- kept strip with drag reorder

function renderKept() {
  const el = $("kept");
  el.innerHTML = "";
  state.kept.forEach((e) => {
    const d = document.createElement("div");
    d.className = "thumb kept" + (shown?.id === e.id ? " current" : "");
    d.draggable = true;
    d.dataset.id = e.id;
    d.style.backgroundImage = `url('${thumbURL(e)}')`;
    d.title = `${e.credit?.name ?? e.id} — click to view, drag to reorder`;
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
  const collection = term.match(/^collection:\s*(\d+)/i)?.[1];
  const found = [];
  for (let page = 1; page <= pages; page++) {
    const res = await api(collection ? `/api/search?collection=${collection}&page=${page}` : `/api/search?q=${encodeURIComponent(term)}&page=${page}`);
    state.rateRemaining = res.rateRemaining;
    found.push(...res.candidates);
    if (!res.more) break;
  }
  return found;
}

function dedupe(entries) {
  const seen = new Set();
  return entries.filter((e) => !seen.has(e.id) && seen.add(e.id));
}

$("search").onsubmit = async (ev) => {
  ev.preventDefault();
  const term = $("q").value.trim();
  if (!term) return;
  try {
    const found = await search(term);
    const fresh = found.filter((e) => e.status === "new");
    setQueue(dedupe(fresh.length ? fresh : found));
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
    setQueue(dedupe(out.filter((e) => e.status === "new")));
  } catch (err) { alert(err.message); }
};

$("reviewKept").onclick = () => setQueue([...state.kept], 0, true);

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
