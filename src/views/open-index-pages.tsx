import type { FC } from "hono/jsx";
import type {
  TaxonomyDomain,
  TaxonomyField,
  TaxonomySubfield,
} from "../authority/types";
import { buildFederatedCitations } from "../citations";
import type { CredibilitySignal, SignalPolarity } from "../credibility/types";
import type {
  FederatedSearchResponse,
  ScoredFederatedWork,
} from "../federation/service";
import type { AdapterStatus, NormalizedWork } from "../federation/types";
import { COVERAGE_SOURCES, coverageByMode, type CoverageMode } from "../open-index/coverage";
import { SITE_URL } from "../site-config";
import { Layout } from "./pages";

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

export const FieldsPage: FC<{ domains: TaxonomyDomain[] }> = ({ domains }) => (
  <Layout
    title="Fields"
    canonicalPath="/fields"
    ogDescription="Browse the OpenAlex four-level research taxonomy used by The Allodium."
  >
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

export const DomainPage: FC<{ domain: TaxonomyDomain }> = ({ domain }) => (
  <Layout title={domain.displayName} canonicalPath={`/fields/${encodeURIComponent(domain.id)}`}>
    <h1>{domain.displayName}</h1>
    {domain.description ? <p>{domain.description}</p> : null}
    <p class="meta">{countLabel(domain.worksCount)}</p>
    <ul class="directory-list stat-list">
      {domain.fields.map((field) => (
        <li key={field.id}>
          <a
            href={`/fields/${encodeURIComponent(domain.id)}/${encodeURIComponent(field.id)}`}
          >
            <span>{field.displayName}</span>
            <span class="stat-count">{countLabel(field.worksCount)}</span>
          </a>
        </li>
      ))}
    </ul>
  </Layout>
);

export const FieldPage: FC<{
  domain: TaxonomyDomain;
  field: TaxonomyField;
}> = ({ domain, field }) => (
  <Layout
    title={field.displayName}
    canonicalPath={`/fields/${encodeURIComponent(domain.id)}/${encodeURIComponent(field.id)}`}
  >
    <p class="meta">
      <a href={`/fields/${encodeURIComponent(domain.id)}`}>{domain.displayName}</a>
    </p>
    <h1>{field.displayName}</h1>
    {field.description ? <p>{field.description}</p> : null}
    <ul class="directory-list stat-list">
      {field.subfields.map((subfield) => (
        <li key={subfield.id}>
          <a
            href={`/fields/${encodeURIComponent(domain.id)}/${encodeURIComponent(field.id)}/${encodeURIComponent(subfield.id)}`}
          >
            <span>{subfield.displayName}</span>
            <span class="stat-count">{countLabel(subfield.worksCount)}</span>
          </a>
        </li>
      ))}
    </ul>
  </Layout>
);

export const SubfieldPage: FC<{
  domain: TaxonomyDomain;
  field: TaxonomyField;
  subfield: TaxonomySubfield;
}> = ({ domain, field, subfield }) => (
  <Layout
    title={subfield.displayName}
    canonicalPath={`/fields/${encodeURIComponent(domain.id)}/${encodeURIComponent(field.id)}/${encodeURIComponent(subfield.id)}`}
  >
    <p class="meta">
      <a href={`/fields/${encodeURIComponent(domain.id)}`}>{domain.displayName}</a>
      {" · "}
      <a href={`/fields/${encodeURIComponent(domain.id)}/${encodeURIComponent(field.id)}`}>
        {field.displayName}
      </a>
    </p>
    <h1>{subfield.displayName}</h1>
    {subfield.description ? <p>{subfield.description}</p> : null}
    <p>
      <a
        class="button-primary"
        href={`/search?q=${encodeURIComponent(subfield.displayName)}`}
      >
        Search this subfield
      </a>
    </p>
    <h2>Topics</h2>
    <ul class="directory-list stat-list">
      {subfield.topics.map((topic) => (
        <li key={topic.id}>
          <a href={`/search?q=${encodeURIComponent(topic.displayName)}`}>
            <span>{topic.displayName}</span>
            <span class="stat-count">{countLabel(topic.worksCount)}</span>
          </a>
        </li>
      ))}
    </ul>
  </Layout>
);

function WorkJsonLd(props: { item: ScoredFederatedWork }) {
  const work = props.item.work;
  const json = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: work.doi ? `${SITE_URL}/works/${encodeURIComponent(work.doi)}` : undefined,
    name: work.title,
    mainEntity: {
      "@type": "ScholarlyArticle",
      name: work.title,
      identifier: work.doi ? `https://doi.org/${work.doi}` : undefined,
      url: work.canonicalUrl ?? undefined,
      datePublished: work.publishedDate ?? undefined,
      author: work.authors.map((author) => ({ "@type": "Person", name: author.name })),
    },
  }).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}

export const FederatedWorkPage: FC<{ item: ScoredFederatedWork }> = ({ item }) => {
  const { work, credibility } = item;
  const citations = buildFederatedCitations(work);
  return (
    <Layout
      title={work.title}
      canonicalPath={work.doi ? `/works/${encodeURIComponent(work.doi)}` : undefined}
      headExtra={<WorkJsonLd item={item} />}
      ogType="article"
      ogDescription={`${credibility.band.replaceAll("-", " ")} · ${work.containerTitle ?? "scholarly record"}`}
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
      <dl class="entry-fields">
        <dt>DOI</dt>
        <dd class="mono">{work.doi ?? "—"}</dd>
        <dt>Published</dt>
        <dd>{work.publishedDate ?? work.publicationYear ?? "—"}</dd>
        <dt>Container</dt>
        <dd>{work.containerTitle ?? "—"}</dd>
        <dt>Publisher</dt>
        <dd>{work.publisher ?? "—"}</dd>
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
              {source.limitation ? <span class="meta"> — {source.limitation}</span> : null}
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
