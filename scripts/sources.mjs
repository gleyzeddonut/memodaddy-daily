// Libraries the curation page can browse. Each adapter turns one page of a
// search into manifest entries: { id, url, color?, credit, title?, detail? }
// with a hotlinked, phone-shaped (or at least portrait) HTTPS image and a
// credit the app can show. Ids carry the source prefix; the app's credit
// line reads "Photo by N on Unsplash" or "Artist · Library".

export const PHONE_ASPECT = 1290 / 2796;

/// IIIF region (pct:x,y,w,h) that crops a w×h image to the phone aspect.
export function phoneRegion(w, h) {
  if (!w || !h) return "full";
  const aspect = w / h;
  if (aspect > PHONE_ASPECT) {
    const cw = (PHONE_ASPECT * h / w) * 100;
    return `pct:${((100 - cw) / 2).toFixed(2)},0,${cw.toFixed(2)},100`;
  }
  const ch = (w / PHONE_ASPECT / h) * 100;
  return `pct:0,${((100 - ch) / 2).toFixed(2)},100,${ch.toFixed(2)}`;
}

const rand = (n) => Math.floor(Math.random() * n);
/// "clough, stanley thomas" → "Stanley Thomas Clough"; anything else just capitalised.
function personName(raw) {
  const cap = (t) => t.replace(/\b\w/g, (c) => c.toUpperCase());
  const [last, first] = raw.split(",").map((x) => x.trim());
  return first ? cap(`${first} ${last}`) : cap(raw);
}
const pick = (list) => list[rand(list.length)];

export const SOURCES = {
  // Unsplash illustrations — artist-uploaded, same license and API key as
  // the photos. Credit reads "Name · Unsplash" in the app; the download
  // ping applies as for photos.
  ill: {
    label: "Unsplash illustrations",
    idPrefix: "ill-",
    imageHost: "images.unsplash.com",
    async page(query, page, perPage, ctx) {
      const { body } = await ctx.api("/search/illustrations", { query, page, per_page: perPage, orientation: "portrait" }, ctx.key);
      const entries = (body.results ?? []).filter((p) => p.height > p.width * 1.2).map((p) => this.entry(p, ctx));
      return { entries, more: page < (body.total_pages ?? 1) };
    },
    async browse(perPage, ctx) {
      // No random endpoint for illustrations: a random broad word, then a
      // random page of it.
      const query = pick(["illustration", "abstract", "flowers", "pattern", "landscape", "animal", "night", "city", "portrait", "plants"]);
      const first = await ctx.api("/search/illustrations", { query, page: 1, per_page: perPage, orientation: "portrait" }, ctx.key);
      const pages = Math.min(first.body.total_pages ?? 1, 40);
      const page = 1 + rand(pages);
      const body = page === 1 ? first.body : (await ctx.api("/search/illustrations", { query, page, per_page: perPage, orientation: "portrait" }, ctx.key)).body;
      const entries = (body.results ?? []).filter((p) => p.height > p.width * 1.2).map((p) => this.entry(p, ctx));
      return { entries, more: true };
    },
    entry(p, ctx) {
      const e = ctx.entry(p);
      return { ...e, id: `ill-${p.id}`, credit: { ...e.credit, sourceName: "Unsplash" } };
    },
  },

  // Library of Congress — the WPA poster collection (public domain, no
  // key). Largest image the search JSON offers is ~1024px wide.
  loc: {
    label: "Library of Congress posters",
    idPrefix: "loc-",
    imageHost: "tile.loc.gov",
    _url(query, page, perPage) {
      const u = new URL("https://www.loc.gov/collections/works-progress-administration-posters/");
      if (query) u.searchParams.set("q", query);
      u.searchParams.set("fo", "json"); u.searchParams.set("c", String(perPage)); u.searchParams.set("sp", String(page));
      return u;
    },
    _entries(results) {
      const out = [];
      for (const r of results) {
        if (r.access_restricted) continue;
        const best = (r.image_url ?? []).map((u) => ({ u, w: Number(u.match(/w=(\d+)/)?.[1] ?? 0), h: Number(u.match(/h=(\d+)/)?.[1] ?? 0) }))
          .filter((x) => x.w && x.h).sort((a, b) => b.w - a.w)[0];
        if (!best || best.h < best.w) continue;
        const who = (r.contributor ?? []).find((c) => !/federal|works progress|administration|\(u\.s\.\)/i.test(c));
        out.push({
          id: `loc-${String(r.id).replace(/\W+/g, "-").replace(/^-|-$/g, "").slice(-40)}`,
          url: best.u.split("#")[0],
          title: r.title, detail: [r.date?.slice(0, 4), "WPA poster"].filter(Boolean).join(" · "),
          credit: { source: "loc", sourceName: "Library of Congress", name: who ? personName(who) : "WPA Federal Art Project",
                    link: r.id?.startsWith("http") ? r.id : r.url, sourceLink: "https://www.loc.gov/collections/works-progress-administration-posters/" },
        });
      }
      return out;
    },
    async page(query, page, perPage) {
      const res = await fetch(this._url(query, page, perPage), { headers: { "user-agent": "memodaddy-curation" } });
      if (!res.ok) throw new Error(`LoC HTTP ${res.status}`);
      const d = await res.json();
      return { entries: this._entries(d.results ?? []), more: page < (d.pagination?.total ?? 1) };
    },
    async browse(perPage) {
      const first = await fetch(this._url("", 1, perPage), { headers: { "user-agent": "memodaddy-curation" } });
      if (!first.ok) throw new Error(`LoC HTTP ${first.status}`);
      const d1 = await first.json();
      const page = 1 + rand(d1.pagination?.total ?? 1);
      const d = page === 1 ? d1 : await (await fetch(this._url("", page, perPage), { headers: { "user-agent": "memodaddy-curation" } })).json();
      return { entries: this._entries(d.results ?? []), more: true };
    },
  },

  // Wellcome Collection — free, no key, IIIF (crops server-side), only
  // CC BY and public-domain images asked for. Artist is often missing, so
  // the work's title stands in on the credit line.
  wellcome: {
    label: "Wellcome Collection",
    idPrefix: "wellcome-",
    imageHost: "iiif.wellcomecollection.org",
    _url(query, page, perPage) {
      const u = new URL("https://api.wellcomecollection.org/catalogue/v2/images");
      u.searchParams.set("query", query); u.searchParams.set("locations.license", "cc-by,pdm");
      u.searchParams.set("pageSize", String(perPage)); u.searchParams.set("page", String(page));
      u.searchParams.set("include", "source.contributors");
      return u;
    },
    _entries(results) {
      const out = [];
      for (const r of results) {
        const imageId = r.thumbnail?.url?.match(/\/image\/([^/]+)\//)?.[1];
        if (!imageId) continue;
        const aspect = r.aspectRatio ?? 1; // width / height
        if (aspect > 1) continue;
        const region = phoneRegion(aspect * 1000, 1000);
        const who = r.source?.contributors?.[0]?.agent?.label;
        out.push({
          id: `wellcome-${imageId}`,
          url: `https://iiif.wellcomecollection.org/image/${imageId}/${region}/!1290,2796/0/default.jpg`,
          title: r.source?.title, detail: r.locations?.[0]?.license?.id === "pdm" ? "public domain" : "CC BY",
          credit: { source: "wellcome", sourceName: "Wellcome Collection", name: who || (r.source?.title || "Wellcome Collection").slice(0, 60),
                    link: `https://wellcomecollection.org/works/${r.source?.id}`, sourceLink: "https://wellcomecollection.org" },
        });
      }
      return out;
    },
    async page(query, page, perPage) {
      const res = await fetch(this._url(query, page, perPage));
      if (!res.ok) throw new Error(`Wellcome HTTP ${res.status}`);
      const d = await res.json();
      return { entries: this._entries(d.results ?? []), more: page < (d.totalPages ?? 1) };
    },
    async browse(perPage) {
      const query = pick(["poster", "print", "drawing", "painting", "illustration", "engraving", "watercolour", "advertisement"]);
      const first = await fetch(this._url(query, 1, perPage));
      if (!first.ok) throw new Error(`Wellcome HTTP ${first.status}`);
      const d1 = await first.json();
      const page = 1 + rand(Math.min(d1.totalPages ?? 1, 200));
      const d = page === 1 ? d1 : await (await fetch(this._url(query, page, perPage))).json();
      return { entries: this._entries(d.results ?? []), more: true };
    },
  },

  // Art Institute of Chicago — free, no key, CC0 images, IIIF (crops server-side).
  aic: {
    label: "Art Institute of Chicago",
    idPrefix: "aic-",
    imageHost: "www.artic.edu",
    async page(query, page, perPage) {
      // The plain `q` search is fuzzy ("koson" → a self-portrait); this
      // asks for every word to match across artist/title/subject fields.
      const body = {
        query: { bool: {
          must: [{ multi_match: { query, operator: "and", type: "cross_fields",
            fields: ["artist_title^3", "title^2", "term_titles^2", "subject_titles", "style_title", "classification_title", "medium_display", "description"] } }],
          filter: [{ term: { is_public_domain: true } }],
        } },
        fields: ["id", "title", "artist_title", "date_display", "image_id", "thumbnail", "classification_title"],
        limit: perPage, page,
      };
      const res = await fetch("https://api.artic.edu/api/v1/artworks/search", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`AIC HTTP ${res.status}`);
      const d = await res.json();
      const iiif = d.config?.iiif_url ?? "https://www.artic.edu/iiif/2";
      const entries = [];
      for (const a of d.data) {
        const w = a.thumbnail?.width, h = a.thumbnail?.height;
        if (!a.image_id) continue;
        if (w && h && h < w) continue; // portrait or square only; unknown dims pass (the app fills the screen anyway)
        entries.push({
          id: `aic-${a.id}`,
          url: `${iiif}/${a.image_id}/${phoneRegion(w, h)}/!1290,2796/0/default.jpg`,
          title: a.title,
          detail: [a.date_display, a.classification_title].filter(Boolean).join(" · "),
          credit: {
            source: "aic",
            sourceName: "Art Institute of Chicago",
            name: a.artist_title || "Unknown artist",
            link: `https://www.artic.edu/artworks/${a.id}`,
            sourceLink: "https://www.artic.edu",
          },
        });
      }
      return { entries, more: page < (d.pagination?.total_pages ?? 1) };
    },
    /// Keyword-less browsing: public-domain works in the "made picture"
    /// classes (prints, paintings, drawings, posters, textiles,
    /// watercolours). The API ignores random_score and caps any search
    /// at 1,000 results, so randomness comes from a random window of
    /// artwork ids (they run to ~300k) plus a random page inside it.
    async browse(perPage) {
      const lo = rand(280_000);
      const query = { bool: { filter: [
        { term: { is_public_domain: true } }, { exists: { field: "image_id" } },
        { terms: { classification_title: ["print", "woodblock print", "painting", "drawing", "poster", "textile", "watercolor", "screenprint", "lithograph", "etching"] } },
        { range: { id: { gte: lo, lt: lo + 40_000 } } },
      ] } };
      const fields = ["id", "title", "artist_title", "date_display", "image_id", "thumbnail", "classification_title"];
      const post = async (page) => {
        const res = await fetch("https://api.artic.edu/api/v1/artworks/search", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, fields, limit: perPage * 2, page }),
        });
        if (!res.ok) throw new Error(`AIC HTTP ${res.status}`);
        return res.json();
      };
      const first = await post(1);
      const pages = Math.max(1, Math.min(first.pagination?.total_pages ?? 1, Math.floor(1000 / (perPage * 2))));
      const page = 1 + rand(pages);
      const d = page === 1 ? first : await post(page);
      const iiif = d.config?.iiif_url ?? "https://www.artic.edu/iiif/2";
      const entries = d.data.filter((a) => a.image_id && !(a.thumbnail?.width && a.thumbnail?.height && a.thumbnail.height < a.thumbnail.width))
        .slice(0, perPage).map((a) => ({
          id: `aic-${a.id}`,
          url: `${iiif}/${a.image_id}/${phoneRegion(a.thumbnail?.width, a.thumbnail?.height)}/!1290,2796/0/default.jpg`,
          title: a.title,
          detail: [a.date_display, a.classification_title].filter(Boolean).join(" · "),
          credit: { source: "aic", sourceName: "Art Institute of Chicago", name: a.artist_title || "Unknown artist",
                    link: `https://www.artic.edu/artworks/${a.id}`, sourceLink: "https://www.artic.edu" },
        }));
      return { entries, more: true };
    },
  },

  // The Met — free, no key, open-access originals (big files; the app
  // caches one a day). Search is loose; `department` narrows it.
  met: {
    label: "The Met",
    idPrefix: "met-",
    imageHost: "images.metmuseum.org",
    async page(rawQuery, page, perPage) {
      // "carp dept:6" narrows to a department (6 = Asian Art, 9 = Drawings
      // and Prints, 19 = Photographs); the Met's search is loose otherwise.
      const dept = rawQuery.match(/\bdept:(\d+)/)?.[1];
      const query = rawQuery.replace(/\bdept:\d+/, "").trim();
      const url = new URL("https://collectionapi.metmuseum.org/public/collection/v1/search");
      url.searchParams.set("q", query);
      if (dept) url.searchParams.set("departmentId", dept);
      url.searchParams.set("hasImages", "true");
      url.searchParams.set("isPublicDomain", "true");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Met HTTP ${res.status}`);
      const ids = (await res.json()).objectIDs ?? [];
      const slice = ids.slice((page - 1) * perPage, page * perPage);
      const entries = [];
      for (const id of slice) {
        const o = await (await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`)).json();
        if (!o.primaryImage || !o.isPublicDomain) continue;
        const m = (o.measurements ?? [])[0]?.elementMeasurements;
        if (m && m.Width && m.Height && m.Height < m.Width) continue; // portrait or square
        entries.push({
          id: `met-${o.objectID}`,
          url: o.primaryImage,
          title: o.title,
          detail: [o.objectDate, o.classification].filter(Boolean).join(" · "),
          credit: {
            source: "met",
            sourceName: "The Met",
            name: o.artistDisplayName || "Unknown artist",
            link: o.objectURL,
            sourceLink: "https://www.metmuseum.org",
          },
        });
      }
      return { entries, more: page * perPage < ids.length };
    },
    /// Keyword-less browsing: the Met's search can't list, so sample
    /// random object ids from Asian Art (6) and Drawings and Prints (9)
    /// and keep the public-domain, portrait ones with an image. Slow-ish
    /// (one request per object) and the hit rate is maybe a third.
    async browse(perPage) {
      if (!this._ids) {
        const r = await fetch("https://collectionapi.metmuseum.org/public/collection/v1/objects?departmentIds=6|9");
        if (!r.ok) throw new Error(`Met HTTP ${r.status}`);
        this._ids = (await r.json()).objectIDs ?? [];
      }
      const entries = [];
      let tries = 0;
      while (entries.length < perPage && tries < perPage * 3 && this._ids.length) {
        tries++;
        const id = this._ids[Math.floor(Math.random() * this._ids.length)];
        let o;
        try { o = await (await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`)).json(); } catch { continue; }
        if (!o?.primaryImage || !o.isPublicDomain) continue;
        const m = (o.measurements ?? [])[0]?.elementMeasurements;
        if (m && m.Width && m.Height && m.Height < m.Width) continue;
        entries.push({
          id: `met-${o.objectID}`, url: o.primaryImage, title: o.title,
          detail: [o.objectDate, o.classification].filter(Boolean).join(" · "),
          credit: { source: "met", sourceName: "The Met", name: o.artistDisplayName || "Unknown artist",
                    link: o.objectURL, sourceLink: "https://www.metmuseum.org" },
        });
      }
      return { entries, more: true };
    },
  },
};

export const CURATED_PREFIXES = ["unsplash-", ...Object.values(SOURCES).map((s) => s.idPrefix)];
export const isCurated = (e) => CURATED_PREFIXES.some((p) => String(e.id).startsWith(p));

/// "aic: koson fish" → { source: "aic", query: "koson fish" }; "collection:123"
/// → { source: "unsplash", collection: "123" }; plain → unsplash query.
export function parseTerm(term) {
  const t = term.trim();
  const m = t.match(/^([a-z]+):\s*(.+)$/i);
  if (m) {
    const key = m[1].toLowerCase();
    if (key === "collection") return { source: "unsplash", collection: m[2].trim() };
    if (SOURCES[key]) return { source: key, query: m[2].trim() };
  }
  return { source: "unsplash", query: t };
}
