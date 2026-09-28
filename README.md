# memo daddy · daily backgrounds

The curated photo set behind the app's **Daily** theme. The app fetches
`manifest.json` once a day, shows one image per day in list order (wrapping),
and caches each image on the phone. Pushing to `main` is all it takes to
change the rotation — no app update.

## Unsplash rotation (the usual way)

Most of the rotation comes from Unsplash. Edit `sources.json`: add the ids of
collections you curate on your Unsplash account (the number in
`unsplash.com/collections/<id>/…`) and/or search queries for moods. Then:

```sh
echo 'UNSPLASH_ACCESS_KEY=…' > .env   # the app's public Access Key; .env is gitignored
npm run pull                          # rewrites manifest.json
git commit -am "Refresh rotation" && git push
```

Sources are interleaved so consecutive days come from different moods;
`perSource` and `maxImages` cap the pull. Every Unsplash entry carries a
`credit` (name, profile link with the utm tags Unsplash asks for, and the
download-tracking URL the app pings when it shows the photo) so the app
meets the API terms. The key is a demo-tier one (50 requests/hour); a full
pull is about one request per 30 photos.

Rerunning reorders the Unsplash part of the list, which shifts days; that's
fine. Hand-added entries below stay in front, in their order.

## Adding an image by hand

1. Drop a portrait JPEG into `images/` — about 1200 × 2600 px, no UI or text
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

The first entry is a stand-in crop from the mock that inspired the theme.
