# Handoff · Daily theme backgrounds (Unsplash feed)

Read this before touching the Daily theme in either repo. Last updated
2026-09-28, when the Unsplash feed went live. The app's own handoff
(`mumo/HANDOFF.md`) covers the rest of the app; its Daily-theme bullet
points here.

## What this is

Memo Daddy (the `mumo` repo, iOS + Mac voice memo app) has a **Daily**
theme: Classic colours plus one full-bleed portrait photo on the iOS
front page that changes every local midnight, KlydoClock-style. Dan has
no artists yet, so the rotation comes from Unsplash. When artists arrive,
their images go in the same manifest as hand-added entries; nothing
structural changes.

## The two repos

| Repo | Visibility | Role |
|---|---|---|
| `github.com/gleyzeddonut/memodaddy-daily` (this one, clone at `~/Documents/CLAUDE/memodaddy-daily`) | public | Curation. `npm run curate` (browser page) → `picks.json` → `manifest.json`. Pushing `main` changes every phone's rotation, no app release. |
| `github.com/gleyzeddonut/mumo` (clone at `~/Documents/CLAUDE/mumo`) | private | The app. Reads the manifest, shows the photo and credit, pings Unsplash. |

## Data flow, one phone, one day

1. `DailyBackgrounds.refreshIfNeeded()` runs on foreground when the theme
   is Daily. It applies the **cached** manifest (or the bundled one on
   first run) immediately, then fetches
   `https://raw.githubusercontent.com/gleyzeddonut/memodaddy-daily/main/manifest.json`,
   caches it, and applies that. (GitHub's raw CDN caches for ~5 min, so a
   push is not instant.)
2. Entry index = days since 2026-01-01 (local midnight), mod list length.
   `DailyBackgrounds.index(for:count:)`.
3. The entry's image loads: bundled file → phone cache
   (`Application Support/DailyBackgrounds/<id>.img`) → HTTPS download
   (≤12 MB). Unsplash images are hotlinked from `images.unsplash.com`,
   a CDN with no rate limit.
4. `image`, `credit` and `currentID` publish; `FrontPageView` draws the
   photo and the credit line.
5. If the entry has `credit.downloadLocation` on `api.unsplash.com`, the
   app sends one GET with `Authorization: Client-ID <key>`, once per
   photo per process, fire-and-forget. This is the **only** call that
   counts against the Unsplash API rate limit.

Only iOS. The Mac theme picker hides Daily (`AppTheme.macCases`).

## Manifest schema

```json
{ "images": [
  { "id": "cat-lounge", "url": "https://raw.githubusercontent.com/.../images/cat-lounge.jpg" },
  { "id": "unsplash-QsWG0kjPQRY",
    "url": "https://images.unsplash.com/photo-…?ixid=…&w=1290&h=2796&fit=crop&crop=entropy&q=80&fm=jpg",
    "color": "#f3d9f3",
    "credit": {
      "source": "unsplash",
      "name": "Filip Zrnzević",
      "link": "https://unsplash.com/@filipz?utm_source=memo_daddy&utm_medium=referral",
      "sourceLink": "https://unsplash.com/?utm_source=memo_daddy&utm_medium=referral",
      "downloadLocation": "https://api.unsplash.com/photos/QsWG0kjPQRY/download?ixid=…"
    } }
] }
```

- `id`: unique, stable, ≤64 chars of `[A-Za-z0-9_-]`; it names the
  phone's cache file. Unsplash ids are `unsplash-<photo id>`; the pull
  script treats any other prefix as hand-added and keeps it in front.
- `url` (remote) or `file` (bundled resource name). HTTPS only.
- `color`, `credit` optional. Older manifests without them still decode.
- App-side `DailyManifest.validated` drops entries with unsafe ids/URLs
  and strips non-HTTPS links inside `credit` (keeping the entry).
- List order = day order. Reordering shifts days; that's accepted.

## Curation workflow

`picks.json` is the source of truth: `kept` = full entries in rotation
order, `rejected` = ids that must not come back. `manifest.json` = the
hand-added entries already in it + `kept`, rebuilt by every curation
decision and by `npm run build`.

```sh
cd ~/Documents/CLAUDE/memodaddy-daily
npm run curate        # node scripts/curate.mjs → http://localhost:4747 (binds 127.0.0.1)
git commit -am "Curate rotation" && git push
```

The page (`curate/index.html`, `curate/app.js`) renders each candidate in
a 390×844 mock of the front page using the app's layout numbers (wordmark
at 150/257 left 20, tuner link at 392, ring bottom edge 128 up, credit
right 20 / bottom 96 at 22%, nav row 34–78) and the palette from
`curate/palette.js`, a line-for-line port of `DailyColors.extract` and
`Theme.daily(from:)`. **If the Swift changes, change palette.js too** —
that port is what makes the mock honest. Image bytes go through the
server's `/img` proxy (hosts: images.unsplash.com, raw.githubusercontent
.com) so the canvas can read pixels. The Unsplash key never reaches the
page; the server makes the API calls (`/api/search?q=…|collection=…`).
POST `/api/keep|reject|clear|order` write picks and rebuild the manifest.

`sources.json` is now just a list the **Load sources.json** button can
queue (queries and collection ids); it no longer feeds the manifest by
itself. There is no automatic pull any more: nothing enters the rotation
without a keep.

## Unsplash terms this must keep satisfying

- **Hotlink**, never re-host photos obtained through the API (the site's
  download button + hand-added entry is the legal way to own a file).
- **Attribute**: "Photo by <name> on Unsplash", with the utm-tagged
  links. The app shows it; the script writes it.
- **Ping `download_location`** when a photo is used as a background. The
  app does, once per photo per run.
- The Access Key is a public client id. It lives in this repo's
  gitignored `.env`, in `~/Documents/CLAUDE/background pics/.env`, and
  as `DailyBackgrounds.unsplashAccessKey` in the (private) app repo.
  Never commit it here. There is no secret key in use anywhere.
- Rate limit maths: one ping per phone per day. Past ~50 phones opening
  in the same hour the ping is throttled; nothing visible breaks, it
  only under-reports. Fix at that point: apply for production on
  unsplash.com/developers (free, raises to 5,000/h; they raise further
  on request for popular apps).

## App-side file map (mumo)

- `Mumo/Daily/DailyBackgrounds.swift`: `DailyImage`, `DailyCredit`
  (`line`, `validated`), `DailyManifest.validated`, the `@Observable`
  `DailyBackgrounds` (index maths, refresh, cache, load, `credit`,
  `downloadPingRequest(for:accessKey:)`, `unsplashAccessKey`).
- `Mumo/Daily/DailyPalette.swift`: `DailyColors.extract(from:)` — on-device
  colour extraction (vivid hue vote, brightness-gated; average colour;
  light/dark by luma). `Theme.daily(from:)` in `Views/Theme.swift` builds
  the palette; `Theme.dailyPalette` holds it while the theme is Daily and
  is written by `DailyBackgrounds` before the image publishes. ContentView
  re-keys its tree on theme + `currentID`. Works for any image, so artist
  and hand-added photos get matched colours too; the manifest `color`
  field is informational only.
- Tuner-link legibility (mumo `Theme.legibleAccent`, `Palette.linkAccent`,
  `DailyColors.linkRegionLuminance`): the accent is re-depthed to clear
  4:1 over the photo patch behind the link; the page mirrors it
  (`legibleAccent`, `LEGIBILITY_TARGET` in palette.js) and prints
  "tuner contrast over the photo N:1", flagging a fall-back to plain
  black/white. Photos that pass on average but look busy behind the
  link are still a taste call — reject them.
- `Mumo/Views/FrontPageView.swift`: `dailyImage`, `dailyCredit` inputs;
  `dailyBackdrop` (photo + page-colour gradient, 18% while recording);
  `creditLine` (11pt medium, 22% opacity, right-aligned with 20pt
  trailing, fade mask over the padded box so descenders survive, text
  bottom ~96pt off the screen bottom, i.e. between the record ring
  (bottom edge at 128pt) and the nav (~78pt); hidden unless mode is
  idle/saved; tap opens `credit.link`).
- `Mumo/Views/ContentView.swift`: owns `DailyBackgrounds`, passes image
  and credit when `appTheme == daily`, calls `refreshIfNeeded()` on
  foreground/theme change.
- `Mumo/Resources/DailyBackgrounds/`: bundled fallback (`manifest.json`
  + `cat-lounge.jpg`). Xcode copies these flat; `bundledURL` tries both.
- `MumoTests/DailyBackgroundsTests.swift`: 9 tests (index maths,
  decoding, validation, credit line, ping request scoping).
  `MumoTests/DailyPaletteTests.swift`: 5 (extraction on synthetic images,
  derived palette light/dark, muted accents stay muted).

## Verifying

```sh
# unit tests (needs code signing ON: with CODE_SIGNING_ALLOWED=NO the
# iCloud entitlement is missing and CKContainer traps at launch)
cd ~/Documents/CLAUDE/mumo
xcodebuild test -project Mumo.xcodeproj -scheme Mumo \
  -destination 'platform=iOS Simulator,id=28B7ACA0-0AC4-4C96-B5CA-B7A366207A6F' \
  -derivedDataPath build/test -only-testing:MumoTests/DailyBackgroundsTests

# see a manifest on the simulator WITHOUT pushing it
SIM=28B7ACA0-0AC4-4C96-B5CA-B7A366207A6F
xcrun simctl spawn $SIM defaults write com.dangleyzer.Mumo appTheme daily
C=$(xcrun simctl get_app_container $SIM com.dangleyzer.Mumo data)
mkdir -p "$C/Library/Application Support/DailyBackgrounds"
cp manifest.json "$C/Library/Application Support/DailyBackgrounds/manifest.json"
xcrun simctl launch $SIM com.dangleyzer.Mumo
xcrun simctl io $SIM screenshot front.png
```

The app applies the cached manifest before the network one, so the
seeded file shows immediately; the remote fetch then replaces it if it
succeeds, which is fine once main matches.

## Known gaps / likely next asks

- **Sep 28 (later):** curation page added; `picks.json` replaces the
  automatic pull, rejects are remembered. The 119 photos from the first
  pull were seeded as kept, unreviewed — Dan meant to go through them.
- **No collections yet.** `collection:<id>` in the search box works once
  Dan has some.
- **Production approval** on Unsplash when user numbers grow.
- **Artists.** Their images are hand-added entries (`images/` + manifest)
  or, if hosted elsewhere, any HTTPS URL; add a `credit` with
  `source` unset so the line reads "Photo by <name>".
- The ping fires only when the photo is first applied in a process; a
  phone left open across midnight applies the next day's photo on the
  next foreground, which also pings. Good enough.
- `index(for:)` counts days from the epoch's *local* start of day
  (epoch is 2026-01-01 00:00 UTC), so in US zones the app is one day
  ahead of a naive UTC `days % count`. Harmless; just don't expect a
  quick script to name today's entry without mirroring that.
- The raw GitHub URL is a fine origin at current scale (one JSON fetch
  per phone per day). If it ever isn't, put the manifest behind any
  static host; the app only needs an HTTPS URL that returns this JSON.

## History

- Sep 25: Daily theme built with a one-image bundled set and the remote
  manifest scaffold.
- Sep 28: Unsplash feed (pull script, credit + ping in the app), first
  120-entry rotation pushed. mumo `42324e9`, memodaddy-daily `d554cf9`.
- Sep 28, later: photo-matched palette in the app (mumo `97ccda4`), then
  the curation page here replacing the pull script (`bc92b99`), then the
  tuner-link legibility rule in both.
