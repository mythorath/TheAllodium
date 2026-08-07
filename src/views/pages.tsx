import type { FC, Child } from "hono/jsx";
import type { PublicEntry, SearchHit, SnapshotManifest } from "../contract";
import { SITE_URL } from "../site-config";
import type { AccessValue, FacetCounts, FacetFilters, StorageValue } from "../db/facets";

export const Layout: FC<{
  title: string;
  /** Path (no origin, e.g. "/standard") this page is canonically reachable
   * at. Omit for pages with no single canonical URL (404, error). */
  canonicalPath?: string;
  /** Extra <head> content (e.g. a JSON-LD <script>) beyond the shared
   * boilerplate every page already gets. */
  headExtra?: Child;
  children?: Child;
}> = (props) => {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} · The Allodium</title>
        {props.canonicalPath ? (
          <link rel="canonical" href={`${SITE_URL}${props.canonicalPath}`} />
        ) : null}
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="stylesheet" href="/styles.css" />
        {props.headExtra ?? null}
      </head>
      <body>
        <a class="skip-link" href="#main">
          Skip to content
        </a>
        <header>
          <nav class="site-nav" aria-label="Primary">
            <a class="site-brand" href="/">
              The Allodium
            </a>
            <a href="/psychotherapy/search">Search</a>
            <a href="/standard">The Standard</a>
          </nav>
        </header>
        <main id="main">{props.children}</main>
        <footer class="site-footer">
          <p class="meta">
            <a href="/standard">The Standard</a>
            {" · "}
            <a href="/disclaimer">Disclaimer &amp; crisis resources</a>
          </p>
          <p class="meta">
            Automated checks only, not clinical endorsement or advice. If you
            are in crisis, help is available now — see{" "}
            <a href="/disclaimer">the disclaimer page</a>.
          </p>
        </footer>
      </body>
    </html>
  );
};

export const HomePage: FC<{ manifest: SnapshotManifest | null }> = ({
  manifest,
}) => {
  const modalityCount = manifest
    ? Object.keys(manifest.coverage_json.modalities ?? {}).length
    : 0;
  return (
    <Layout title="Home" canonicalPath="/">
      <h1>The Allodium</h1>
      <p>
        A free, ad-free index of published psychotherapy research and client
        resources — every entry carries published verification provenance:
        DOI identity checks, legitimacy triage, and live link-health status,
        so you can judge a source before you follow it.
      </p>
      {manifest ? (
        <p class="meta">
          {manifest.entry_count.toLocaleString()} entries across{" "}
          {modalityCount} modalities · no accounts, no cookies, no tracking.
        </p>
      ) : null}
      <p>
        <a href="/psychotherapy/search">Open keyword search</a>
        {" · "}
        <a href="/standard">Read how entries are verified</a>
      </p>
    </Layout>
  );
};

function CountList(props: { counts: Record<string, number>; label: string }) {
  const entries = Object.entries(props.counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return <p class="meta">No {props.label} data in this snapshot.</p>;
  }
  return (
    <ul class="stat-list">
      {entries.map(([key, count]) => (
        <li key={key}>
          <span>{key}</span>
          <span class="stat-count">{count.toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

const EXCLUSION_LABELS: Record<string, string> = {
  gated_excluded: "Access-gated (member-only) entries",
  retracted_excluded: "Retracted publications",
  junk_titles_rejected: "Junk or placeholder titles",
  dead_links_excluded: "Dead outbound links",
  already_aliased_excluded: "Superseded by a canonical alias",
  duplicate_rows_merged: "Duplicate rows merged",
};

export const StandardPage: FC<{ manifest: SnapshotManifest | null }> = ({
  manifest,
}) => {
  const exclusions: Record<string, number> = manifest
    ? JSON.parse(manifest.exclusion_counts_json)
    : {};
  return (
    <Layout title="The Standard" canonicalPath="/standard">
      <h1>The Standard</h1>
      <p>
        No competitor in this space publishes its link-integrity and
        identity-verification provenance. The Allodium does, for every entry,
        because a resource list is only as trustworthy as the checks behind
        it.
      </p>

      <h2>How an entry is verified</h2>
      <dl>
        <dt>Identity check</dt>
        <dd>
          For entries carrying a DOI, the stored title is compared against
          publisher metadata from Crossref and OpenAlex. A confirmed match is
          recorded as <code>identity: ok</code>; a strong mismatch is
          demoted for review rather than published as-is.
        </dd>
        <dt>Legitimacy triage</dt>
        <dd>
          Entries are screened for topical relevance, source legitimacy, and
          identity agreement. Screens that don't clear a confidence
          threshold are marked <code>needs_review</code> rather than kept —
          the default when a check is uncertain is exclusion, not inclusion.
        </dd>
        <dt>Link health</dt>
        <dd>
          Outbound links are checked and labeled <code>ok</code>,{" "}
          <code>blocked</code>, or <code>unchecked</code>. A dead link is
          removed from the public set entirely; a <code>blocked</code> link
          (for example, one behind a bot check) stays listed but is clearly
          marked inconclusive rather than presented as broken or as working.
        </dd>
      </dl>
      <p class="meta">
        Every check above is a normalized, timestamped record — see the
        "Verification" section on any entry page. Automated checks are not
        clinical endorsement or advice.
      </p>

      <h2>Coverage</h2>
      {manifest ? (
        <>
          <p class="meta">
            {manifest.entry_count.toLocaleString()} entries · snapshot
            generated {manifest.source_generated_at} · contract v
            {manifest.contract_version} / schema v{manifest.schema_version}
          </p>
          <h3>Identity checks</h3>
          <CountList
            counts={manifest.coverage_json.verifications?.identity ?? {}}
            label="identity check"
          />
          <h3>Legitimacy triage</h3>
          <CountList
            counts={manifest.coverage_json.verifications?.legitimacy ?? {}}
            label="legitimacy triage"
          />
          <h3>Link health</h3>
          <CountList
            counts={manifest.coverage_json.link_status ?? {}}
            label="link status"
          />
          <h3>Identifiers present</h3>
          <CountList
            counts={manifest.coverage_json.identifiers ?? {}}
            label="identifier"
          />
          <h3>Modalities covered</h3>
          <CountList
            counts={manifest.coverage_json.modalities ?? {}}
            label="modality"
          />
        </>
      ) : (
        <p class="meta">Coverage data is not available right now.</p>
      )}

      <h2>What's excluded, and why</h2>
      <p class="meta">
        Publishing the index, never the contents — and never a row that
        failed a check.
      </p>
      <CountList
        counts={Object.fromEntries(
          Object.entries(exclusions).map(([key, count]) => [
            EXCLUSION_LABELS[key] ?? key,
            count,
          ]),
        )}
        label="exclusion"
      />

      <h2>Limitations</h2>
      <ul>
        <li>
          Checks are automated and deterministic where possible; they are
          not a substitute for reading the source or for professional
          clinical judgment.
        </li>
        <li>
          A <code>blocked</code> link means the automated check was
          inconclusive (for example, a bot wall) — not that the resource is
          gone. Verify manually if it matters for your use case.
        </li>
        <li>
          No full text, abstracts, or stored files are published here — only
          index metadata and an outbound link to the original source.
        </li>
      </ul>

      <h2>Update cadence</h2>
      <p>
        The public snapshot is regenerated from the source catalog and
        redeployed as a whole — coverage numbers on this page always
        describe exactly the entries currently live, not a newer or older
        dataset.
      </p>
    </Layout>
  );
};

export const DisclaimerPage: FC = () => (
  <Layout title="Disclaimer" canonicalPath="/disclaimer">
    <h1>Disclaimer</h1>
    <div class="prose">
      <p>
        The Allodium is a published index of psychotherapy research and
        client resources, verified by the automated checks described on{" "}
        <a href="/standard">The Standard</a>. It is not therapy, not a
        clinical service, and not a substitute for professional care.
      </p>
      <p>
        Listing a resource here means it passed our identity, legitimacy,
        and link-health checks — it is not a clinical endorsement of any
        specific treatment, provider, or organization.
      </p>
      <p>
        Referenced third-party materials belong to their original authors.
        This site links out to sources and does not host or republish
        copyrighted files.
      </p>
      <h2>If you need help now</h2>
      <p>
        In the US, call or text <strong>988</strong> (Suicide &amp; Crisis
        Lifeline), or text <strong>HOME to 741741</strong> (Crisis Text
        Line). Outside the US,{" "}
        <a href="https://findahelpline.com" target="_blank" rel="noopener noreferrer">
          findahelpline.com
        </a>{" "}
        lists local lines.
      </p>
    </div>
  </Layout>
);

export const NotFoundPage: FC<{ id?: string }> = (props) => (
  <Layout title="Not found">
    <h1>Not found</h1>
    <p class="meta">
      {props.id
        ? `No public entry for id ${props.id}.`
        : "That page does not exist."}
    </p>
    <p>
      <a href="/psychotherapy/search">Back to search</a>
    </p>
  </Layout>
);

export const ErrorPage: FC = () => (
  <Layout title="Something went wrong">
    <h1>Something went wrong</h1>
    <p class="meta">
      An unexpected error occurred while handling that request. Nothing was
      lost — please try again.
    </p>
    <p>
      <a href="/">Back to home</a>
    </p>
  </Layout>
);

/**
 * Phase 1F: structured data for search engines. Describes the page itself
 * (`WebPage`) rather than claiming to host the resource — the `mainEntity`
 * points back at `canonical_url`, the actual source. Built only from
 * `PublicEntry` fields already on the publication contract; never touches
 * abstract/notes/rationale.
 */
function buildEntryJsonLd(entry: PublicEntry): Record<string, unknown> {
  const mainEntity: Record<string, unknown> = {
    "@type": entry.resource_type === "paper" ? "ScholarlyArticle" : "CreativeWork",
    name: entry.title,
    url: entry.canonical_url,
    keywords: entry.tags.map((t) => t.name).join(", ") || undefined,
  };
  if (entry.author) mainEntity.author = { "@type": "Person", name: entry.author };
  if (entry.published_date) mainEntity.datePublished = entry.published_date;
  if (entry.source_org) mainEntity.publisher = { "@type": "Organization", name: entry.source_org };
  if (entry.doi) mainEntity.identifier = `https://doi.org/${entry.doi}`;
  if (entry.oa_status && entry.oa_status !== "closed") mainEntity.isAccessibleForFree = true;

  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: `${SITE_URL}/psychotherapy/entries/${entry.id}`,
    name: entry.title,
    mainEntity,
  };
}

function EntryJsonLd(props: { entry: PublicEntry }) {
  const json = JSON.stringify(buildEntryJsonLd(props.entry)).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}

function LinkBadge(props: { status: PublicEntry["link_status"] }) {
  if (props.status === "blocked") {
    return <span class="badge badge-blocked">link inconclusive</span>;
  }
  if (props.status === "unchecked") {
    return <span class="badge">link unchecked</span>;
  }
  return <span class="badge">link ok</span>;
}

export const EntryPage: FC<{ entry: PublicEntry }> = ({ entry }) => (
  <Layout
    title={entry.title}
    canonicalPath={`/psychotherapy/entries/${entry.id}`}
    headExtra={<EntryJsonLd entry={entry} />}
  >
    <h1>{entry.title}</h1>
    <p class="meta">
      <span class="badge">{entry.therapy_modality}</span>
      <span class="badge">{entry.resource_type}</span>
      <span class="badge">tier {entry.credibility_tier}</span>
      <LinkBadge status={entry.link_status} />
      {entry.is_link_only ? <span class="badge">link-only</span> : null}
    </p>
    <p>
      <a href={entry.canonical_url} rel="noopener noreferrer" target="_blank">
        Open source
      </a>
    </p>
    <dl>
      <dt>ID</dt>
      <dd>
        <code>{entry.id}</code>
      </dd>
      <dt>Source org</dt>
      <dd>{entry.source_org ?? "—"}</dd>
      <dt>Author</dt>
      <dd>{entry.author ?? "—"}</dd>
      <dt>Published</dt>
      <dd>{entry.published_date ?? "—"}</dd>
      <dt>OA status</dt>
      <dd>{entry.oa_status ?? "—"}</dd>
      <dt>DOI</dt>
      <dd>{entry.doi ?? "—"}</dd>
      <dt>PMID</dt>
      <dd>{entry.pmid ?? "—"}</dd>
      <dt>PMCID</dt>
      <dd>{entry.pmcid ?? "—"}</dd>
      <dt>Citations</dt>
      <dd>{entry.citation_count ?? "—"}</dd>
    </dl>

    <h2>Tags</h2>
    {entry.tags.length === 0 ? (
      <p class="meta">No tags</p>
    ) : (
      <ul>
        {entry.tags.map((t) => (
          <li key={`${t.category}:${t.name}`}>
            {t.name} <span class="meta">({t.category})</span>
          </li>
        ))}
      </ul>
    )}

    <h2>Verification</h2>
    <p class="meta">
      Automated checks only — not clinical endorsement or advice.
    </p>
    {entry.verifications.length === 0 ? (
      <p class="meta">No verification records</p>
    ) : (
      <ul>
        {entry.verifications.map((v, i) => (
          <li key={`${v.check_kind}-${i}`}>
            <strong>{v.check_kind}</strong>: {v.result} via {v.method}
            {v.method_version ? ` (${v.method_version})` : ""}
            {v.score !== null ? ` · score ${v.score}` : ""}
            {v.checked_at ? ` · ${v.checked_at}` : " · checked_at unknown"}
          </li>
        ))}
      </ul>
    )}
  </Layout>
);

const FACET_PARAM_NAMES = {
  modality: "modality",
  audience: "audience",
  access: "access",
  storage: "storage",
  linkStatus: "link_status",
} as const;

const ACCESS_LABELS: Record<AccessValue, string> = {
  free: "Free to read",
  paywalled: "Paywalled",
};

const STORAGE_LABELS: Record<StorageValue, string> = {
  stored: "Available here",
  link_only: "External link only",
};

/** Every active filter, as `[paramName, value][]` — the single source both
 * the checkbox `checked` state and the URL-building helpers below draw from,
 * so pager/clear-filter links can never drift out of sync with what's
 * actually selected. */
function filterEntries(filters: FacetFilters): Array<[string, string]> {
  return [
    ...filters.modality.map((v): [string, string] => [FACET_PARAM_NAMES.modality, v]),
    ...filters.audience.map((v): [string, string] => [FACET_PARAM_NAMES.audience, v]),
    ...filters.access.map((v): [string, string] => [FACET_PARAM_NAMES.access, v]),
    ...filters.storage.map((v): [string, string] => [FACET_PARAM_NAMES.storage, v]),
    ...filters.linkStatus.map((v): [string, string] => [FACET_PARAM_NAMES.linkStatus, v]),
  ];
}

function buildSearchHref(query: string, filters: FacetFilters, page?: number): string {
  const parts: string[] = [];
  if (query) parts.push(`q=${encodeURIComponent(query)}`);
  for (const [name, value] of filterEntries(filters)) {
    parts.push(`${name}=${encodeURIComponent(value)}`);
  }
  if (page && page > 1) parts.push(`page=${page}`);
  return `/psychotherapy/search${parts.length > 0 ? `?${parts.join("&")}` : ""}`;
}

function FacetGroup(props: {
  legend: string;
  paramName: string;
  options: Array<{ value: string; count: number; selected: boolean }>;
  labelFor?: (value: string) => string;
}) {
  if (props.options.length === 0) return null;
  return (
    <fieldset class="facet-group">
      <legend>{props.legend}</legend>
      {props.options.map((opt) => (
        <label class="facet-option" key={opt.value}>
          <input
            type="checkbox"
            name={props.paramName}
            value={opt.value}
            checked={opt.selected}
          />
          {(props.labelFor ? props.labelFor(opt.value) : opt.value)} (
          {opt.count.toLocaleString()})
        </label>
      ))}
    </fieldset>
  );
}

export const SearchPage: FC<{
  query: string;
  hits: SearchHit[];
  total: number;
  page: number;
  pageSize: number;
  mode: string;
  filters: FacetFilters;
  facets: FacetCounts;
}> = (props) => {
  const totalPages = Math.max(1, Math.ceil(props.total / props.pageSize));
  const hasFilters = filterEntries(props.filters).length > 0;
  const hasFacetOptions =
    props.facets.modality.length > 0 ||
    props.facets.audience.length > 0 ||
    props.facets.access.length > 0 ||
    props.facets.storage.length > 0 ||
    props.facets.linkStatus.length > 0;

  return (
    <Layout title="Search" canonicalPath="/psychotherapy/search">
      <h1>Psychotherapy search</h1>
      <form method="get" action="/psychotherapy/search">
        <div class="search-form">
          <label class="visually-hidden" for="search-query">
            Search query
          </label>
          <input
            id="search-query"
            type="search"
            name="q"
            value={props.query}
            placeholder="Keyword search"
          />
          <button type="submit">Search</button>
        </div>
        {hasFacetOptions ? (
          <div class="facet-groups">
            <FacetGroup
              legend="Modality"
              paramName={FACET_PARAM_NAMES.modality}
              options={props.facets.modality}
            />
            <FacetGroup
              legend="Audience"
              paramName={FACET_PARAM_NAMES.audience}
              options={props.facets.audience}
            />
            <FacetGroup
              legend="Access"
              paramName={FACET_PARAM_NAMES.access}
              options={props.facets.access}
              labelFor={(v) => ACCESS_LABELS[v as AccessValue] ?? v}
            />
            <FacetGroup
              legend="Storage"
              paramName={FACET_PARAM_NAMES.storage}
              options={props.facets.storage}
              labelFor={(v) => STORAGE_LABELS[v as StorageValue] ?? v}
            />
            <FacetGroup
              legend="Link status"
              paramName={FACET_PARAM_NAMES.linkStatus}
              options={props.facets.linkStatus}
            />
            {hasFilters ? (
              <p class="meta">
                <a href={buildSearchHref(props.query, { modality: [], audience: [], access: [], storage: [], linkStatus: [] })}>
                  Clear filters
                </a>
              </p>
            ) : null}
          </div>
        ) : null}
      </form>
      {props.mode === "empty" ? (
        <p class="meta">Enter a keyword to search the public index.</p>
      ) : (
        <p class="meta" aria-live="polite">
          {props.total} result{props.total === 1 ? "" : "s"}
          {props.query ? ` for "${props.query}"` : hasFilters ? " matching your filters" : ""}
          {" · "}page {props.page}/{totalPages}
        </p>
      )}
      {props.mode !== "empty" && props.total === 0 ? (
        <p class="meta" role="status">
          {props.query ? (
            <>No results for "{props.query}". Try a broader or differently spelled term.</>
          ) : (
            <>No entries match the selected filters. Try removing one.</>
          )}
        </p>
      ) : props.mode !== "empty" ? (
        <ul class="result-list">
          {props.hits.map((hit) => (
            <li key={hit.id}>
              <a href={`/psychotherapy/entries/${hit.id}`}>{hit.title}</a>
              <div class="meta">
                {hit.therapy_modality} · {hit.resource_type}
                {hit.source_org ? ` · ${hit.source_org}` : ""}
                {hit.link_status === "blocked" ? " · link inconclusive" : ""}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {props.total > props.pageSize ? (
        <nav class="pager" aria-label="Pagination">
          {props.page > 1 ? (
            <a href={buildSearchHref(props.query, props.filters, props.page - 1)}>
              Previous
            </a>
          ) : null}
          {props.page < totalPages ? (
            <a href={buildSearchHref(props.query, props.filters, props.page + 1)}>Next</a>
          ) : null}
        </nav>
      ) : null}
    </Layout>
  );
};
