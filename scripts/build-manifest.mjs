#!/usr/bin/env node
// Rewrites manifest.json from picks.json (plus the hand-added entries the
// manifest already holds). `npm run curate` does this on every change;
// run this after editing picks.json by hand.
import { readPicks, buildManifest } from "./lib.mjs";

const picks = await readPicks();
const manifest = await buildManifest(picks);
const hand = manifest.images.length - picks.kept.length;
console.log(`manifest.json: ${hand} hand-added + ${picks.kept.length} kept = ${manifest.images.length} days per cycle (${picks.rejected.length} rejected ids on file)`);
