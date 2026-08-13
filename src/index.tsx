import { Hono } from "hono";
import {
  getEntriesByIds,
  getEntry,
  getKindCounts,
  getManifest,
  getTagCounts,
  getRelatedEntries,
  listEntriesForSitemap,
  loadNlAllowlists,
  parseShortlistIds,
  parseSortOption,
  resolveCanonicalId,
  searchEntries,
} from "./db/repository";
import { EMPTY_FACET_FILTERS, hasActiveFilters, parseFacetFilters } from "./db/facets";
import { isCrisisIntent } from "./crisis";
import { askGpu } from "./gpu";
import { ASK_MAX_CHARS, normalizeNlFacets } from "./nl-query";
import { buildSearchHref, withSearchFlag } from "./search-url";
import { buildSitemapXml, STATIC_SITEMAP_PATHS } from "./sitemap";
import {
  DisclaimerPage,
  EntryPage,
  ErrorPage,
  HexaflexPage,
  HomePage,
  ListPage,
  NotFoundPage,
  SearchPage,
  StandardPage,
  TopicsPage,
} from "./views/pages";

export type AppBindings = {
  DB: D1Database;
  ASSETS?: Fetcher;
  ABSTRACT_SEARCH_ENABLED?: string;
  OG_CARDS: R2Bucket;
  GPU_ORIGIN?: string;
  GPU_SHARED_SECRET?: string;
};

/**
 * Phase 1F: same header set as `public/_headers` (which only covers literal
 * static-asset responses, per Cloudflare's docs), applied here to every
 * Worker-rendered response — including error responses, set explicitly in
 * `app.onError` below since a thrown error bypasses the rest of this
 * middleware's post-`next()` code.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=(), interest-cohort=()",
  "Content-Security-Policy":
    "default-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'",
};

const app = new Hono<{ Bindings: AppBindings }>();

app.use("*", async (c, next) => {
  await next();
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    c.res.headers.set(key, value);
  }
  const contentType = c.res.headers.get("Content-Type") ?? "";
  if (
    c.req.method === "GET" &&
    c.res.ok &&
    !c.res.headers.has("Cache-Control") &&
    contentType.includes("text/html")
  ) {
    c.res.headers.set("Cache-Control", "public, max-age=300");
  }
});

app.get("/", async (c) => {
  const [manifest, kindCounts] = await Promise.all([
    getManifest(c.env.DB),
    getKindCounts(c.env.DB),
  ]);
  return c.html(<HomePage manifest={manifest} kindCounts={kindCounts} />);
});

app.get("/standard", async (c) => {
  const manifest = await getManifest(c.env.DB);
  return c.html(<StandardPage manifest={manifest} />);
});

app.get("/disclaimer", (c) => c.html(<DisclaimerPage />));

// Browsers request this path unconditionally regardless of <link rel="icon">;
// redirect to the real static asset instead of serving 404 noise.
app.get("/favicon.ico", (c) => c.redirect("/favicon.svg", 301));

// Phase 2E: per-entry OpenGraph card, content-addressed by
// {checksum}/{canonical id}.png in the OG_CARDS R2 bucket (rendered by
// ACT's render_og_cards.py, uploaded by scripts/upload-og-cards.ts). Every
// failure mode here — a malformed filename, an unknown/retired id, no
// current manifest, a missing R2 object, or any thrown error — redirects to
// the static default card rather than ever 500ing on a social-preview
// fetch; a D1 Time-Travel rollback to a checksum whose cards were already
// pruned degrades the same way. `resolveCanonicalId` also means an alias id
// resolves to its canonical entry's card, matching the entry route's own
// redirect behavior.
app.get("/og/:filename", async (c) => {
  try {
    const filename = c.req.param("filename");
    if (!filename.endsWith(".png")) return c.redirect("/og-default.png", 302);
    const id = filename.slice(0, -".png".length);
    if (!id) return c.redirect("/og-default.png", 302);

    const resolved = await resolveCanonicalId(c.env.DB, id);
    if (resolved.kind === "missing" || !resolved.canonicalId) {
      return c.redirect("/og-default.png", 302);
    }

    const manifest = await getManifest(c.env.DB);
    if (!manifest) return c.redirect("/og-default.png", 302);

    const object = await c.env.OG_CARDS.get(`${manifest.checksum}/${resolved.canonicalId}.png`);
    if (!object) return c.redirect("/og-default.png", 302);

    return c.body(object.body, 200, {
      "Content-Type": "image/png",
      // Safe to be immutable: the key already encodes the exact checksum,
      // so a new snapshot always resolves through a different key.
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  } catch (err) {
    console.error(err);
    return c.redirect("/og-default.png", 302);
  }
});

app.get("/psychotherapy/entries/:id", async (c) => {
  const id = c.req.param("id");
  const resolved = await resolveCanonicalId(c.env.DB, id);

  if (resolved.kind === "missing" || !resolved.canonicalId) {
    return c.html(<NotFoundPage id={id} />, 404);
  }

  if (resolved.kind === "alias") {
    return c.redirect(`/psychotherapy/entries/${resolved.canonicalId}`, 301);
  }

  const entry = await getEntry(c.env.DB, resolved.canonicalId);
  if (!entry) {
    return c.html(<NotFoundPage id={id} />, 404);
  }
  const related = await getRelatedEntries(c.env.DB, resolved.canonicalId);
  return c.html(<EntryPage entry={entry} related={related} />);
});

app.get("/psychotherapy/topics", async (c) => {
  const tags = await getTagCounts(c.env.DB, "topic");
  return c.html(<TopicsPage tags={tags} />);
});

app.get("/psychotherapy/hexaflex", async (c) => {
  const tags = await getTagCounts(c.env.DB, "hexaflex");
  return c.html(<HexaflexPage tags={tags} />);
});

app.get("/psychotherapy/search", async (c) => {
  const askRaw = (c.req.query("ask") ?? "").trim().slice(0, ASK_MAX_CHARS);
  if (askRaw) {
    if (isCrisisIntent(askRaw)) {
      return c.redirect(
        withSearchFlag(buildSearchHref(askRaw, EMPTY_FACET_FILTERS), "crisis", "1"),
        302,
      );
    }
    const suggestion = await askGpu(c.env, askRaw);
    const allowlists = suggestion ? await loadNlAllowlists(c.env.DB) : null;
    const normalized =
      suggestion && allowlists ? normalizeNlFacets(suggestion, allowlists) : null;
    if (!normalized || (!normalized.q && !hasActiveFilters(normalized.filters))) {
      return c.redirect(
        withSearchFlag(buildSearchHref(askRaw, EMPTY_FACET_FILTERS), "assist", "offline"),
        302,
      );
    }
    return c.redirect(buildSearchHref(normalized.q, normalized.filters), 302);
  }

  const q = c.req.query("q") ?? "";
  const pageRaw = Number(c.req.query("page") ?? "1");
  const forceLike = c.req.query("fallback") === "1";
  const filters = parseFacetFilters((name) => c.req.queries(name));
  const sort = parseSortOption(c.req.query("sort"));
  const likeRaw = c.req.query("like") ?? "";
  const likeId = likeRaw.trim() ? likeRaw.trim() : null;
  const crisis = c.req.query("crisis") === "1";
  const assistOffline = c.req.query("assist") === "offline";
  const result = await searchEntries(c.env.DB, q, pageRaw, filters, { forceLike, sort, likeId });
  const likeTitle =
    result.mode === "neighbors" && result.likeId
      ? ((await getEntry(c.env.DB, result.likeId))?.title ?? null)
      : null;
  return c.html(
    <SearchPage
      query={result.query}
      hits={result.hits}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      mode={result.mode}
      filters={result.filters}
      facets={result.facets}
      sort={result.sort}
      likeId={result.likeId}
      likeTitle={likeTitle}
      crisis={crisis}
      assistOffline={assistOffline}
    />,
  );
});

// Phase 2D: the entire shortlist lives in this one query param — no
// accounts, no cookies. An empty/absent `ids` renders a "build a list"
// prompt (mirroring search's empty-query prompt), never an error.
app.get("/psychotherapy/list", async (c) => {
  const requestedIds = parseShortlistIds(c.req.query("ids") ?? null);
  const { entries, missingIds } = await getEntriesByIds(c.env.DB, requestedIds);
  return c.html(
    <ListPage
      requestedCount={requestedIds.length}
      entries={entries}
      missingCount={missingIds.length}
    />,
  );
});

app.get("/sitemap.xml", async (c) => {
  const rows = await listEntriesForSitemap(c.env.DB);
  const urls = [
    ...STATIC_SITEMAP_PATHS.map((path) => ({ path })),
    ...rows.map((row) => ({
      path: `/psychotherapy/entries/${row.id}`,
      lastmod: row.updated_at,
    })),
  ];
  return c.text(buildSitemapXml(urls), 200, {
    "Content-Type": "application/xml; charset=UTF-8",
    "Cache-Control": "public, max-age=3600",
  });
});

app.get("/health", async (c) => {
  const manifest = await getManifest(c.env.DB);
  return c.json({
    ok: true,
    contract: manifest?.contract_version ?? null,
    schema: manifest?.schema_version ?? null,
    collection: manifest?.collection ?? null,
    entry_count: manifest?.entry_count ?? null,
    abstract_search_enabled: manifest?.abstract_search_enabled ?? null,
  });
});

app.notFound((c) => c.html(<NotFoundPage />, 404));

app.onError(async (err, c) => {
  console.error(err);
  const res = await c.html(<ErrorPage />, 500);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(key, value);
  }
  return res;
});

export default app;
