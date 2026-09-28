#!/usr/bin/env node
// Rebuilds manifest.json from Unsplash: the collections and search queries
// in sources.json become portrait, phone-cropped, hotlinked entries with the
// photographer credit and download-tracking URL the Unsplash API terms need.
// Hand-added entries (ids not starting with "unsplash-") are kept, in front.
//
// Usage:  UNSPLASH_ACCESS_KEY=... node scripts/pull-unsplash.mjs [--dry-run]
// The key is the app's public Access Key (a client id); it never lands in
// the manifest. A .env file next to this repo's root is read if present.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

const API = "https://api.unsplash.com";
const APP_NAME = "memo_daddy"; // utm_source Unsplash asks for on credit links
const PER_PAGE = 30; // API maximum
// iPhone-proportioned crop (about 6.5" class at 3x). Imgix params on the
// hotlink URL; Unsplash requires the ixid it already carries to be kept.
const CROP = "w=1290&h=2796&fit=crop&crop=entropy&q=80&fm=jpg";

async function loadDotEnv() {
  try {
    const text = await readFile(path.join(root, ".env"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

async function api(route, params, key) {
  const url = new URL(API + route);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" } });
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (res.status === 429 || remaining === "0") fail("Unsplash rate limit hit; wait an hour and rerun");
  if (!res.ok) fail(`${route} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/// Photos for one source, paged until `want` portrait photos are in hand.
async function fetchSource(source, want, key) {
  const photos = [];
  for (let page = 1; photos.length < want && page <= 10; page++) {
    const perPage = Math.min(PER_PAGE, want - photos.length);
    let batch;
    if (source.collection) {
      batch = await api(`/collections/${source.collection}/photos`, { page, per_page: perPage, orientation: "portrait" }, key);
    } else {
      const result = await api("/search/photos", { query: source.query, page, per_page: perPage, orientation: "portrait", content_filter: "high" }, key);
      batch = result.results;
    }
    if (!Array.isArray(batch) || batch.length === 0) break;
    photos.push(...batch.filter((p) => p.height > p.width * 1.2));
    if (batch.length < perPage) break;
  }
  return photos.slice(0, want);
}

function entry(photo) {
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

/// Round-robin across sources so consecutive days come from different moods.
function interleave(lists) {
  const out = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const list of lists) if (list[i]) out.push(list[i]);
  return out;
}

await loadDotEnv();
const key = process.env.UNSPLASH_ACCESS_KEY;
if (!key) fail("set UNSPLASH_ACCESS_KEY (or put it in .env)");

const sources = JSON.parse(await readFile(path.join(root, "sources.json"), "utf8"));
const list = [
  ...(sources.collections ?? []).map((collection) => ({ collection, label: `collection ${collection}` })),
  ...(sources.queries ?? []).map((query) => ({ query, label: `query "${query}"` })),
];
if (list.length === 0) fail("sources.json has no collections or queries");
const perSource = sources.perSource ?? 20;
const maxImages = sources.maxImages ?? 120;

const manifestPath = path.join(root, "manifest.json");
let existing = { images: [] };
try { existing = JSON.parse(await readFile(manifestPath, "utf8")); } catch {}
const handAdded = (existing.images ?? []).filter((e) => !String(e.id).startsWith("unsplash-"));

const fetched = [];
for (const source of list) {
  const photos = await fetchSource(source, perSource, key);
  console.log(`${source.label}: ${photos.length} portrait photos`);
  fetched.push(photos.map(entry));
}

const seen = new Set(handAdded.map((e) => e.id));
const unsplash = interleave(fetched).filter((e) => !seen.has(e.id) && seen.add(e.id)).slice(0, maxImages);
const manifest = { images: [...handAdded, ...unsplash] };

console.log(`manifest: ${handAdded.length} hand-added + ${unsplash.length} Unsplash = ${manifest.images.length} days per cycle`);
if (dryRun) {
  console.log(JSON.stringify(manifest.images.slice(0, 2), null, 2));
} else {
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), manifestPath)}`);
}
