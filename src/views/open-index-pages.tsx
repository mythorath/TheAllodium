import type { FC, Child } from "hono/jsx";
import type {
  AuthorityInstitution,
  AuthorityPublisher,
  AuthorityVenue,
  BrowsePage,
  DoajSubjectLink,
  IssnResolution,
  HubWork,
  HubWorksByRank,
  KeywordTopic,
  NamedCount,
  OrganizationSummary,
  PublisherSummary,
  RetractionNotice,
  SubjectSummary,
  TaxonomyDomain,
  TaxonomyField,
  TaxonomySubfield,
  TaxonomyTopic,
  VenueSummary,
} from "../authority/types";
import { buildFederatedCitations } from "../citations";
import type { CredibilitySignal, SignalPolarity } from "../credibility/types";
import type {
  FederatedSearchResponse,
  ScoredFederatedWork,
} from "../federation/service";
import type { AdapterStatus, NormalizedWork } from "../federation/types";
import { COVERAGE_SOURCES, coverageByMode, type CoverageMode } from "../open-index/coverage";
import {
  browsePagePath,
  fieldsPath,
  keywordPath,
  organizationCountryPath,
  organizationPath,
  publisherPath,
  retractionPath,
  retractionReasonPath,
  searchPath,
  subjectPath,
  venuePath,
  venueTypePath,
  workPath,
  worksPartialPath,
} from "../open-index/paths";
import { SITE_URL } from "../site-config";
import { Layout, OverviewSection } from "./pages";

function workHref(work: NormalizedWork): string | null {
  return work.doi ? `/works/${encodeURIComponent(work.doi)}` : work.canonicalUrl;
}

function statusLabel(status: AdapterStatus): string {
  switch (status.kind) {
    case "ok":
      return `answered in ${status.elapsedMs} ms`;
    case "timeout":
      return `timed out after ${status.timeoutMs} ms`;
    case "http-error":
      return `returned HTTP ${status.httpStatus}`;
    case "network-error":
      return "could not be reached";
    case "invalid-response":
      return "returned an unreadable response";
    case "invalid-query":
      return "did not receive a valid query";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function polarityLabel(polarity: SignalPolarity): string {
  switch (polarity) {
    case "positive":
      return "supporting";
    case "caution":
      return "caution";
    case "negative":
      return "serious concern";
    case "neutral":
      return "not scored";
    default: {
      const exhaustive: never = polarity;
      return exhaustive;
    }
  }
}

function CredibilitySignals(props: { signals: CredibilitySignal[] }) {
  return (
    <details class="credibility-signals">
      <summary>Show all credibility signals</summary>
      <ul class="verification-list">
        {props.signals.map((signal) => (
          <li key={signal.id}>
            <span class={`badge credibility-${signal.polarity}`}>
              {polarityLabel(signal.polarity)}
            </span>
            <span>
              <strong>{signal.label}</strong>: {signal.evidence}{" "}
              <span class="meta">
                Source: {signal.source}; license: {signal.license}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function FederatedResult(props: { item: ScoredFederatedWork }) {
  const { work, credibility } = props.item;
  const href = workHref(work);
  return (
    <li class="federated-result">
      <h2>{href ? <a href={href}>{work.title}</a> : work.title}</h2>
      <p class="meta">
        {work.authors.slice(0, 4).map((author) => author.name).join(", ") || "Author unknown"}
        {work.publicationYear ? ` · ${work.publicationYear}` : ""}
        {work.containerTitle ? ` · ${work.containerTitle}` : ""}
      </p>
      <p>
        <span class="badge">{credibility.band.replaceAll("-", " ")}</span>{" "}
        <span class="meta">
          Transparent signal score {credibility.score}/100 · policy {credibility.policyVersion}
        </span>
      </p>
      <p class="meta">
        Found in {work.evidence.map((item) => item.source).join(", ")}
        {work.doi ? ` · DOI ${work.doi}` : " · no DOI"}
      </p>
      <CredibilitySignals signals={credibility.signals} />
    </li>
  );
}

export const OpenIndexHomePage: FC = () => (
  <Layout
    title="Open Index"
    canonicalPath="/open-index"
    ogDescription="Search research across every field through a transparent federation of public scholarly indexes."
  >
    <section class="home-hero">
      <h1>Research across every field</h1>
      <p class="home-lede">
        The Open Index searches public scholarly indexes in parallel, merges
        duplicate records, and shows exactly which credibility signals support
        each result. It does not hide uncertain or retracted records.
      </p>
      <form method="get" action="/search">
        <div class="search-form">
          <label class="visually-hidden" for="open-index-query">
            Search all research
          </label>
          <input
            id="open-index-query"
            type="search"
            name="q"
            required
            minlength={2}
            maxlength={500}
            placeholder="Search papers, datasets, software, books, theses…"
          />
          <button type="submit">Search</button>
        </div>
      </form>
    </section>
    <nav class="home-directory" aria-label="Open Index">
      <a href="/fields">Browse the field map</a>
      <a href="/keywords">Keywords</a>
      <a href="/venues">Venues</a>
      <a href="/publishers">Publishers</a>
      <a href="/organizations">Organizations</a>
      <a href="/subjects">DOAJ subjects</a>
      <a href="/retractions">Retraction notices</a>
      <a href="/coverage">Coverage and blind spots</a>
      <a href="/standard">How credibility signals work</a>
    </nav>
  </Layout>
);

export const FederatedSearchPage: FC<{
  query: string;
  result: FederatedSearchResponse | null;
}> = ({ query, result }) => (
  <Layout
    title="Search every field"
    canonicalPath="/search"
    ogDescription="Federated search across public scholarly indexes, with source status and transparent credibility signals."
  >
    <h1>Search every field</h1>
    <form method="get" action="/search">
      <div class="search-form">
        <label class="visually-hidden" for="federated-query">
          Search query
        </label>
        <input
          id="federated-query"
          type="search"
          name="q"
          value={query}
          required
          minlength={2}
          maxlength={500}
          placeholder="Search the open scholarly record"
        />
        <button type="submit">Search</button>
      </div>
    </form>
    {!result ? (
      <p class="status-prompt">
        Enter at least two characters. Searches go to independent upstream
        indexes; no single source defines what counts as scholarship.
      </p>
    ) : (
      <>
        <p class="meta" aria-live="polite">
          {result.works.length} merged result{result.works.length === 1 ? "" : "s"} for
          {" "}"{result.query.text}"{result.cached ? " · cached" : ""}
        </p>
        {result.partial ? (
          <p class="assist-notice" role="status">
            Partial results: at least one source did not answer. Available
            results are shown rather than treating an upstream outage as zero
            matches.
          </p>
        ) : null}
        <details>
          <summary>Source status</summary>
          <ul class="stat-list">
            {result.adapters.map((adapter) => (
              <li key={adapter.source}>
                <span>{adapter.source}</span>
                <span class="meta">{statusLabel(adapter.status)}</span>
              </li>
            ))}
          </ul>
        </details>
        {result.works.length === 0 ? (
          <p class="status-prompt">No responding source returned a match.</p>
        ) : (
          <ol class="result-list federated-results">
            {result.works.map((item) => (
              <FederatedResult
                item={item}
                key={item.work.doi ?? item.work.canonicalUrl ?? item.work.title}
              />
            ))}
          </ol>
        )}
      </>
    )}
  </Layout>
);

function countLabel(count: number | null): string {
  return count === null ? "count unavailable" : `${count.toLocaleString()} works`;
}

const BROWSE_DIRECTORIES = [
  { href: "/fields", label: "Fields" },
  { href: "/keywords", label: "Keywords" },
  { href: "/venues", label: "Venues" },
  { href: "/publishers", label: "Publishers" },
  { href: "/organizations", label: "Organizations" },
  { href: "/subjects", label: "DOAJ subjects" },
  { href: "/retractions", label: "Retraction notices" },
  { href: "/retractions/reasons", label: "Retraction reasons" },
] as const;

function BrowseNav() {
  return (
    <nav class="browse-nav" aria-label="Browse directories">
      {BROWSE_DIRECTORIES.map((item) => (
        <a href={item.href} key={item.href}>
          {item.label}
        </a>
      ))}
    </nav>
  );
}

function HubWorkRow(props: { work: HubWork }) {
  const { work } = props;
  const authors = work.authors.slice(0, 4).map((author) => author.name).join(", ");
  return (
    <li>
      <a href={workPath(work.doi)}>{work.title}</a>
      {work.retracted ? <span class="badge">Retracted</span> : null}
      <p class="meta">
        {authors || "Author unknown"}
        {work.publicationYear ? ` · ${work.publicationYear}` : ""}
        {work.containerTitle ? ` · ${work.containerTitle}` : ""}
        {work.citedByCount !== null ? ` · ${work.citedByCount.toLocaleString()} citations` : ""}
      </p>
    </li>
  );
}

function HubWorkSection(props: { title: string; works: HubWork[] }) {
  if (props.works.length === 0) return null;
  return (
    <>
      <h2>{props.title}</h2>
      <ol class="result-list">
        {props.works.map((work) => (
          <HubWorkRow work={work} key={`${work.rankKind}:${work.rank}:${work.doi}`} />
        ))}
      </ol>
    </>
  );
}

function HubWorkList(props: { works: HubWorksByRank }) {
  if (props.works.cited.length === 0 && props.works.recent.length === 0) {
    return null;
  }
  return (
    <section class="hub-works">
      <HubWorkSection title="Most cited" works={props.works.cited} />
      <HubWorkSection title="Most recent" works={props.works.recent} />
    </section>
  );
}

function SearchHubLink(props: { query: string; label: string }) {
  return (
    <p>
      <a class="button-primary" href={searchPath(props.query)}>
        {props.label}
      </a>
    </p>
  );
}

export const FieldsPage: FC<{ domains: TaxonomyDomain[] }> = ({ domains }) => (
  <Layout
    title="Fields"
    canonicalPath="/fields"
    ogDescription="Browse the OpenAlex four-level research taxonomy used by The Allodium."
  >
    <BrowseNav />
    <h1>Field map</h1>
    <p>
      This map comes from the redistributable OpenAlex taxonomy: four domains,
      26 fields, 252 subfields, and 4,516 topics. Counts describe OpenAlex,
      not records hosted by The Allodium.
    </p>
    {domains.length === 0 ? (
      <p class="status-prompt">
        The authority snapshot is not loaded yet. Cross-field search remains available.
      </p>
    ) : (
      <ul class="directory-list stat-list">
        {domains.map((domain) => (
          <li key={domain.id}>
            <a href={`/fields/${encodeURIComponent(domain.id)}`}>
              <span>{domain.displayName}</span>
              <span class="stat-count">{countLabel(domain.worksCount)}</span>
            </a>
          </li>
        ))}
      </ul>
    )}
  </Layout>
);

export const DomainPage: FC<{
  domain: TaxonomyDomain;
  siblings: TaxonomyDomain[];
  works: HubWorksByRank;
}> = ({ domain, siblings, works }) => (
  <Layout title={domain.displayName} canonicalPath={`/fields/${encodeURIComponent(domain.id)}`}>
    <BrowseNav />
    <p class="meta">
      <a href="/fields">Fields</a>
    </p>
    <h1>{domain.displayName}</h1>
    {domain.description ? <p>{domain.description}</p> : null}
    <p class="meta">{countLabel(domain.worksCount)}</p>
    <GraphHonestyNote />
    <HubWorkList works={works} />
    <SearchHubLink query={domain.displayName} label="Search this domain" />
    <div class="browse-rails">
      <div>
        <h2>Fields</h2>
        <ul class="directory-list stat-list">
          {domain.fields.map((field) => (
            <li key={field.id}>
              <a href={fieldsPath(domain.id, field.id)}>
                <span>{field.displayName}</span>
                <span class="stat-count">{countLabel(field.worksCount)}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
      {siblings.length > 0 ? (
        <RelatedRail title="Other domains">
          <DirectoryList
            items={siblings.map((item) => ({
              key: item.id,
              href: fieldsPath(item.id),
              label: item.displayName,
              count: countLabel(item.worksCount),
            }))}
          />
        </RelatedRail>
      ) : null}
    </div>
  </Layout>
);

export const FieldPage: FC<{
  domain: TaxonomyDomain;
  field: TaxonomyField;
  siblings: TaxonomyField[];
  works: HubWorksByRank;
}> = ({ domain, field, siblings, works }) => (
  <Layout
    title={field.displayName}
    canonicalPath={`/fields/${encodeURIComponent(domain.id)}/${encodeURIComponent(field.id)}`}
  >
    <BrowseNav />
    <p class="meta">
      <a href="/fields">Fields</a>
      {" · "}
      <a href={fieldsPath(domain.id)}>{domain.displayName}</a>
    </p>
    <h1>{field.displayName}</h1>
    {field.description ? <p>{field.description}</p> : null}
    <GraphHonestyNote />
    <HubWorkList works={works} />
    <SearchHubLink query={field.displayName} label="Search this field" />
    <div class="browse-rails">
      <div>
        <h2>Subfields</h2>
        <ul class="directory-list stat-list">
          {field.subfields.map((subfield) => (
            <li key={subfield.id}>
              <a href={fieldsPath(domain.id, field.id, subfield.id)}>
                <span>{subfield.displayName}</span>
                <span class="stat-count">{countLabel(subfield.worksCount)}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
      {siblings.length > 0 ? (
        <RelatedRail title="Other fields in this domain">
          <DirectoryList
            items={siblings.map((item) => ({
              key: item.id,
              href: fieldsPath(domain.id, item.id),
              label: item.displayName,
              count: countLabel(item.worksCount),
            }))}
          />
        </RelatedRail>
      ) : null}
    </div>
  </Layout>
);

export const SubfieldPage: FC<{
  domain: TaxonomyDomain;
  field: TaxonomyField;
  subfield: TaxonomySubfield;
  siblings: TaxonomySubfield[];
  keywords: NamedCount[];
  works: HubWorksByRank;
}> = ({ domain, field, subfield, siblings, keywords, works }) => (
  <Layout
    title={subfield.displayName}
    canonicalPath={`/fields/${encodeURIComponent(domain.id)}/${encodeURIComponent(field.id)}/${encodeURIComponent(subfield.id)}`}
  >
    <BrowseNav />
    <p class="meta">
      <a href="/fields">Fields</a>
      {" · "}
      <a href={fieldsPath(domain.id)}>{domain.displayName}</a>
      {" · "}
      <a href={fieldsPath(domain.id, field.id)}>{field.displayName}</a>
    </p>
    <h1>{subfield.displayName}</h1>
    {subfield.description ? <p>{subfield.description}</p> : null}
    <GraphHonestyNote />
    <HubWorkList works={works} />
    <SearchHubLink query={subfield.displayName} label="Search this subfield" />
    <div class="browse-rails">
      <div>
        <h2>Topics</h2>
        <ul class="directory-list stat-list">
          {subfield.topics.map((topic) => (
            <li key={topic.id}>
              <a href={fieldsPath(domain.id, field.id, subfield.id, topic.id)}>
                <span>{topic.displayName}</span>
                <span class="stat-count">{countLabel(topic.worksCount)}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
      {siblings.length > 0 || keywords.length > 0 ? (
        <div>
          {siblings.length > 0 ? (
            <RelatedRail title="Other subfields in this field">
              <DirectoryList
                items={siblings.map((item) => ({
                  key: item.id,
                  href: fieldsPath(domain.id, field.id, item.id),
                  label: item.displayName,
                  count: countLabel(item.worksCount),
                }))}
              />
            </RelatedRail>
          ) : null}
          {keywords.length > 0 ? (
            <RelatedRail title="Keywords">
              <DirectoryList
                items={keywords.map((item) => ({
                  key: item.name,
                  href: keywordPath(item.name),
                  label: item.name,
                  count: `${item.count.toLocaleString()} topic${item.count === 1 ? "" : "s"}`,
                }))}
              />
            </RelatedRail>
          ) : null}
        </div>
      ) : null}
    </div>
  </Layout>
);

function WorkJsonLd(props: { item: ScoredFederatedWork; overview?: string | null }) {
  const work = props.item.work;
  const json = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: work.doi ? `${SITE_URL}/works/${encodeURIComponent(work.doi)}` : undefined,
    name: work.title,
    description: props.overview ?? undefined,
    mainEntity: {
      "@type": "ScholarlyArticle",
      name: work.title,
      identifier: work.doi ? `https://doi.org/${work.doi}` : undefined,
      url: work.canonicalUrl ?? undefined,
      datePublished: work.publishedDate ?? undefined,
      author: work.authors.map((author) => ({ "@type": "Person", name: author.name })),
      description: props.overview ?? undefined,
    },
  }).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}

export const FederatedWorkPage: FC<{
  item: ScoredFederatedWork;
  overview?: string | null;
}> = ({ item, overview }) => {
  const { work, credibility } = item;
  const citations = buildFederatedCitations(work);
  const trimmedOverview = overview?.trim() || "";
  const ogDescription = trimmedOverview
    ? trimmedOverview.length <= 280
      ? trimmedOverview
      : `${trimmedOverview.slice(0, 279).trimEnd()}…`
    : `${credibility.band.replaceAll("-", " ")} · ${work.containerTitle ?? "scholarly record"}`;
  return (
    <Layout
      title={work.title}
      canonicalPath={work.doi ? `/works/${encodeURIComponent(work.doi)}` : undefined}
      headExtra={<WorkJsonLd item={item} overview={trimmedOverview || null} />}
      ogType="article"
      ogDescription={ogDescription}
    >
      <h1>{work.title}</h1>
      <p class="meta">
        {work.authors.map((author) => author.name).join(", ") || "Author unknown"}
      </p>
      {work.canonicalUrl ? (
        <p>
          <a
            class="button-primary"
            href={work.canonicalUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            Open source
          </a>
        </p>
      ) : null}
      {trimmedOverview ? <OverviewSection overview={trimmedOverview} /> : null}
      <dl class="entry-fields">
        <dt>DOI</dt>
        <dd class="mono">{work.doi ?? "Not recorded"}</dd>
        <dt>Published</dt>
        <dd>{work.publishedDate ?? work.publicationYear ?? "Not recorded"}</dd>
        <dt>Container</dt>
        <dd>{work.containerTitle ?? "Not recorded"}</dd>
        <dt>Publisher</dt>
        <dd>{work.publisher ?? "Not recorded"}</dd>
        <dt>Open access</dt>
        <dd>{work.isOpenAccess === null ? "unknown" : work.isOpenAccess ? "yes" : "no"}</dd>
      </dl>
      <h2>Credibility signals</h2>
      <p>
        <span class="badge">{credibility.band.replaceAll("-", " ")}</span>{" "}
        Score {credibility.score}/100 under policy {credibility.policyVersion}.
        This is a metadata assessment, not a judgment of the paper's conclusions.
      </p>
      <CredibilitySignals signals={credibility.signals} />
      <h2>Cite this work</h2>
      <div class="citation-block">
        <h3>BibTeX</h3>
        <pre>{citations.bibtex}</pre>
      </div>
      <div class="citation-block">
        <h3>RIS</h3>
        <pre>{citations.ris}</pre>
      </div>
      <div class="citation-block">
        <h3>APA</h3>
        <p>{citations.apa}</p>
      </div>
      <h2>Source records</h2>
      <ul>
        {work.evidence.map((source) => (
          <li key={`${source.source}:${source.sourceId}`}>
            {source.recordUrl ? (
              <a href={source.recordUrl} rel="noopener noreferrer" target="_blank">
                {source.source}
              </a>
            ) : (
              source.source
            )}
            {" · retrieved "}
            {source.retrievedAt}
          </li>
        ))}
      </ul>
    </Layout>
  );
};

const COVERAGE_HEADINGS: Record<CoverageMode, string> = {
  live: "Queried live",
  enrichment: "Local authority snapshots",
  harvest: "Scheduled-harvest horizon",
  unavailable: "Named blind spots",
};

export const CoveragePage: FC = () => (
  <Layout
    title="Coverage"
    canonicalPath="/coverage"
    ogDescription="What the Open Index can reach, which sources are queried, and the gaps it cannot honestly fill."
  >
    <h1>Coverage, including the gaps</h1>
    <p>
      There is no complete denominator for global scholarship. The best current
      estimate is that the free, redistributable federation can reach 60–70% of
      worldwide research output. That estimate is not a recall measurement.
    </p>
    {(["live", "enrichment", "harvest", "unavailable"] as const).map((mode) => (
      <section class="standard-section" key={mode}>
        <h2>{COVERAGE_HEADINGS[mode]}</h2>
        <ul class="coverage-list">
          {coverageByMode(mode).map((source) => (
            <li key={source.id}>
              <a href={source.href} rel="noopener noreferrer" target="_blank">
                <strong>{source.label}</strong>
              </a>
              : {source.scope}
              {source.limitation ? <span class="meta">, {source.limitation}</span> : null}
            </li>
          ))}
        </ul>
      </section>
    ))}
    <p class="meta">
      {COVERAGE_SOURCES.length} sources or explicit gaps documented. See{" "}
      <a href="/standard">The Standard</a> for scoring rules.
    </p>
  </Layout>
);

function GraphHonestyNote() {
  return (
    <p class="honesty-note">
      Papers listed on taxonomy pages are the top few works per node from the
      OpenAlex snapshot. That list is not exhaustive and is not an endorsement.
      The topic map and the journal registry remain separate: there is still no
      authoritative topic-to-venue or topic-to-organization edge. Search is a
      lexical lookup, not a claim that a venue publishes a topic.
    </p>
  );
}

function WorksLoader(props: { query: string }) {
  const href = searchPath(props.query);
  return (
    <div class="works-loader">
      <p class="entry-actions">
        <a class="button-primary" href={href}>
          Search papers
        </a>
        <button type="button" hidden data-load-works={worksPartialPath(props.query)}>
          Load papers here
        </button>
      </p>
      <div data-works-target />
    </div>
  );
}

function DirectoryList(props: {
  items: Array<{ href: string; label: string; count?: string; key: string }>;
}) {
  if (props.items.length === 0) {
    return <p class="status-prompt">Nothing to list in this snapshot yet.</p>;
  }
  return (
    <ul class="directory-list stat-list">
      {props.items.map((item) => (
        <li key={item.key}>
          <a href={item.href}>
            <span>{item.label}</span>
            {item.count ? <span class="stat-count">{item.count}</span> : null}
          </a>
        </li>
      ))}
    </ul>
  );
}

function KeysetNav(props: {
  path: string;
  nextAfter: string | null;
  after?: string | null;
  extra?: Record<string, string>;
}) {
  if (!props.nextAfter && !props.after) return null;
  const extra = props.extra ?? {};
  return (
    <p class="meta browse-pagination">
      {props.after ? <a href={browsePagePath(props.path, null, extra)}>First page</a> : null}
      {props.after && props.nextAfter ? " · " : null}
      {props.nextAfter ? (
        <a href={browsePagePath(props.path, props.nextAfter, extra)}>Next</a>
      ) : null}
    </p>
  );
}

function RelatedRail(props: { title: string; children?: Child }) {
  return (
    <aside class="related-rail">
      <h2>{props.title}</h2>
      {props.children}
    </aside>
  );
}

export const TopicPage: FC<{
  domain: TaxonomyDomain;
  field: TaxonomyField;
  subfield: TaxonomySubfield;
  topic: TaxonomyTopic;
  siblings: TaxonomyTopic[];
  works: HubWorksByRank;
}> = ({ domain, field, subfield, topic, siblings, works }) => (
  <Layout
    title={topic.displayName}
    canonicalPath={fieldsPath(domain.id, field.id, subfield.id, topic.id)}
    ogDescription={`OpenAlex topic in ${subfield.displayName}.`}
  >
    <BrowseNav />
    <p class="meta">
      <a href="/fields">Fields</a>
      {" · "}
      <a href={fieldsPath(domain.id)}>{domain.displayName}</a>
      {" · "}
      <a href={fieldsPath(domain.id, field.id)}>{field.displayName}</a>
      {" · "}
      <a href={fieldsPath(domain.id, field.id, subfield.id)}>{subfield.displayName}</a>
    </p>
    <h1>{topic.displayName}</h1>
    {topic.description ? <p>{topic.description}</p> : null}
    <p class="meta">{countLabel(topic.worksCount)}</p>
    <GraphHonestyNote />
    <HubWorkList works={works} />
    <SearchHubLink query={topic.displayName} label="Search papers" />
    <div class="browse-rails">
      <div>
        <h2>Keywords</h2>
        {topic.keywords.length === 0 ? (
          <p class="status-prompt">No keywords recorded for this topic.</p>
        ) : (
          <ul class="directory-list stat-list">
            {topic.keywords.map((keyword) => (
              <li key={keyword}>
                <a href={keywordPath(keyword)}>
                  <span>{keyword}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      {siblings.length > 0 ? (
        <RelatedRail title="Other topics in this subfield">
          <DirectoryList
            items={siblings.map((item) => ({
              key: item.id,
              href: fieldsPath(domain.id, field.id, subfield.id, item.id),
              label: item.displayName,
              count: countLabel(item.worksCount),
            }))}
          />
        </RelatedRail>
      ) : null}
    </div>
  </Layout>
);

export const KeywordsPage: FC<{ page: BrowsePage<NamedCount>; after?: string | null }> = ({
  page,
  after,
}) => (
  <Layout
    title="Keywords"
    canonicalPath="/keywords"
    ogDescription="OpenAlex topic keywords that bridge research areas."
  >
    <BrowseNav />
    <h1>Keywords</h1>
    <p>
      Keywords are the only authoritative cross-domain bridge in this snapshot.
      A keyword page lists every topic that carries that string.
    </p>
    <GraphHonestyNote />
    <DirectoryList
      items={page.items.map((item) => ({
        key: item.name,
        href: keywordPath(item.name),
        label: item.name,
        count: `${item.count.toLocaleString()} topic${item.count === 1 ? "" : "s"}`,
      }))}
    />
    <KeysetNav path="/keywords" nextAfter={page.nextAfter} after={after} />
  </Layout>
);

export const KeywordPage: FC<{
  keyword: string;
  topics: KeywordTopic[];
  relatedKeywords: NamedCount[];
}> = ({ keyword, topics, relatedKeywords }) => (
  <Layout
    title={keyword}
    canonicalPath={keywordPath(keyword)}
    ogDescription={`OpenAlex topics that share the keyword ${keyword}.`}
  >
    <BrowseNav />
    <p class="meta">
      <a href="/keywords">Keywords</a>
    </p>
    <h1>{keyword}</h1>
    <p>
      {topics.length.toLocaleString()} topic{topics.length === 1 ? "" : "s"} carry this
      keyword.
    </p>
    <GraphHonestyNote />
    <WorksLoader query={keyword} />
    <div class="browse-rails">
      <div>
        <h2>Topics</h2>
        <DirectoryList
          items={topics.map((topic) => ({
            key: topic.id,
            href: fieldsPath(topic.domainId, topic.fieldId, topic.subfieldId, topic.id),
            label: `${topic.displayName} · ${topic.domainName}`,
            count: countLabel(topic.worksCount),
          }))}
        />
      </div>
      {relatedKeywords.length > 0 ? (
        <RelatedRail title="Co-occurring keywords">
          <DirectoryList
            items={relatedKeywords.map((item) => ({
              key: item.name,
              href: keywordPath(item.name),
              label: item.name,
              count: `${item.count.toLocaleString()} topic${item.count === 1 ? "" : "s"}`,
            }))}
          />
        </RelatedRail>
      ) : null}
    </div>
  </Layout>
);

export const VenuesPage: FC<{
  page: BrowsePage<VenueSummary>;
  types: NamedCount[];
  type?: string | null;
  after?: string | null;
}> = ({ page, types, type, after }) => (
  <Layout
    title={type ? `Venues · ${type}` : "Venues"}
    canonicalPath={type ? venueTypePath(type) : "/venues"}
    ogDescription="OpenAlex sources: journals, conferences, repositories, and other venues."
  >
    <BrowseNav />
    <h1>{type ? `Venues: ${type}` : "Venues"}</h1>
    <p>
      Venue records come from the OpenAlex sources snapshot. ISSN aliases
      redirect here; DOAJ subjects and retraction notices are linked when the
      names or ISSNs match.
    </p>
    <GraphHonestyNote />
    {types.length > 0 ? (
      <p class="meta">
        {types.map((item, index) => (
          <span key={item.name}>
            {index > 0 ? " · " : null}
            <a href={venueTypePath(item.name)}>
              {item.name} ({item.count.toLocaleString()})
            </a>
          </span>
        ))}
      </p>
    ) : null}
    <DirectoryList
      items={page.items.map((item) => ({
        key: item.id,
        href: venuePath(item.id),
        label: item.displayName,
        count: item.sourceType ?? countLabel(item.worksCount),
      }))}
    />
    <KeysetNav
      path={type ? venueTypePath(type) : "/venues"}
      nextAfter={page.nextAfter}
      after={after}
    />
  </Layout>
);

export const VenuePage: FC<{
  venue: AuthorityVenue;
  publisher: AuthorityPublisher | null;
  issns: IssnResolution[];
  subjects: DoajSubjectLink[];
  notices: RetractionNotice[];
  publisherVenues: VenueSummary[];
}> = ({ venue, publisher, issns, subjects, notices, publisherVenues }) => (
  <Layout
    title={venue.displayName}
    canonicalPath={venuePath(venue.id)}
    ogDescription={venue.sourceType ? `${venue.sourceType} in the OpenAlex source registry.` : "OpenAlex venue."}
  >
    <BrowseNav />
    <p class="meta">
      <a href="/venues">Venues</a>
      {venue.sourceType ? (
        <>
          {" · "}
          <a href={venueTypePath(venue.sourceType)}>{venue.sourceType}</a>
        </>
      ) : null}
    </p>
    <h1>{venue.displayName}</h1>
    <p class="meta">
      {venue.sourceType ?? "type unknown"}
      {venue.isOpenAccess === true ? " · open access" : ""}
      {venue.doajListed ? " · in DOAJ" : ""}
      {venue.nlmId ? ` · NLM ${venue.nlmId}` : ""}
    </p>
    <p class="meta">{countLabel(venue.worksCount)}</p>
    <GraphHonestyNote />
    <WorksLoader query={venue.displayName} />
    <div class="browse-rails">
      <div>
        <h2>ISSNs</h2>
        {issns.length === 0 ? (
          <p class="status-prompt">No ISSN is recorded for this venue.</p>
        ) : (
          <ul class="stat-list">
            {issns.map((item) => (
              <li key={item.issn}>
                <span class="mono">{item.issn}</span>
                <span class="meta">
                  {item.doajTitle ? `DOAJ: ${item.doajTitle}` : "not in DOAJ snapshot"}
                  {item.nlmId ? ` · NLM ${item.nlmId}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        <h2>DOAJ subjects</h2>
        <DirectoryList
          items={subjects.map((item) => ({
            key: item.subject,
            href: subjectPath(item.subject),
            label: item.subject,
          }))}
        />
        {venue.homepageUrl ? (
          <p>
            <a href={venue.homepageUrl} rel="noopener noreferrer" target="_blank">
              Venue homepage
            </a>
          </p>
        ) : null}
      </div>
      <RelatedRail title="Related">
        {publisher ? (
          <p>
            Publisher: <a href={publisherPath(publisher.id)}>{publisher.displayName}</a>
          </p>
        ) : (
          <p class="status-prompt">No publisher link in this snapshot.</p>
        )}
        {publisherVenues.length > 0 ? (
          <>
            <h3>More venues from this publisher</h3>
            <DirectoryList
              items={publisherVenues.map((item) => ({
                key: item.id,
                href: venuePath(item.id),
                label: item.displayName,
                count: item.sourceType ?? countLabel(item.worksCount),
              }))}
            />
          </>
        ) : null}
        <h3>Retraction notices naming this journal</h3>
        <DirectoryList
          items={notices.map((notice) => ({
            key: notice.id,
            href: retractionPath(notice.id),
            label: notice.title,
            count: notice.noticeDate ?? undefined,
          }))}
        />
      </RelatedRail>
    </div>
  </Layout>
);

export const PublishersPage: FC<{
  page: BrowsePage<PublisherSummary>;
  after?: string | null;
}> = ({ page, after }) => (
  <Layout title="Publishers" canonicalPath="/publishers" ogDescription="OpenAlex publishers.">
    <BrowseNav />
    <h1>Publishers</h1>
    <GraphHonestyNote />
    <DirectoryList
      items={page.items.map((item) => ({
        key: item.id,
        href: publisherPath(item.id),
        label: item.displayName,
        count: countLabel(item.worksCount),
      }))}
    />
    <KeysetNav path="/publishers" nextAfter={page.nextAfter} after={after} />
  </Layout>
);

export const PublisherPage: FC<{
  publisher: AuthorityPublisher;
  parent: AuthorityPublisher | null;
  childPublishers: PublisherSummary[];
  venues: BrowsePage<VenueSummary>;
  after?: string | null;
}> = ({ publisher, parent, childPublishers, venues, after }) => (
  <Layout
    title={publisher.displayName}
    canonicalPath={publisherPath(publisher.id)}
    ogDescription="OpenAlex publisher record."
  >
    <BrowseNav />
    <p class="meta">
      <a href="/publishers">Publishers</a>
      {parent ? (
        <>
          {" · "}
          <a href={publisherPath(parent.id)}>{parent.displayName}</a>
        </>
      ) : null}
    </p>
    <h1>{publisher.displayName}</h1>
    {publisher.alternateTitles.length > 0 ? (
      <p class="meta">{publisher.alternateTitles.join(" · ")}</p>
    ) : null}
    <p class="meta">{countLabel(publisher.worksCount)}</p>
    <GraphHonestyNote />
    <WorksLoader query={publisher.displayName} />
    <div class="browse-rails">
      <div>
        <h2>Venues</h2>
        <DirectoryList
          items={venues.items.map((item) => ({
            key: item.id,
            href: venuePath(item.id),
            label: item.displayName,
            count: item.sourceType ?? undefined,
          }))}
        />
        <KeysetNav
          path={publisherPath(publisher.id)}
          nextAfter={venues.nextAfter}
          after={after}
        />
      </div>
      <RelatedRail title="Publisher hierarchy">
        {childPublishers.length === 0 ? (
          <p class="status-prompt">No child publishers.</p>
        ) : (
          <DirectoryList
            items={childPublishers.map((item) => ({
              key: item.id,
              href: publisherPath(item.id),
              label: item.displayName,
            }))}
          />
        )}
      </RelatedRail>
    </div>
  </Layout>
);

export const OrganizationsPage: FC<{
  page: BrowsePage<OrganizationSummary>;
  countries: NamedCount[];
  country?: string | null;
  after?: string | null;
}> = ({ page, countries, country, after }) => (
  <Layout
    title={country ? `Organizations · ${country}` : "Organizations"}
    canonicalPath={country ? organizationCountryPath(country) : "/organizations"}
    ogDescription="Research Organization Registry records joined to OpenAlex institutions."
  >
    <BrowseNav />
    <h1>{country ? `Organizations in ${country}` : "Organizations"}</h1>
    <p>
      These pages start from ROR. An OpenAlex institution record is shown when
      the same ROR id is present in the snapshot.
    </p>
    {!country && countries.length > 0 ? (
      <p class="meta">
        Browse by country:{" "}
        {countries.slice(0, 24).map((item, index) => (
          <span key={item.name}>
            {index > 0 ? " · " : null}
            <a href={organizationCountryPath(item.name)}>
              {item.name} ({item.count.toLocaleString()})
            </a>
          </span>
        ))}
        {countries.length > 24 ? " · …" : null}
      </p>
    ) : null}
    <DirectoryList
      items={page.items.map((item) => ({
        key: item.rorId,
        href: organizationPath(item.rorId),
        label: item.displayName,
        count: item.countryCode ?? undefined,
      }))}
    />
    <KeysetNav
      path={country ? organizationCountryPath(country) : "/organizations"}
      nextAfter={page.nextAfter}
      after={after}
    />
  </Layout>
);

export const OrganizationPage: FC<{
  organization: AuthorityInstitution;
  peers: OrganizationSummary[];
}> = ({ organization, peers }) => {
  const ror = organization.rorId ?? "";
  return (
    <Layout
      title={organization.displayName}
      canonicalPath={ror ? organizationPath(ror) : undefined}
      ogDescription="ROR organization record."
    >
      <BrowseNav />
      <p class="meta">
        <a href="/organizations">Organizations</a>
        {organization.countryCode ? (
          <>
            {" · "}
            <a href={organizationCountryPath(organization.countryCode)}>
              {organization.countryCode}
            </a>
          </>
        ) : null}
      </p>
      <h1>{organization.displayName}</h1>
      <dl class="entry-fields">
        <dt>ROR</dt>
        <dd class="mono">{organization.rorId ?? "Not recorded"}</dd>
        <dt>OpenAlex</dt>
        <dd class="mono">{organization.openAlexId ?? "Not recorded"}</dd>
        <dt>Country</dt>
        <dd>{organization.countryCode ?? "Not recorded"}</dd>
        <dt>Type</dt>
        <dd>
          {organization.institutionType ||
            (organization.organizationTypes.length > 0
              ? organization.organizationTypes.join(", ")
              : "Not recorded")}
        </dd>
        <dt>Status</dt>
        <dd>{organization.status ?? "Not recorded"}</dd>
      </dl>
      {organization.websiteUrl ? (
        <p>
          <a href={organization.websiteUrl} rel="noopener noreferrer" target="_blank">
            Organization website
          </a>
        </p>
      ) : null}
      <WorksLoader query={organization.displayName} />
      <RelatedRail title="Other organizations in this country">
        <DirectoryList
          items={peers.map((item) => ({
            key: item.rorId,
            href: organizationPath(item.rorId),
            label: item.displayName,
          }))}
        />
      </RelatedRail>
    </Layout>
  );
};

export const SubjectsPage: FC<{
  page: BrowsePage<SubjectSummary>;
  after?: string | null;
}> = ({ page, after }) => (
  <Layout
    title="DOAJ subjects"
    canonicalPath="/subjects"
    ogDescription="Subject labels from the Directory of Open Access Journals."
  >
    <BrowseNav />
    <h1>DOAJ subjects</h1>
    <p>
      These labels come from DOAJ journal records. They are a venue-side topical
      bridge, not OpenAlex topics.
    </p>
    <GraphHonestyNote />
    <DirectoryList
      items={page.items.map((item) => ({
        key: item.subject,
        href: subjectPath(item.subject),
        label: item.subject,
        count: `${item.journalCount.toLocaleString()} journal${item.journalCount === 1 ? "" : "s"}`,
      }))}
    />
    <KeysetNav path="/subjects" nextAfter={page.nextAfter} after={after} />
  </Layout>
);

export const SubjectPage: FC<{
  subject: string;
  venues: BrowsePage<VenueSummary>;
  relatedSubjects: NamedCount[];
  after?: string | null;
}> = ({ subject, venues, relatedSubjects, after }) => (
  <Layout
    title={subject}
    canonicalPath={subjectPath(subject)}
    ogDescription="Venues whose DOAJ record carries this subject label."
  >
    <BrowseNav />
    <p class="meta">
      <a href="/subjects">DOAJ subjects</a>
    </p>
    <h1>{subject}</h1>
    <GraphHonestyNote />
    <WorksLoader query={subject} />
    <div class="browse-rails">
      <div>
        <h2>Venues</h2>
        <DirectoryList
          items={venues.items.map((item) => ({
            key: item.id,
            href: venuePath(item.id),
            label: item.displayName,
            count: item.sourceType ?? undefined,
          }))}
        />
        <KeysetNav path={subjectPath(subject)} nextAfter={venues.nextAfter} after={after} />
      </div>
      {relatedSubjects.length > 0 ? (
        <RelatedRail title="Co-occurring DOAJ subjects">
          <DirectoryList
            items={relatedSubjects.map((item) => ({
              key: item.name,
              href: subjectPath(item.name),
              label: item.name,
              count: `${item.count.toLocaleString()} journal${item.count === 1 ? "" : "s"}`,
            }))}
          />
        </RelatedRail>
      ) : null}
    </div>
  </Layout>
);

export const RetractionsPage: FC<{
  page: BrowsePage<RetractionNotice>;
  after?: string | null;
}> = ({ page, after }) => (
  <Layout
    title="Retraction notices"
    canonicalPath="/retractions"
    ogDescription="Retraction Watch notices in the authority snapshot."
  >
    <BrowseNav />
    <h1>Retraction notices</h1>
    <p>
      <a href="/retractions/reasons">Browse by reason</a>
    </p>
    <DirectoryList
      items={page.items.map((item) => ({
        key: item.id,
        href: retractionPath(item.id),
        label: item.title,
        count: item.noticeDate ?? item.noticeType,
      }))}
    />
    <KeysetNav path="/retractions" nextAfter={page.nextAfter} after={after} />
  </Layout>
);

export const RetractionReasonsPage: FC<{ reasons: NamedCount[] }> = ({ reasons }) => (
  <Layout
    title="Retraction reasons"
    canonicalPath="/retractions/reasons"
    ogDescription="Reason labels attached to Retraction Watch notices."
  >
    <BrowseNav />
    <p class="meta">
      <a href="/retractions">Retraction notices</a>
    </p>
    <h1>Retraction reasons</h1>
    <DirectoryList
      items={reasons.map((item) => ({
        key: item.name,
        href: retractionReasonPath(item.name),
        label: item.name,
        count: `${item.count.toLocaleString()} notice${item.count === 1 ? "" : "s"}`,
      }))}
    />
  </Layout>
);

export const RetractionReasonPage: FC<{
  reason: string;
  page: BrowsePage<RetractionNotice>;
  relatedReasons: NamedCount[];
  journals: VenueSummary[];
  after?: string | null;
}> = ({ reason, page, relatedReasons, journals, after }) => (
  <Layout
    title={reason}
    canonicalPath={retractionReasonPath(reason)}
    ogDescription={`Retraction Watch notices labelled ${reason}.`}
  >
    <BrowseNav />
    <p class="meta">
      <a href="/retractions">Retraction notices</a>
      {" · "}
      <a href="/retractions/reasons">Reasons</a>
    </p>
    <h1>{reason}</h1>
    <div class="browse-rails">
      <div>
        <DirectoryList
          items={page.items.map((item) => ({
            key: item.id,
            href: retractionPath(item.id),
            label: item.title,
            count: item.noticeDate ?? item.noticeType,
          }))}
        />
        <KeysetNav path={retractionReasonPath(reason)} nextAfter={page.nextAfter} after={after} />
      </div>
      {relatedReasons.length > 0 || journals.length > 0 ? (
        <div>
          {relatedReasons.length > 0 ? (
            <RelatedRail title="Co-occurring reasons">
              <DirectoryList
                items={relatedReasons.map((item) => ({
                  key: item.name,
                  href: retractionReasonPath(item.name),
                  label: item.name,
                  count: `${item.count.toLocaleString()} notice${item.count === 1 ? "" : "s"}`,
                }))}
              />
            </RelatedRail>
          ) : null}
          {journals.length > 0 ? (
            <RelatedRail title="Journals with this reason">
              <DirectoryList
                items={journals.map((item) => ({
                  key: item.id,
                  href: venuePath(item.id),
                  label: item.displayName,
                  count: item.sourceType ?? undefined,
                }))}
              />
            </RelatedRail>
          ) : null}
        </div>
      ) : null}
    </div>
  </Layout>
);

export const RetractionNoticePage: FC<{
  notice: RetractionNotice;
  venues: VenueSummary[];
}> = ({ notice, venues }) => (
  <Layout
    title={notice.title}
    canonicalPath={retractionPath(notice.id)}
    ogDescription="Retraction Watch notice."
  >
    <BrowseNav />
    <p class="meta">
      <a href="/retractions">Retraction notices</a>
    </p>
    <h1>{notice.title}</h1>
    <dl class="entry-fields">
      <dt>Type</dt>
      <dd>{notice.noticeType}</dd>
      <dt>Notice date</dt>
      <dd>{notice.noticeDate ?? "Not recorded"}</dd>
      <dt>Journal</dt>
      <dd>{notice.journal ?? "Not recorded"}</dd>
      <dt>Publisher</dt>
      <dd>{notice.publisher ?? "Not recorded"}</dd>
      <dt>Notice DOI</dt>
      <dd class="mono">{notice.doi ?? "Not recorded"}</dd>
      <dt>Original paper DOI</dt>
      <dd class="mono">
        {notice.originalPaperDoi ? (
          <a href={workPath(notice.originalPaperDoi)}>
            {notice.originalPaperDoi}
          </a>
        ) : (
          "Not recorded"
        )}
      </dd>
    </dl>
    <h2>Reasons</h2>
    <DirectoryList
      items={notice.reasons.map((reason) => ({
        key: reason,
        href: retractionReasonPath(reason),
        label: reason,
      }))}
    />
    {venues.length > 0 ? (
      <>
        <h2>Matching venue names</h2>
        <p class="meta">
          Name match only, not an authoritative journal identifier.
        </p>
        <DirectoryList
          items={venues.map((item) => ({
            key: item.id,
            href: venuePath(item.id),
            label: item.displayName,
          }))}
        />
      </>
    ) : null}
  </Layout>
);

export const WorksPartial: FC<{ result: FederatedSearchResponse }> = ({ result }) => (
  <div class="works-partial">
    <p class="meta">
      {result.works.length} merged result{result.works.length === 1 ? "" : "s"}
      {result.cached ? " · cached" : ""}
      {result.partial ? " · partial" : ""}
    </p>
    {result.works.length === 0 ? (
      <p class="status-prompt">No responding source returned a match.</p>
    ) : (
      <ol class="result-list federated-results">
        {result.works.map((item) => (
          <FederatedResult
            item={item}
            key={item.work.doi ?? item.work.canonicalUrl ?? item.work.title}
          />
        ))}
      </ol>
    )}
  </div>
);
