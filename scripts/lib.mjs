// Shared by the curation server and the manifest builder: env, the
// Unsplash API, the manifest entry shape, and the picks file.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const picksPath = path.join(root, "picks.json");
export const manifestPath = path.join(root, "manifest.json");
export const sourcesPath = path.join(root, "sources.json");

const API = "https://api.unsplash.com";
const APP_NAME = "memo_daddy"; // utm_source Unsplash asks for on credit links
export const PER_PAGE = 30; // API maximum
// iPhone-proportioned crop (6.5" class at 3x). Imgix params on the hotlink
// URL; Unsplash requires the ixid it already carries to be kept.
export const CROP = "w=1290&h=2796&fit=crop&crop=entropy&q=80&fm=jpg";

export async function loadDotEnv() {
  try {
    const text = await readFile(path.join(root, ".env"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return process.env.UNSPLASH_ACCESS_KEY;
}

export async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; }
}
export async function writeJSON(file, value) {
  await writeFile(file, JSON.stringify(value, null, 2) + "\n");
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(route, params, key) {
  const url = new URL(API + route);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" } });
  const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? "1");
  if (res.status === 429 || remaining === 0) throw new ApiError("Unsplash rate limit hit; wait an hour", 429);
  if (!res.ok) throw new ApiError(`${route} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
  const body = await res.json();
  return { body, remaining };
}

/// One page of portrait candidates for a query or a collection.
export async function fetchPage(source, page, key, perPage = PER_PAGE) {
  let batch, remaining;
  if (source.collection) {
    ({ body: batch, remaining } = await api(`/collections/${source.collection}/photos`,
      { page, per_page: perPage, orientation: "portrait" }, key));
  } else {
    let result;
    ({ body: result, remaining } = await api("/search/photos",
      { query: source.query, page, per_page: perPage, orientation: "portrait", content_filter: "high" }, key));
    batch = result.results;
  }
  if (!Array.isArray(batch)) batch = [];
  return { photos: batch.filter((p) => p.height > p.width * 1.2).map(entry), remaining, more: batch.length === perPage };
}

export function entry(photo) {
  const username = photo.user?.username ?? "";
  const utm = `utm_source=${APP_NAME}&utm_medium=referral`;
  return {
    id: `unsplash-${photo.id}`,
    url: `${photo.urls.raw}&${CROP}`,
    color: photo.color ?? undefined,
    credit: {
      source: "unsplash",
      name: photo.user?.name ?? "Unknown",
      link: `https://unsplash.com/@${username}?${utm}`,
      sourceLink: `https://unsplash.com/?${utm}`,
      downloadLocation: photo.links?.download_location ?? undefined,
    },
  };
}

export const isUnsplash = (e) => String(e.id).startsWith("unsplash-");
export { isCurated, SOURCES, parseTerm } from "./sources.mjs";

/// picks.json: `kept` holds full entries in rotation order (the record of
/// what was chosen, so the manifest never needs the API to rebuild);
/// `rejected` holds ids that must not come back.
export async function readPicks() {
  const picks = await readJSON(picksPath, { kept: [], rejected: [] });
  picks.kept ??= []; picks.rejected ??= [];
  return picks;
}

/// manifest.json = the hand-added entries already in it (kept in front,
/// in their order) + the kept picks (any library) in picks order.
export async function buildManifest(picks) {
  const { isCurated } = await import("./sources.mjs");
  const existing = await readJSON(manifestPath, { images: [] });
  const handAdded = (existing.images ?? []).filter((e) => !isCurated(e));
  const manifest = { images: [...handAdded, ...picks.kept] };
  await writeJSON(manifestPath, manifest);
  return manifest;
}
