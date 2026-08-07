import { Hono } from "hono";
import {
  getEntry,
  getManifest,
  listEntriesForSitemap,
  resolveCanonicalId,
  searchEntries,
} from "./db/repository";
import { buildSitemapXml, STATIC_SITEMAP_PATHS } from "./sitemap";
import {
  DisclaimerPage,
  EntryPage,
  ErrorPage,
  HomePage,
  NotFoundPage,
  SearchPage,
  StandardPage,
} from "./views/pages";

export type AppBindings = {
  DB: D1Database;
  ASSETS?: Fetcher;
  ABSTRACT_SEARCH_ENABLED?: string;
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
    "default-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'",
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
  const manifest = await getManifest(c.env.DB);
  return c.html(<HomePage manifest={manifest} />);
});

app.get("/standard", async (c) => {
  const manifest = await getManifest(c.env.DB);
  return c.html(<StandardPage manifest={manifest} />);
});

app.get("/disclaimer", (c) => c.html(<DisclaimerPage />));

// Browsers request this path unconditionally regardless of <link rel="icon">;
// redirect to the real static asset instead of serving 404 noise.
app.get("/favicon.ico", (c) => c.redirect("/favicon.svg", 301));

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
  return c.html(<EntryPage entry={entry} />);
});

app.get("/psychotherapy/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const pageRaw = Number(c.req.query("page") ?? "1");
  const forceLike = c.req.query("fallback") === "1";
  const result = await searchEntries(c.env.DB, q, pageRaw, { forceLike });
  return c.html(
    <SearchPage
      query={result.query}
      hits={result.hits}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      mode={result.mode}
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
