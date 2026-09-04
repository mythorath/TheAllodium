import { Hono } from "hono";
import {
  findVenuesByName,
  getDomainWithFields,
  getDomains,
  getFieldWithSubfields,
  getInstitutionByRor,
  getPublisher,
  getRetractionNotice,
  getSubfieldWithTopics,
  getTopic,
  getVenue,
  getVenueByIssn,
  hasDoajSubject,
  listCountryPeers,
  listDoajSubjects,
  listIssnResolutions,
  listKeywords,
  listNoticesByReason,
  listNoticesForJournal,
  listOrganizationCountries,
  listOrganizations,
  listOrganizationsByCountry,
  listPublisherChildren,
  listPublishers,
  listRetractionNotices,
  listRetractionReasons,
  listTopicsForKeyword,
  listVenueSubjects,
  listVenueTypes,
  listVenues,
  listVenuesForPublisher,
  listVenuesForSubject,
} from "./authority/repository";
import {
  getEntriesByIds,
  getEntry,
  getKindCounts,
  getManifest,
  getTagCounts,
  getRelatedEntries,
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
import {
  buildSitemapChild,
  buildSitemapIndexXml,
  buildSitemapXml,
  isSitemapKind,
  listSitemapIndexPaths,
} from "./sitemap";
import {
  resolveFederatedWork,
  searchFederation,
  type FederationBindings,
} from "./federation/service";
import { UpstreamRateLimiter } from "./federation/rate-limiter";
import { handleMcpRequest } from "./mcp";
import {
  AboutPage,
  DisclaimerPage,
  EntryPage,
  ErrorPage,
  HexaflexPage,
  HomePage,
  ListPage,
  NotFoundPage,
  PsychotherapyHomePage,
  SearchPage,
  StandardPage,
  TopicsPage,
} from "./views/pages";
import {
  CoveragePage,
  DomainPage,
  FederatedSearchPage,
  FederatedWorkPage,
  FieldPage,
  FieldsPage,
  KeywordPage,
  KeywordsPage,
  OpenIndexHomePage,
  OrganizationPage,
  OrganizationsPage,
  PublisherPage,
  PublishersPage,
  RetractionNoticePage,
  RetractionReasonPage,
  RetractionReasonsPage,
  RetractionsPage,
  SubjectPage,
  SubjectsPage,
  SubfieldPage,
  TopicPage,
  VenuePage,
  VenuesPage,
  WorksPartial,
} from "./views/open-index-pages";
import { venuePath } from "./open-index/paths";

export type AppBindings = {
  DB: D1Database;
  ASSETS?: Fetcher;
  ABSTRACT_SEARCH_ENABLED?: string;
  OG_CARDS: R2Bucket;
  GPU_ORIGIN?: string;
  GPU_SHARED_SECRET?: string;
  AUTHORITY?: D1Database;
  SEARCH_CACHE?: KVNamespace;
  UPSTREAM_RATE_LIMITER?: DurableObjectNamespace;
  FEDERATION_CONTACT_EMAIL?: string;
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
  const manifest = await getManifest(c.env.DB);
  return c.html(<HomePage entryCount={manifest?.entry_count ?? null} />);
});

app.get("/psychotherapy", async (c) => {
  const [manifest, kindCounts] = await Promise.all([
    getManifest(c.env.DB),
    getKindCounts(c.env.DB),
  ]);
  return c.html(<PsychotherapyHomePage manifest={manifest} kindCounts={kindCounts} />);
});

app.get("/standard", (c) => c.html(<StandardPage />));

app.get("/about", (c) => c.html(<AboutPage />));

app.get("/open-index", (c) => c.html(<OpenIndexHomePage />));

app.get("/search", async (c) => {
  const query = (c.req.query("q") ?? "").trim().slice(0, 500);
  const result =
    query.length >= 2
      ? await searchFederation(c.env satisfies FederationBindings, {
          text: query,
          pageSize: 10,
        }, c.executionCtx)
      : null;
  return c.html(<FederatedSearchPage query={query} result={result} />);
});

app.get("/api/search", async (c) => {
  const query = (c.req.query("q") ?? "").trim().slice(0, 500);
  if (query.length < 2) {
    return c.json({ error: "q must contain at least two characters" }, 400);
  }
  const result = await searchFederation(
    c.env satisfies FederationBindings,
    { text: query, pageSize: 10 },
    c.executionCtx,
  );
  return c.json(result, 200, {
    "Cache-Control": "public, max-age=300",
  });
});

app.all("/mcp", (c) =>
  handleMcpRequest(c.req.raw, (query) =>
    searchFederation(
      c.env satisfies FederationBindings,
      { text: query, pageSize: 10 },
      c.executionCtx,
    ),
  ),
);

app.get("/coverage", (c) => c.html(<CoveragePage />));

const DIRECTORY_CACHE = { "Cache-Control": "public, max-age=3600" };

async function withAuthority<T>(
  db: D1Database | undefined,
  fallback: T,
  read: (authority: D1Database) => Promise<T>,
): Promise<T> {
  if (!db) return fallback;
  try {
    return await read(db);
  } catch {
    return fallback;
  }
}

function afterQuery(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

app.get("/fields", async (c) => {
  const domains = await withAuthority(c.env.AUTHORITY, [], getDomains);
  return c.html(<FieldsPage domains={domains} />, 200, DIRECTORY_CACHE);
});

app.get("/fields/:domain/:field/:subfield/:topic", async (c) => {
  const path = await withAuthority(c.env.AUTHORITY, null, (db) =>
    getTopic(
      db,
      c.req.param("domain"),
      c.req.param("field"),
      c.req.param("subfield"),
      c.req.param("topic"),
    ),
  );
  if (!path) return c.html(<NotFoundPage />, 404);
  return c.html(
    <TopicPage
      domain={path.domain}
      field={path.field}
      subfield={path.subfield}
      topic={path.topic}
      siblings={path.siblings}
    />,
    200,
    DIRECTORY_CACHE,
  );
});

app.get("/fields/:domain/:field/:subfield", async (c) => {
  const path = await withAuthority(c.env.AUTHORITY, null, (db) =>
    getSubfieldWithTopics(db, c.req.param("domain"), c.req.param("field"), c.req.param("subfield")),
  );
  if (!path) return c.html(<NotFoundPage />, 404);
  return c.html(
    <SubfieldPage domain={path.domain} field={path.field} subfield={path.subfield} />,
    200,
    DIRECTORY_CACHE,
  );
});

app.get("/fields/:domain/:field", async (c) => {
  const path = await withAuthority(c.env.AUTHORITY, null, (db) =>
    getFieldWithSubfields(db, c.req.param("domain"), c.req.param("field")),
  );
  if (!path) return c.html(<NotFoundPage />, 404);
  return c.html(<FieldPage domain={path.domain} field={path.field} />, 200, DIRECTORY_CACHE);
});

app.get("/fields/:domain", async (c) => {
  const domain = await withAuthority(c.env.AUTHORITY, null, (db) =>
    getDomainWithFields(db, c.req.param("domain")),
  );
  if (!domain) return c.html(<NotFoundPage />, 404);
  return c.html(<DomainPage domain={domain} />, 200, DIRECTORY_CACHE);
});

app.get("/keywords", async (c) => {
  const after = afterQuery(c.req.query("after"));
  const page = await withAuthority(c.env.AUTHORITY, { items: [], nextAfter: null }, (db) =>
    listKeywords(db, after),
  );
  return c.html(<KeywordsPage page={page} after={after} />, 200, DIRECTORY_CACHE);
});

app.get("/keywords/:keyword", async (c) => {
  const keyword = c.req.param("keyword");
  const topics = await withAuthority(c.env.AUTHORITY, [], (db) => listTopicsForKeyword(db, keyword));
  if (topics.length === 0) return c.html(<NotFoundPage />, 404);
  return c.html(<KeywordPage keyword={keyword} topics={topics} />, 200, DIRECTORY_CACHE);
});

app.get("/venues/type/:type", async (c) => {
  const type = c.req.param("type");
  const after = afterQuery(c.req.query("after"));
  const [page, types] = await withAuthority(
    c.env.AUTHORITY,
    [{ items: [], nextAfter: null }, [] as Awaited<ReturnType<typeof listVenueTypes>>] as const,
    async (db) => [await listVenues(db, { after, type }), await listVenueTypes(db)] as const,
  );
  return c.html(<VenuesPage page={page} types={types} type={type} after={after} />, 200, DIRECTORY_CACHE);
});

app.get("/venues", async (c) => {
  const after = afterQuery(c.req.query("after"));
  const [page, types] = await withAuthority(
    c.env.AUTHORITY,
    [{ items: [], nextAfter: null }, [] as Awaited<ReturnType<typeof listVenueTypes>>] as const,
    async (db) => [await listVenues(db, { after }), await listVenueTypes(db)] as const,
  );
  return c.html(<VenuesPage page={page} types={types} after={after} />, 200, DIRECTORY_CACHE);
});

app.get("/venues/:id", async (c) => {
  const id = c.req.param("id");
  const payload = await withAuthority(c.env.AUTHORITY, null, async (db) => {
    const venue = await getVenue(db, id);
    if (!venue) return null;
    const [publisher, issns, subjects, notices] = await Promise.all([
      venue.publisherId ? getPublisher(db, venue.publisherId) : Promise.resolve(null),
      listIssnResolutions(db, venue.id),
      listVenueSubjects(db, venue.id),
      listNoticesForJournal(db, venue.displayName),
    ]);
    return { venue, publisher, issns, subjects, notices };
  });
  if (!payload) return c.html(<NotFoundPage />, 404);
  return c.html(
    <VenuePage
      venue={payload.venue}
      publisher={payload.publisher}
      issns={payload.issns}
      subjects={payload.subjects}
      notices={payload.notices}
    />,
    200,
    DIRECTORY_CACHE,
  );
});

app.get("/issn/:issn", async (c) => {
  const venue = await withAuthority(c.env.AUTHORITY, null, (db) =>
    getVenueByIssn(db, c.req.param("issn")),
  );
  if (!venue) return c.html(<NotFoundPage />, 404);
  return c.redirect(venuePath(venue.id), 301);
});

app.get("/publishers", async (c) => {
  const after = afterQuery(c.req.query("after"));
  const page = await withAuthority(c.env.AUTHORITY, { items: [], nextAfter: null }, (db) =>
    listPublishers(db, after),
  );
  return c.html(<PublishersPage page={page} after={after} />, 200, DIRECTORY_CACHE);
});

app.get("/publishers/:id", async (c) => {
  const after = afterQuery(c.req.query("after"));
  const payload = await withAuthority(c.env.AUTHORITY, null, async (db) => {
    const publisher = await getPublisher(db, c.req.param("id"));
    if (!publisher) return null;
    const [parent, children, venues] = await Promise.all([
      publisher.parentPublisherId ? getPublisher(db, publisher.parentPublisherId) : Promise.resolve(null),
      listPublisherChildren(db, publisher.id),
      listVenuesForPublisher(db, publisher.id, after),
    ]);
    return { publisher, parent, children, venues };
  });
  if (!payload) return c.html(<NotFoundPage />, 404);
  return c.html(
    <PublisherPage
      publisher={payload.publisher}
      parent={payload.parent}
      childPublishers={payload.children}
      venues={payload.venues}
      after={after}
    />,
    200,
    DIRECTORY_CACHE,
  );
});

app.get("/organizations/country/:code", async (c) => {
  const country = c.req.param("code").toUpperCase();
  const after = afterQuery(c.req.query("after"));
  const [page, countries] = await withAuthority(
    c.env.AUTHORITY,
    [{ items: [], nextAfter: null }, [] as Awaited<ReturnType<typeof listOrganizationCountries>>] as const,
    async (db) =>
      [await listOrganizationsByCountry(db, country, after), await listOrganizationCountries(db)] as const,
  );
  return c.html(
    <OrganizationsPage page={page} countries={countries} country={country} after={after} />,
    200,
    DIRECTORY_CACHE,
  );
});

app.get("/organizations", async (c) => {
  const after = afterQuery(c.req.query("after"));
  const [page, countries] = await withAuthority(
    c.env.AUTHORITY,
    [{ items: [], nextAfter: null }, [] as Awaited<ReturnType<typeof listOrganizationCountries>>] as const,
    async (db) => [await listOrganizations(db, after), await listOrganizationCountries(db)] as const,
  );
  return c.html(<OrganizationsPage page={page} countries={countries} after={after} />, 200, DIRECTORY_CACHE);
});

app.get("/organizations/:ror", async (c) => {
  const payload = await withAuthority(c.env.AUTHORITY, null, async (db) => {
    const organization = await getInstitutionByRor(db, c.req.param("ror"));
    if (!organization) return null;
    const peers = organization.countryCode
      ? await listCountryPeers(db, organization.countryCode, organization.rorId ?? c.req.param("ror"))
      : [];
    return { organization, peers };
  });
  if (!payload) return c.html(<NotFoundPage />, 404);
  return c.html(
    <OrganizationPage organization={payload.organization} peers={payload.peers} />,
    200,
    DIRECTORY_CACHE,
  );
});

app.get("/subjects", async (c) => {
  const after = afterQuery(c.req.query("after"));
  const page = await withAuthority(c.env.AUTHORITY, { items: [], nextAfter: null }, (db) =>
    listDoajSubjects(db, after),
  );
  return c.html(<SubjectsPage page={page} after={after} />, 200, DIRECTORY_CACHE);
});

app.get("/subjects/:subject", async (c) => {
  const subject = c.req.param("subject");
  const after = afterQuery(c.req.query("after"));
  const payload = await withAuthority(c.env.AUTHORITY, null, async (db) => {
    if (!(await hasDoajSubject(db, subject))) return null;
    return listVenuesForSubject(db, subject, after);
  });
  if (!payload) return c.html(<NotFoundPage />, 404);
  return c.html(<SubjectPage subject={subject} venues={payload} after={after} />, 200, DIRECTORY_CACHE);
});

app.get("/retractions/reasons/:reason", async (c) => {
  const reason = c.req.param("reason");
  const after = afterQuery(c.req.query("after"));
  const page = await withAuthority(c.env.AUTHORITY, { items: [], nextAfter: null }, (db) =>
    listNoticesByReason(db, reason, after),
  );
  if (page.items.length === 0 && !after) return c.html(<NotFoundPage />, 404);
  return c.html(<RetractionReasonPage reason={reason} page={page} after={after} />, 200, DIRECTORY_CACHE);
});

app.get("/retractions/reasons", async (c) => {
  const reasons = await withAuthority(c.env.AUTHORITY, [], listRetractionReasons);
  return c.html(<RetractionReasonsPage reasons={reasons} />, 200, DIRECTORY_CACHE);
});

app.get("/retractions", async (c) => {
  const after = afterQuery(c.req.query("after"));
  const page = await withAuthority(c.env.AUTHORITY, { items: [], nextAfter: null }, (db) =>
    listRetractionNotices(db, after),
  );
  return c.html(<RetractionsPage page={page} after={after} />, 200, DIRECTORY_CACHE);
});

app.get("/retractions/:id", async (c) => {
  const payload = await withAuthority(c.env.AUTHORITY, null, async (db) => {
    const notice = await getRetractionNotice(db, c.req.param("id"));
    if (!notice) return null;
    const venues = notice.journal ? await findVenuesByName(db, notice.journal) : [];
    return { notice, venues };
  });
  if (!payload) return c.html(<NotFoundPage />, 404);
  return c.html(
    <RetractionNoticePage notice={payload.notice} venues={payload.venues} />,
    200,
    DIRECTORY_CACHE,
  );
});

app.get("/partials/works", async (c) => {
  const query = (c.req.query("q") ?? "").trim().slice(0, 500);
  if (query.length < 2) {
    return c.text("q must contain at least two characters", 400);
  }
  const result = await searchFederation(
    c.env satisfies FederationBindings,
    { text: query, pageSize: 10 },
    c.executionCtx,
  );
  return c.html(<WorksPartial result={result} />, 200, {
    "Cache-Control": "public, max-age=300",
    "X-Robots-Tag": "noindex",
  });
});

app.get("/works/*", async (c) => {
  const rawDoi = c.req.param("*") ?? "";
  const item = await resolveFederatedWork(
    c.env satisfies FederationBindings,
    rawDoi,
    c.executionCtx,
  );
  if (!item) return c.html(<NotFoundPage id={rawDoi} />, 404);
  return c.html(<FederatedWorkPage item={item} />);
});

app.get("/psychotherapy/disclaimer", (c) => c.html(<DisclaimerPage />));
app.get("/disclaimer", (c) => c.redirect("/psychotherapy/disclaimer", 301));

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
  const paths = await listSitemapIndexPaths(c.env.DB, c.env.AUTHORITY);
  return c.text(buildSitemapIndexXml(paths), 200, {
    "Content-Type": "application/xml; charset=UTF-8",
    "Cache-Control": "public, max-age=3600",
  });
});

app.get("/sitemaps/:kind/:file", async (c) => {
  const kindParam = c.req.param("kind");
  const file = c.req.param("file");
  const pageMatch = /^(\d+)\.xml$/.exec(file);
  if (!isSitemapKind(kindParam) || !pageMatch) {
    return c.text("Not found", 404, { "Content-Type": "text/plain; charset=UTF-8" });
  }
  const page = Number(pageMatch[1]);
  try {
    const urls = await buildSitemapChild(kindParam, page, c.env.DB, c.env.AUTHORITY);
    if (!urls) {
      return c.text("Not found", 404, { "Content-Type": "text/plain; charset=UTF-8" });
    }
    return c.text(buildSitemapXml(urls), 200, {
      "Content-Type": "application/xml; charset=UTF-8",
      "Cache-Control": "public, max-age=3600",
    });
  } catch {
    return c.text("Not found", 404, { "Content-Type": "text/plain; charset=UTF-8" });
  }
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
    open_index: {
      authority_bound: Boolean(c.env.AUTHORITY),
      cache_bound: Boolean(c.env.SEARCH_CACHE),
      rate_limiter_bound: Boolean(c.env.UPSTREAM_RATE_LIMITER),
    },
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
export { UpstreamRateLimiter };
