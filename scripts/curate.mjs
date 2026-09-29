#!/usr/bin/env node
// Local curation page: browse Unsplash candidates inside a mock of the
// app's front page, dressed in the palette the app will derive, and keep
// or reject each one. Every decision writes picks.json and rebuilds
// manifest.json; commit and push when you're done.
//
//   npm run curate            # opens http://localhost:4747
//
// Nothing here is reachable from outside the machine (binds 127.0.0.1),
// and the Unsplash key never reaches the page: the server makes the API
// calls and proxies image bytes (so the page can read their pixels).
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  root, sourcesPath, PER_PAGE, loadDotEnv, readJSON, writeJSON, picksPath,
  readPicks, buildManifest, fetchPage, isUnsplash, ApiError, api, entry,
} from "./lib.mjs";
import { SOURCES, parseTerm, isCurated } from "./sources.mjs";

const PORT = Number(process.env.PORT ?? 4747);
const key = await loadDotEnv();
if (!key) { console.error("error: set UNSPLASH_ACCESS_KEY (or put it in .env)"); process.exit(1); }

const staticDir = path.join(root, "curate");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const imageHosts = new Set(["images.unsplash.com", "raw.githubusercontent.com", ...Object.values(SOURCES).map((s) => s.imageHost)]);

let picks = await readPicks();
let rateRemaining = null;

async function save() {
  await writeJSON(picksPath, picks);
  await buildManifest(picks);
}

function statusOf(id) {
  if (picks.kept.some((e) => e.id === id)) return "kept";
  if (picks.rejected.includes(id)) return "rejected";
  return "new";
}

async function state() {
  const manifest = await readJSON(path.join(root, "manifest.json"), { images: [] });
  return {
    kept: picks.kept,
    rejected: picks.rejected,
    handAdded: (manifest.images ?? []).filter((e) => !isCurated(e)),
    libraries: Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, v.label])),
    sources: await readJSON(sourcesPath, { collections: [], queries: [] }),
    rateRemaining,
  };
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

async function readBody(req) {
  let data = "";
  for await (const chunk of req) { data += chunk; if (data.length > 1e6) throw new Error("body too large"); }
  return data ? JSON.parse(data) : {};
}

async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p === "/img") {
    const target = url.searchParams.get("u") ?? "";
    let t;
    try { t = new URL(target); } catch { return send(res, 400, { error: "bad url" }); }
    if (t.protocol !== "https:" || !imageHosts.has(t.hostname)) return send(res, 403, { error: "host not allowed" });
    // Some image CDNs (AIC's IIIF) refuse requests without a browser-ish UA.
    const upstream = await fetch(t, { headers: { "user-agent": "Mozilla/5.0 (memodaddy-curation)", accept: "image/*" } });
    if (!upstream.ok) return send(res, upstream.status, { error: "upstream" });
    res.writeHead(200, { "content-type": upstream.headers.get("content-type") ?? "image/jpeg", "cache-control": "max-age=86400" });
    res.end(Buffer.from(await upstream.arrayBuffer()));
    return;
  }

  if (p === "/api/state") return send(res, 200, await state());

  if (p === "/api/search") {
    const page = Number(url.searchParams.get("page") ?? "1");
    const term = url.searchParams.get("term");
    const parsed = term != null ? parseTerm(term)
      : url.searchParams.get("collection") ? { source: "unsplash", collection: url.searchParams.get("collection") }
      : { source: "unsplash", query: url.searchParams.get("q") ?? "" };
    if (!parsed.collection && !parsed.query) return send(res, 400, { error: "a query is required" });
    try {
      let candidates, more;
      if (parsed.source === "unsplash") {
        const r = await fetchPage(parsed.collection ? { collection: parsed.collection } : { query: parsed.query }, page, key, PER_PAGE);
        rateRemaining = r.remaining; candidates = r.photos; more = r.more;
      } else {
        const r = await SOURCES[parsed.source].page(parsed.query, page, PER_PAGE, { api, entry, key });
        candidates = r.entries; more = r.more;
      }
      return send(res, 200, { source: parsed.source, candidates: candidates.map((e) => ({ ...e, status: statusOf(e.id) })), more, rateRemaining });
    } catch (err) {
      return send(res, err instanceof ApiError ? err.status : 500, { error: err.message });
    }
  }

  // Keyword-less browsing of one library: /api/browse?source=aic|met|unsplash&page=N
  if (p === "/api/browse") {
    const source = url.searchParams.get("source") ?? "unsplash";
    const page = Number(url.searchParams.get("page") ?? "1");
    try {
      let entries, more = true;
      if (source === "unsplash") {
        const { body, remaining } = await api("/photos/random", { count: PER_PAGE, orientation: "portrait", content_filter: "high" }, key);
        rateRemaining = remaining;
        entries = body.filter((ph) => ph.height > ph.width * 1.2).map(entry);
      } else if (SOURCES[source]?.browse) {
        ({ entries, more } = await SOURCES[source].browse(PER_PAGE, { api, entry, key }));
      } else {
        return send(res, 400, { error: "unknown source" });
      }
      return send(res, 200, { source, candidates: entries.map((e) => ({ ...e, status: statusOf(e.id) })), more, rateRemaining });
    } catch (err) {
      return send(res, err instanceof ApiError ? err.status : 500, { error: err.message });
    }
  }

  if (req.method === "POST" && p.startsWith("/api/")) {
    const body = await readBody(req);
    switch (p) {
      case "/api/keep": {
        const e = body.entry;
        let host;
        try { host = new URL(e?.url ?? "").hostname; } catch { host = ""; }
        const ok = e?.id && isCurated(e) && typeof e.url === "string" && e.url.startsWith("https://") && imageHosts.has(host);
        if (!ok) return send(res, 400, { error: "not an entry from a known library" });
        picks.rejected = picks.rejected.filter((id) => id !== e.id);
        if (!picks.kept.some((k) => k.id === e.id)) {
          picks.kept.push({ id: e.id, url: e.url, color: e.color, credit: e.credit, title: e.title, detail: e.detail });
        }
        break;
      }
      case "/api/reject":
        picks.kept = picks.kept.filter((k) => k.id !== body.id);
        if (!picks.rejected.includes(body.id)) picks.rejected.push(body.id);
        break;
      case "/api/clear": // back to undecided
        picks.kept = picks.kept.filter((k) => k.id !== body.id);
        picks.rejected = picks.rejected.filter((id) => id !== body.id);
        break;
      case "/api/order": {
        const byId = new Map(picks.kept.map((k) => [k.id, k]));
        const ordered = body.ids.map((id) => byId.get(id)).filter(Boolean);
        if (ordered.length !== picks.kept.length) return send(res, 400, { error: "order must list every kept id" });
        picks.kept = ordered;
        break;
      }
      default:
        return send(res, 404, { error: "no such action" });
    }
    await save();
    return send(res, 200, await state());
  }

  // static
  const file = p === "/" ? "index.html" : p.replace(/^\/+/, "");
  const full = path.join(staticDir, file);
  if (!full.startsWith(staticDir + path.sep) && full !== staticDir) return send(res, 404, { error: "nope" });
  try {
    const data = await readFile(full);
    send(res, 200, data, types[path.extname(full)] ?? "application/octet-stream");
  } catch {
    send(res, 404, { error: "not found" });
  }
}

http.createServer((req, res) => {
  handle(req, res).catch((err) => { console.error(err); if (!res.headersSent) send(res, 500, { error: err.message }); });
}).listen(PORT, "127.0.0.1", () => {
  const addr = `http://localhost:${PORT}`;
  console.log(`curating at ${addr}  (kept ${picks.kept.length}, rejected ${picks.rejected.length})`);
  if (process.platform === "darwin" && !process.argv.includes("--no-open")) spawn("open", [addr], { stdio: "ignore" });
});
