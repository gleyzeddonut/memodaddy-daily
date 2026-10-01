# Handoff · Daily theme backgrounds

Read this before touching the Daily theme in either repo. Last rewritten
2026-10-01 (state as of the night of Sep 28–29). The app's own handoff
(`mumo/HANDOFF.md`) covers the rest of the app; its Daily bullets point
here.

## What this is

Memo Daddy (the `mumo` repo, iOS + Mac voice memo app) has a **Daily**
theme: one full-bleed portrait picture on the iOS front page that changes
every local midnight, KlydoClock-style, with the app's colours derived
from the picture. Dan has no artists yet, so pictures come from free
libraries, hand-picked on a local curation page. When artists arrive,
their images are just more manifest entries.

## Current state

- **Rotation live on `main`:** 250 kept pictures (174 Unsplash photos,
  36 Art Institute of Chicago, 30 Unsplash illustrations, 10 Met), 193
  rejected ids on file, 24 pinned days (22 holidays + 2 by hand).
- **App:** v1.3 **build 37** on TestFlight (iOS, uploaded 2026-09-29
  00:18) — the first build that shows pins. Build 36 the evening before
  carried the rest of the Daily work. The Mac build is still 35 (Daily
  is iOS-only; the Mac target builds). The front-page preview arrow
  (`DailyBackgrounds.previewControlsEnabled`) is still **on**; turn it
  off before a build meant for anyone beyond testers.
- **Unsplash key:** demo tier, 50 API requests/hour, shared by the
  curation page and every phone's daily ping. The production
  application (1,000/h) is drafted in
  `~/Documents/CLAUDE/background pics/unsplash-application/` with
  screenshots; Dan submits it himself.

## The two repos

| Repo | Visibility | Role |
|---|---|---|
| `github.com/gleyzeddonut/memodaddy-daily` (this one, clone at `~/Documents/CLAUDE/memodaddy-daily`) | public | Curation. `npm run curate` → `picks.json` → `manifest.json`. Pushing `main` changes every phone's rotation, no app release. **Never commit `.env`** (the Unsplash key). |
| `github.com/gleyzeddonut/mumo` (clone at `~/Documents/CLAUDE/mumo`) | private | The app. Reads the manifest, shows the picture, credit and derived palette, pings Unsplash. |

## Data flow, one phone, one day

1. On every launch and foreground, **in any theme**, `prefetch()` runs
   once per local day: fetches
   `https://raw.githubusercontent.com/gleyzeddonut/memodaddy-daily/main/manifest.json`
   (GitHub's raw CDN caches ~5 min), caches it, downloads today's and
   tomorrow's pictures (pins included) and stores their colours. So
   picking Daily, or the midnight rollover, is instant.
2. In the Daily theme, `DailyBackgrounds.init` shows the cached picture
   and stored palette **synchronously** (today's, else the last shown),
   so the first frame is never white; `refreshIfNeeded()` then applies
   the cached manifest and re-fetches.
3. The day's picture = `DailyBackgrounds.entry(for:in:)`: an exact-date
   pin ("YYYY-MM-DD") beats a yearly pin ("MM-DD") beats the rotation
   entry (days since 2026-01-01 local midnight, mod list length).
4. Images: phone cache (`Application Support/DailyBackgrounds/<id>.img`)
   → HTTPS download (≤12 MB). Unsplash images are hotlinked from
   `images.unsplash.com` (no rate limit); AIC via its IIIF server with a
   phone-aspect crop; the Met as originals.
5. `DailyColors.extract` reads the decoded image (vivid hue vote, average
   colour, luma, plus the patches behind the tuner link and the record
   button); `Theme.daily(from:)` builds the palette; stored per id in
   UserDefaults as `dailyColors.v<schemaVersion>.<id>`.
6. For Unsplash entries the app GETs `credit.downloadLocation` once per
   picture per process (`Authorization: Client-ID <key>`). This is the
   **only** call that counts against the API limit. Preview steps don't
   ping.

## Manifest schema

```json
{ "images": [
  { "id": "unsplash-QsWG0kjPQRY",
    "url": "https://images.unsplash.com/photo-…?ixid=…&w=1290&h=2796&fit=crop&crop=entropy&q=80&fm=jpg",
    "color": "#f3d9f3",
    "credit": { "source": "unsplash", "name": "Filip Zrnzević",
      "link": "https://unsplash.com/@filipz?utm_source=memo_daddy&utm_medium=referral",
      "sourceLink": "https://unsplash.com/?utm_source=memo_daddy&utm_medium=referral",
      "downloadLocation": "https://api.unsplash.com/photos/QsWG0kjPQRY/download?ixid=…" } },
  { "id": "aic-21043",
    "url": "https://www.artic.edu/iiif/2/<image id>/pct:19.86,0,60.28,100/!1290,2796/0/default.jpg",
    "title": "Freeing a captured bird", "detail": "c. 1769/70 · woodblock print",
    "credit": { "source": "aic", "sourceName": "Art Institute of Chicago", "name": "Suzuki Harunobu",
      "link": "https://www.artic.edu/artworks/21043", "sourceLink": "https://www.artic.edu" } }
 ],
 "pins": [
  { "date": "10-31", "holiday": "Halloween", "query": "Halloween", "image": { …an entry as above… } },
  { "date": "2026-12-05", "holiday": "Hanukkah", "image": { … } }
 ] }
```

- `id`: unique, stable, ≤64 chars of `[A-Za-z0-9_-]`; it names the
  phone's cache file. Prefix = library: `unsplash-`, `ill-`
  (Unsplash illustrations), `aic-`, `met-`. Anything else is
  "hand-added" and the builder keeps it in front.
- `url`: HTTPS only. `color`, `title`, `detail`, `credit`, `pins` optional;
  older manifests and older apps are fine without them.
- Credit line in the app: `sourceName` set → "Artist · Library" (both
  linked); `source` = unsplash → "Photo by Name on Unsplash" (both
  linked; illustrations set `sourceName: "Unsplash"` → "Name · Unsplash");
  else "Photo by Name".
- `DailyManifest.validated` drops entries with unsafe ids/URLs and strips
  non-HTTPS links inside `credit`; pins are validated the same way.
- List order = day order. Reordering shifts what lands on which day;
  that's accepted.

## The curation page

```sh
cd ~/Documents/CLAUDE/memodaddy-daily
npm run curate        # node scripts/curate.mjs → http://localhost:4747 (binds 127.0.0.1)
git commit -am "Curate rotation" && git push
```

**Etiquette.** Dan runs this himself and asked that agents not restart
it. The server keeps picks in memory and writes `picks.json` +
`manifest.json` on every change, so never run a second server against
the same files; test on a throwaway copy of the repo (rsync without
`.git`, `PORT=4748`). To change his picks from outside, call his
server's API (`/api/order`, `/api/pin`, …) so memory and disk agree.
If the port is busy the script now says so and opens the running page.
Server-side changes (anything under `scripts/`) need
`pkill -f scripts/curate.mjs && npm run curate`; page changes
(`curate/`) just need a reload — the server sends `no-store`.

**Files.** `scripts/curate.mjs` (server), `scripts/lib.mjs` (Unsplash
api, entry shape, picks, manifest builder), `scripts/sources.mjs`
(library adapters, `parseTerm`, `isCurated`), `scripts/holidays.mjs`
(date rules), `scripts/build-manifest.mjs` (`npm run build` after hand
edits to picks), `curate/index.html`, `curate/app.js`,
`curate/palette.js` (a line-for-line port of `DailyColors.extract`,
`Theme.daily`, `legibleAccent` — **if the Swift changes, change this
too**; it is what makes the mock honest), `holidays.json`,
`sources.json` (queries the **Load sources.json** button queues),
`picks.json` (source of truth: `kept` in day order, `rejected` ids,
`pins`, `settledIDs`).

**The mock** is a 390×844 front page with the app's layout numbers and
the derived palette: wordmark, tuner link (legible accent + a faint
word-shaped pool), record ring/fill judged on their own patch, credit
above the wordmark, nav. The side panel prints the palette, the
worst-case contrast of the tuner link and ring, and the artist/title.

**Libraries** (`SOURCES` in `sources.mjs`; adding one = one adapter
object with `page(query, page, perPage, ctx)` and `browse(perPage, ctx)`,
`ctx = { api, entry, key }`):

| picker / prefix | badge | what | notes |
|---|---|---|---|
| Unsplash photos (no prefix) | U | `/search/photos`, `/photos/random` | 1 API call per page |
| Unsplash illustrations `ill:` | ILL | `/search/illustrations` | same key; browse = random broad word + random page (2 calls) |
| Art Institute of Chicago `aic:` | AIC | POST search, exact cross-field `multi_match`, `is_public_domain`; IIIF `pct:` crop | free, no key; browse = random 40k id window (API ignores random_score, caps at 1,000) |
| The Met `met:` | MET | `search` + one `objects/{id}` per hit, `dept:N` | free, no key, loose search, big originals; browse samples random ids from depts 6\|9, ~⅓ hit rate, slow |

Library of Congress WPA posters and Wellcome Collection were wired and
removed the same night ("posters are not the right vibe"); adapters at
`0551ef2` if ever wanted. Rijksmuseum / Smithsonian / Openverse need
free keys and aren't wired.

**Page controls.** Source picker (scopes searches, filters the kept
strip; "All sources" searches/browses every library and interleaves in
random order). **Browse** (keyword-less, random batch; fires on picker
change), **More** (append), search box (plain words, or `prefix: …`,
`collection:<id>`, `met: carp dept:6`), **Load sources.json**, **Review
kept**. Keys: → / K keep, ← / X reject, space skip, ⌫ undo, U unkeep.
Kept strip: drag to reorder, click to view, **Shuffle (mix sources)**
(shuffles within each library, then spreads every library evenly over
the rotation; **Undo shuffle**), **Spread N new picks** (keeps since the
last shuffle/spread slotted evenly into the settled order; needs
`settledIDs`, which Shuffle/Spread write). Every thumb carries a source
badge; the kept header counts per source.

**Pins.** Side panel "Pin to a day": `MM-DD` (yearly) or `YYYY-MM-DD`
(once); one picture per date; the picture need not be kept. The footer
row "▸ pinned days" folds/unfolds the chips (click to view, ✕ unpin;
holiday pins have a **re-roll** button). `POST /api/pin {date, entry}`,
`/api/unpin {date}`.

**Holidays.** `holidays.json`: 23 entries with `name`, `date`, `query`
(a phrase or a list of phrases, pooled; by default just the name —
Day of the Dead, Hanukkah, Kwanzaa, Juneteenth have extras), optional
`sources` (default `["ill", "aic"]`). Date rules (`scripts/holidays.mjs`):
fixed `MM-DD` stays yearly; `easter[±N]`, `Nth-weekday-MM`,
`last-weekday-MM` and `table` (a year→MM-DD map, used for Hanukkah
2026–2030 — extend it before 2031) resolve to `YYYY-MM-DD` for this year
and next. **Auto-pin holidays** pins a random portrait match for every
unpinned date (`POST /api/holidays/auto {}`); **re-roll** on a chip
(`{date}`) draws an unseen picture from that holiday's pool, fetches the
next page when the pool runs dry, wraps only when the libraries have
nothing else, and says why if nothing can be picked. Pools live for the
server's lifetime (so re-rolls are free); a full first run costs ~1
Unsplash call per phrase per Unsplash source.

## Unsplash terms this must keep satisfying

- **Hotlink**, never re-host photos obtained through the API.
- **Attribute** photographer and Unsplash, both linked, utm-tagged
  (`DailyCredit.attributedLine`).
- **Ping `download_location`** when a picture is used as a background
  (once per picture per run; not for preview steps or museum pieces).
- The Access Key is a public client id: in this repo's gitignored
  `.env`, in `~/Documents/CLAUDE/background pics/.env`, and as
  `DailyBackgrounds.unsplashAccessKey` in the private app repo. No
  secret key is in use anywhere.
- Rate maths: one ping per phone per day; past ~50 phones in the same
  hour it is throttled silently. Apply for production (1,000/h) when
  user numbers grow.

## App-side file map (mumo)

- `Mumo/Daily/DailyBackgrounds.swift`: `DailyImage`, `DailyCredit`
  (`line`, `attributedLine`, `validated`), `DailyPin`, `DailyManifest`
  (`validated`, `validate`), `DailyBackgrounds` (`init` warm start,
  `entry(for:in:offset:)`, `index(for:count:offset:)`, `refreshIfNeeded`
  / `refresh` / `fetchManifest`, `apply`, `prefetch`, `cachedImage` /
  `load`, stored colours, `registerDisplay` / `downloadPingRequest`,
  `unsplashAccessKey`, preview: `previewControlsEnabled`,
  `showNextPhoto()`, `-dailyPreviewOffset N` launch arg in Debug).
- `Mumo/Daily/DailyPalette.swift`: `DailyColors` (Codable, `schemaVersion`
  2) and `extract(from:)` — vivid-hue vote (dark pixels don't vote),
  average colour + luma, mean/25th/75th-percentile luminance of the
  tuner-link patch and the record-button patch.
- `Mumo/Views/Theme.swift`: `Theme.dailyPalette`, `Theme.daily(from:)`
  (surfaces from the average colour; accent legible on the page;
  `Palette.linkAccent` legible over the link patch to 4.5:1; record ring
  near-neutral and fill a bounded red, each to 3:1 over the button
  patch), `legibleAccent`, `contrastRatio`, `relativeLuminance`,
  `hsbHex`. Daily derivation is `#if os(iOS)` so the Mac builds.
- `Mumo/Views/FrontPageView.swift`: `dailyBackdrop`, `wordFade` /
  `photoFade` (faint pools, 0.16, as the element's own background),
  `creditLine` (above the wordmark, right-aligned, 22%), the preview
  arrow, `nextPhotoButton`. `BottomNav.swift`: `AccentTextButtonStyle`
  reads `Theme.linkAccent`.
- `Mumo/Views/ContentView.swift`: owns `DailyBackgrounds`, re-keys the
  tree on theme + `currentID` + `paletteVersion`, calls `prefetch()` on
  launch/foreground and `refreshIfNeeded()` in Daily.
- Tests: `MumoTests/DailyBackgroundsTests.swift` (18: index maths,
  decoding, validation, credits, ping scoping, preview offset, warm
  start, prefetch via a `StubURLProtocol`, pins) and
  `MumoTests/DailyPaletteTests.swift` (18: extraction on synthetic
  images, palette light/dark, link and button legibility).

## Verifying, screenshots, releasing

- **Simulators.** Dan debugs on `28B7ACA0-…` (iPhone 17 Pro) — don't
  install/terminate there. Use `6F2AE673-33E6-425E-B6C0-ED1E8AF3452C`
  for tests (mic + location granted via `simctl privacy`; code signing
  must stay ON: with `CODE_SIGNING_ALLOWED=NO` the iCloud entitlement is
  missing and `CKContainer` traps at launch). The iPhone 17 Pro Max
  `3D2CFE00-…` gives 1320×2868 = Apple's 6.9" App Store size; shots in
  `~/Documents/CLAUDE/background pics/app-store-screenshots/`.
- **Pick a picture headlessly:** build with `previewControlsEnabled`
  flipped false (don't commit), then
  `simctl launch <sim> com.dangleyzer.Mumo -dailyPreviewOffset N [-tuning]`;
  offsets are relative to today's index in the *published* manifest.
  Never swap cache bytes under another id for shots — the credit would
  be wrong.
- **Preview a manifest without pushing:** copy it to the app container's
  `Library/Application Support/DailyBackgrounds/manifest.json`; the app
  applies the cache before the network.
- **Release ritual (iOS, headless, proven for 36 and 37):** full suite
  green → bump all four `CURRENT_PROJECT_VERSION` → commit "Bump build
  number to N" → tag `v1.3-buildN` → push with tags →
  `xcodebuild archive … -configuration Release -destination
  'generic/platform=iOS' -archivePath build/Notable-1.3-N.xcarchive
  -allowProvisioningUpdates` → `-exportArchive` with
  `build/ExportOptions-ios.plist` → `xcrun altool --validate-app` then
  `--upload-app -t ios --apiKey P36BNCBRMP --apiIssuer <issuer>` →
  record the delivery UUID in `mumo/HANDOFF.md`.

## Known gaps / likely next asks

- Turn off `previewControlsEnabled` before a wider build.
- Mac TestFlight build is behind (35); Daily doesn't exist there.
- Dan's taste brief: "made pictures, not nature photos, not classical
  paintings" (his references: a shin-hanga print of blue fish; a 1970s
  gouache garden). AIC has almost no Koson and no public-domain Hasui;
  Hokusai/Hiroshige/Harunobu are plentiful. The gouache-illustration mood
  has no free library in quantity; generation was offered, undecided.
- Artists, when they come: hand-added entries (any HTTPS URL, `credit`
  with `sourceName` for "Name · Studio" or `source` unset for "Photo by").
- Unsplash collections: `collection:<id>` works once Dan curates some.
- `index(for:)` counts from the epoch's *local* start of day, so US zones
  are one day ahead of a naive UTC `days % count`; the `-dailyPreviewOffset`
  trick sidesteps that.
- The raw GitHub URL is fine at current scale; any static HTTPS host
  would do if it ever isn't.

## History

- Sep 25: Daily theme with a one-image bundled set and the remote
  manifest scaffold.
- Sep 28: Unsplash feed (pull script, credit + ping), first 120-entry
  rotation; photo-matched palette; curation page replacing the pull;
  tuner/ring/fill legibility rules; credit above the wordmark; prefetch
  + warm start; bundled cat removed; museum libraries; browse; shuffle;
  pins; holidays. Builds 36 and 37 to TestFlight.
- Sep 29: Hanukkah + Kwanzaa, multi-phrase holiday searches, re-roll
  walks the pool, foldable pins row. Rotation pushed at 250.
