# memo daddy · daily backgrounds

The curated photo set behind the app's **Daily** theme. The app fetches
`manifest.json` once a day, shows one image per day in list order (wrapping),
and caches each image on the phone. Pushing to `main` is all it takes to
change the rotation — no app update.

## Curating the rotation (the usual way)

```sh
echo 'UNSPLASH_ACCESS_KEY=…' > .env   # once; the app's public Access Key, gitignored
npm run curate                        # opens http://localhost:4747
```

The page shows each candidate inside a mock of the app's front page,
dressed in the palette the app will derive from it (same colour maths as
the app, light or dark scheme included). The search box takes:

- plain words → Unsplash photos
- `collection:<id>` → one of your Unsplash collections
- `aic: japanese woodblock print` → the Art Institute of Chicago's
  public-domain works (CC0, no key; every word must match somewhere in
  artist, title or subject, so `aic: hokusai` is precise)
- `met: carp dept:6` → the Met's open-access works (no key; its search
  is loose, `dept:N` narrows it — 6 Asian Art, 9 Drawings and Prints)

or pick a library in the dropdown and press **Browse** (or just pick it:
that browses straight away) to see its pictures with no keywords at all —
Unsplash random portraits, a random sample of the Art Institute's
prints, paintings and drawings, a random sample of the Met's Asian Art
and Drawings & Prints. **More** loads another batch. "All sources"
interleaves the three so you can compare their character. Or press
**Load sources.json** to queue every query listed there. Museum
pieces are credited "Artist · Library" in the app, both linked; only
portrait or square works are offered. Then:

- `→` / `K` keep · `←` / `X` reject · `space` skip · `⌫` undo · `U` unkeep
- **Review kept** steps through what's already in the rotation.
- The strip at the bottom is the rotation in day order: drag to reorder,
  click to view.

Every decision writes `picks.json` and rebuilds `manifest.json` on the
spot, so when you're done it's just:

```sh
git commit -am "Curate rotation" && git push
```

Rejected photos never come back in later searches. `npm run build`
rebuilds the manifest from `picks.json` if you edit that file by hand.
The key is a demo-tier one (50 API requests/hour); a search page is one
request, and the counter is in the page header.

## Adding an image by hand

1. Drop a portrait JPEG into `images/` (create the folder) — about 1200 × 2600 px, no UI or text
   painted on it, and keep the middle third fairly quiet (that's where the
   wordmark and tuner link sit; the record button and nav sit over the bottom).
2. Add a line to `manifest.json`:

   ```json
   { "id": "beach-01", "url": "https://raw.githubusercontent.com/gleyzeddonut/memodaddy-daily/main/images/beach-01.jpg" }
   ```

   `id` must be unique and stable — it names the phone's cache file.
3. Commit and push.

The order of the list is the order of days. Removing an entry shifts the
days after it; that's fine.

