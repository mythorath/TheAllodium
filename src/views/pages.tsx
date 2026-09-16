import type { FC, Child } from "hono/jsx";
import {
  HOME_DOORS,
  PSYCHOTHERAPY,
  type Collection,
  type CollectionIcon,
  type CollectionStatus,
  type HomeDoor,
} from "../collections";
import type { PublicEntry, RelatedEntry, SearchHit, SnapshotManifest } from "../contract";
import { SITE_URL } from "../site-config";
import type { AccessValue, FacetCounts, FacetFilters, KindValue, StorageValue } from "../db/facets";
import { EMPTY_FACET_FILTERS, KIND_LABELS, KIND_VALUES } from "../db/facets";
import type { SortOption } from "../db/sort";
import { SORT_LABELS, SORT_OPTIONS } from "../db/sort";
import { buildApa, buildBibtexList, buildCitations, buildRisList, citationUrl } from "../citations";
import { FACET_PARAM_NAMES, buildSearchHref, filterEntries } from "../search-url";
import { SUPPORT_ADDRESSES, SUPPORT_LINKS, hasSupportOptions } from "../support";

export const OverviewSection: FC<{ overview: string }> = ({ overview }) => (
  <section class="entry-overview" aria-labelledby="entry-overview-heading">
    <h2 id="entry-overview-heading">Overview</h2>
    <p class="meta">
      AI-generated summary — not a substitute for reading the source.
    </p>
    <p class="entry-overview-body">{overview}</p>
  </section>
);

export const Layout: FC<{
  title: string;
  /** Path (no origin, e.g. "/standard") this page is canonically reachable
   * at. Omit for pages with no single canonical URL (404, error). */
  canonicalPath?: string;
  /** Extra <head> content (e.g. a JSON-LD <script>) beyond the shared
   * boilerplate every page already gets. */
  headExtra?: Child;
  /** Extra content just before </body>, beyond the site-wide `/app.js`
   * every page already loads (see below). Unused as of Phase 2D but kept
   * for future page-scoped additions. */
  bodyExtra?: Child;
  /** Phase 2E: absolute URL to a 1200x630 OG/Twitter card image. Defaults
   * to the static default card (`public/og-default.png`) when omitted, so
   * every page with a `canonicalPath` gets a valid social-preview image
   * even before a page-specific one is threaded through. */
  ogImage?: string;
  /** Phase 2E: short og:description/twitter:description text — always
   * either hand-written per page or synthesized only from public-contract
   * fields (see `EntryPage` below); never sourced from
   * notes/abstract/rationale. */
  ogDescription?: string;
  /** Phase 2E: og:type, e.g. "article" for an entry page. Defaults to
   * "website". */
  ogType?: string;
  /** When set, the header/footer show this collection's nav, shortlist,
   * and (if `advisoryPath` is set) crisis advisory. Site-wide pages omit it. */
  collection?: Collection;
  children?: Child;
}> = (props) => {
  const ogImage = props.ogImage ?? `${SITE_URL}/og-default.png`;
  const ogType = props.ogType ?? "website";
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
        {/* Phase 2E: only pages with a single canonical URL get OG/Twitter
         * tags -- og:url has nothing meaningful to point at otherwise
         * (404/error pages), matching the existing canonical-link rule. */}
        {props.canonicalPath ? (
          <>
            <meta property="og:title" content={props.title} />
            <meta property="og:type" content={ogType} />
            <meta property="og:url" content={`${SITE_URL}${props.canonicalPath}`} />
            <meta property="og:image" content={ogImage} />
            {props.ogDescription ? (
              <meta property="og:description" content={props.ogDescription} />
            ) : null}
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content={props.title} />
            <meta name="twitter:image" content={ogImage} />
            {props.ogDescription ? (
              <meta name="twitter:description" content={props.ogDescription} />
            ) : null}
          </>
        ) : null}
        {props.headExtra ?? null}
      </head>
      <body>
        <a class="skip-link" href="#main">
          Skip to content
        </a>
        <header>
          <nav class="site-nav" aria-label="Primary">
            <a class="site-brand" href="/">
              <img
                class="site-brand-mark"
                src="/favicon.svg"
                width="24"
                height="24"
                alt=""
              />
              The Allodium
            </a>
            {props.collection ? (
              <div class="site-nav-collection">
                <a class="collection-chip" href={`/${props.collection.slug}`}>
                  {props.collection.label}
                </a>
                {props.collection.nav.map((link) => (
                  <a href={link.href} key={link.href}>
                    {link.label}
                  </a>
                ))}
              </div>
            ) : null}
            <div class="site-nav-site">
              <a href="/about">About</a>
              <a href="/standard">The Standard</a>
              {props.collection?.shortlistHref ? (
                /* Phase 2D: a real link so it works with JS off (the empty
                 * shortlist state is a harmless, honest destination); `app.js`
                 * rewrites the href to include the reader's saved ids and
                 * appends a count once localStorage is available. */
                <a href={props.collection.shortlistHref} id="shortlist-nav-link">
                  Shortlist
                </a>
              ) : null}
            </div>
          </nav>
        </header>
        <main id="main">{props.children}</main>
        <footer class="site-footer">
          <p class="meta">
            <a href="/about">About</a>
            {" · "}
            <a href="/standard">The Standard</a>
            {props.collection?.advisoryPath ? (
              <>
                {" · "}
                <a href={props.collection.advisoryPath}>
                  Disclaimer &amp; crisis resources
                </a>
              </>
            ) : null}
          </p>
          {props.collection?.advisoryPath ? (
            <p class="meta">
              Automated checks only, not clinical endorsement or advice. If you
              are in crisis, help is available now — see{" "}
              <a href={props.collection.advisoryPath}>the disclaimer page</a>.
            </p>
          ) : null}
        </footer>
        {/* Phase 2D: loaded site-wide now that both copy-to-clipboard
         * (entry pages) and shortlist add/remove (entry + search/browse +
         * list pages) live here — still the roadmap's single small
         * self-hosted progressive-enhancement file, same unchanged CSP. */}
        <script src="/app.js" defer />
        {props.bodyExtra ?? null}
      </body>
    </html>
  );
};

function CheckIcon() {
  return (
    <svg
      class="icon-check"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M6.17 12.17 2.5 8.5l1.17-1.17 2.5 2.5 6.16-6.17L13.5 4.83z"
      />
    </svg>
  );
}

function IndexIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="5" y="3.5" width="14" height="17" rx="1.6" />
      <path d="M8.5 8h7M8.5 12h7M8.5 16h4.5" />
    </svg>
  );
}

function AtomIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(-60 12 12)" />
    </svg>
  );
}

function OrbitIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="3.2" />
      <ellipse cx="12" cy="12" rx="9.5" ry="4.2" transform="rotate(-20 12 12)" />
      <circle cx="20.2" cy="9.2" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CollectionIconMark(props: { icon: CollectionIcon }) {
  switch (props.icon) {
    case "index":
      return <IndexIcon />;
    case "atom":
      return <AtomIcon />;
    case "orbit":
      return <OrbitIcon />;
    default: {
      const _never: never = props.icon;
      return _never;
    }
  }
}

function CollectionCardInner(props: { collection: Collection }) {
  return (
    <>
      <div class="collection-card-icon">
        <CollectionIconMark icon={props.collection.icon} />
      </div>
      <h3>{props.collection.label}</h3>
      <p class="collection-card-lede">{props.collection.lede}</p>
    </>
  );
}

function CollectionCard(props: { collection: Collection }) {
  const { collection } = props;
  const status: CollectionStatus = collection.status;
  switch (status) {
    case "live":
      return (
        <a class="collection-card" href={`/${collection.slug}`}>
          <CollectionCardInner collection={collection} />
        </a>
      );
    case "planned":
      return (
        <div class="collection-card collection-card-planned">
          <CollectionCardInner collection={collection} />
          <p class="collection-status">In progress</p>
        </div>
      );
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

function HomeDoorCard(props: { door: HomeDoor }) {
  switch (props.door.kind) {
    case "curated":
      return <CollectionCard collection={props.door.collection} />;
    case "federated":
      return (
        <a class="collection-card" href={props.door.href}>
          <div class="collection-card-icon">
            <CollectionIconMark icon={props.door.icon} />
          </div>
          <h3>{props.door.label}</h3>
          <p class="collection-card-lede">{props.door.lede}</p>
        </a>
      );
    default: {
      const exhaustive: never = props.door;
      return exhaustive;
    }
  }
}

function coverageShare(
  counts: Record<string, number> | undefined,
  key: string,
): number | null {
  if (!counts) return null;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if (total === 0) return null;
  return (counts[key] ?? 0) / total;
}

function formatShare(share: number): string {
  const pct = share * 100;
  if (pct >= 99.95) return "100%";
  const rounded = Math.round(pct * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

export const HomePage: FC<{
  entryCount: number | null;
}> = ({ entryCount }) => {
  const openDoorCount = HOME_DOORS.length;
  return (
    <Layout
      title="Home"
      canonicalPath="/"
      ogDescription="A public, ad-free place of free knowledge — a verified index of published research and resources, starting with psychotherapy."
    >
      <section class="home-hero">
        <h1>A place of free knowledge</h1>
        <p class="home-lede">
          Welcome. The Allodium is a public, ad-free index of published
          research and resources — verified for identity, legitimacy, and
          link health before they're listed. Explore what's here today, and
          come back as more fields open.
        </p>
        <div class="stat-strip" aria-label="Index stats">
          {entryCount !== null ? (
            <div class="stat-item">
              <span class="stat-value">{entryCount.toLocaleString()}</span>
              <span class="stat-label">entries</span>
            </div>
          ) : null}
          <div class="stat-item">
            <span class="stat-value">{openDoorCount.toLocaleString()}</span>
            <span class="stat-label">
              {openDoorCount === 1 ? "open doorway" : "open doorways"}
            </span>
          </div>
        </div>
        <p class="meta">No accounts, no cookies, no tracking.</p>
      </section>

      <section class="collections" aria-labelledby="collections-heading">
        <h2 id="collections-heading">Collections</h2>
        <div class="collection-grid">
          {HOME_DOORS.map((door) => (
            <HomeDoorCard
              door={door}
              key={door.kind === "curated" ? door.collection.slug : door.slug}
            />
          ))}
        </div>
      </section>

      <p class="home-cta">
        <a class="button-secondary" href="/standard">
          How verification works
        </a>
      </p>
    </Layout>
  );
};

export const PsychotherapyHomePage: FC<{
  manifest: SnapshotManifest | null;
  kindCounts: { literature: number; materials: number };
}> = ({ manifest, kindCounts }) => {
  const modalityCount = manifest
    ? Object.keys(manifest.coverage_json.modalities ?? {}).length
    : 0;
  const identityShare = coverageShare(
    manifest?.coverage_json.verifications?.identity,
    "ok",
  );
  const linkShare = coverageShare(manifest?.coverage_json.link_status, "ok");
  const exclusions: Record<string, number> = manifest
    ? JSON.parse(manifest.exclusion_counts_json)
    : {};
  return (
    <Layout
      title="Psychotherapy"
      canonicalPath="/psychotherapy"
      collection={PSYCHOTHERAPY}
      ogDescription="A free, ad-free index of published psychotherapy research and resources, verified for identity, legitimacy, and link health."
    >
      <section class="home-hero">
        <h1>A verified index of evidence</h1>
        <p class="home-lede">
          Direct links to research, papers, and resources — checked for
          identity, legitimacy, and link health.
        </p>
        {manifest ? (
          <div class="stat-strip" aria-label="Index stats">
            <div class="stat-item">
              <span class="stat-value">{manifest.entry_count.toLocaleString()}</span>
              <span class="stat-label">entries</span>
            </div>
            {modalityCount > 0 ? (
              <div class="stat-item">
                <span class="stat-value">{modalityCount.toLocaleString()}</span>
                <span class="stat-label">modalities</span>
              </div>
            ) : null}
            {identityShare !== null ? (
              <div class="stat-item stat-item-verified">
                <CheckIcon />
                <span class="stat-value">{formatShare(identityShare)}</span>
                <span class="stat-label">identity verified</span>
              </div>
            ) : null}
            {linkShare !== null ? (
              <div class="stat-item stat-item-verified">
                <CheckIcon />
                <span class="stat-value">{formatShare(linkShare)}</span>
                <span class="stat-label">link health</span>
              </div>
            ) : null}
          </div>
        ) : null}
        <p class="meta">No accounts, no cookies, no tracking.</p>
      </section>

      <section class="collections" aria-labelledby="explore-heading">
        <h2 id="explore-heading">Explore</h2>
        <div class="collection-grid">
          <article class="collection-card">
            <div class="collection-card-icon">
              <IndexIcon />
            </div>
            <h3>Psychotherapy catalog</h3>
            <p class="collection-card-lede">
              Research papers and client resources across therapeutic
              approaches.
            </p>
            <div class="collection-pills">
              <a class="collection-pill" href="/psychotherapy/search?kind=literature">
                Literature
                <span class="home-door-count">
                  {kindCounts.literature.toLocaleString()} papers
                </span>
              </a>
              <a class="collection-pill" href="/psychotherapy/search?kind=materials">
                Materials
                <span class="home-door-count">
                  {kindCounts.materials.toLocaleString()} resources
                </span>
              </a>
            </div>
            <nav class="home-directory" aria-label="Catalog">
              <a href="/psychotherapy/topics">Topics</a>
              <a href="/psychotherapy/hexaflex">Hexaflex</a>
              <a href="/psychotherapy/search">Search everything</a>
            </nav>
          </article>
        </div>
      </section>

      <section class="standard-section">
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
      </section>

      <section class="standard-section">
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
      </section>

      <p class="home-cta">
        <a class="button-secondary" href="/standard">
          How verification works
        </a>
      </p>
    </Layout>
  );
};

export const TopicsPage: FC<{ tags: Array<{ name: string; count: number }> }> = ({
  tags,
}) => {
  return (
    <Layout
      title="Topics"
      canonicalPath="/psychotherapy/topics"
      collection={PSYCHOTHERAPY}
      ogDescription="Browse The Allodium's psychotherapy catalog by topic — depression, anxiety, trauma, and more."
    >
      <h1>Topics</h1>
      <p>
        Browse the catalog by topic. Each link opens a search across literature
        and materials.
      </p>
      <DirectoryList
        tags={tags}
        emptyLabel="topic"
        hrefFor={(name) => buildSearchHref("", { ...EMPTY_FACET_FILTERS, topic: [name] })}
      />
    </Layout>
  );
};

export const HexaflexPage: FC<{ tags: Array<{ name: string; count: number }> }> = ({
  tags,
}) => {
  return (
    <Layout
      title="Hexaflex"
      canonicalPath="/psychotherapy/hexaflex"
      collection={PSYCHOTHERAPY}
      ogDescription="Browse ACT hexaflex processes in The Allodium — acceptance, defusion, values, and the rest."
    >
      <h1>Hexaflex</h1>
      <p>
        The six ACT processes. Each link opens client materials first so
        exercises are not buried under papers — switch Corpus to Literature on
        the search page to include papers.
      </p>
      <DirectoryList
        tags={tags}
        emptyLabel="hexaflex"
        hrefFor={(name) =>
          buildSearchHref("", {
            ...EMPTY_FACET_FILTERS,
            kind: "materials",
            hexaflex: [name],
          })
        }
      />
    </Layout>
  );
};

function DirectoryList(props: {
  tags: Array<{ name: string; count: number }>;
  emptyLabel: string;
  hrefFor: (name: string) => string;
}) {
  if (props.tags.length === 0) {
    return <p class="meta">No {props.emptyLabel} tags in this snapshot.</p>;
  }
  return (
    <ul class="stat-list directory-list">
      {props.tags.map((tag) => (
        <li key={tag.name}>
          <a href={props.hrefFor(tag.name)}>
            <span>{facetNameLabel(tag.name)}</span>
            <span class="stat-count">{tag.count.toLocaleString()}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

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

export const StandardPage: FC = () => {
  return (
    <Layout
      title="The Standard"
      canonicalPath="/standard"
      ogDescription="How every Allodium entry is verified: identity checks, legitimacy triage, and live link-health status."
    >
      <h1>The Standard</h1>
      <p>
        No competitor in this space publishes its link-integrity and
        identity-verification provenance. The Allodium does, for every entry,
        because a resource list is only as trustworthy as the checks behind
        it.
      </p>

      <section class="standard-section">
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
          endorsement or advice.
        </p>
      </section>

      <section class="standard-section">
        <h2>Coverage</h2>
        <p>
          Live coverage numbers — identity checks, legitimacy triage, link
          health, identifiers, modalities, and exclusions — live on each
          collection's landing, because they describe that collection's
          snapshot. See{" "}
          <a href="/psychotherapy">Psychotherapy</a> for the current
          published set.
        </p>
        <p>
          Cross-field federation coverage, upstream status, and known blind
          spots are published separately on the <a href="/coverage">Open Index
          coverage page</a>.
        </p>
      </section>

      <section class="standard-section">
        <h2>Credibility signals, not a blacklist</h2>
        <p>
          Federated results are not admitted or rejected by a hidden gate.
          Each result carries an expandable, versioned set of metadata signals:
          DOI registration, recognized venue and institution records, access
          and license information, publication version, metadata completeness,
          and Retraction Watch notices.
        </p>
        <ul>
          <li>
            Absence from DOAJ, MEDLINE, OpenAlex, ROR, or another allow-list is
            neutral. It is never presented as evidence that a work or publisher
            is not credible.
          </li>
          <li>
            Retractions and expressions of concern remain searchable and are
            shown as prominent warnings; the historical record is not erased.
          </li>
          <li>
            The Allodium does not use proprietary or unlicensed
            predatory-publisher lists. Their licensing, false-positive, and
            defamation risks are incompatible with a transparent public index.
          </li>
          <li>
            A score describes available metadata evidence. It does not assess
            methods, reproduce results, or endorse conclusions.
          </li>
        </ul>
        <p class="meta">
          Current federated policy: <code>1.0.0</code>. Every displayed signal
          names its evidence source and license.
        </p>
      </section>

      <section class="standard-section">
        <h2>Limitations</h2>
        <ul>
          <li>
            Checks are automated and deterministic where possible; they are
            not a substitute for reading the source or for professional
            judgment.
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
      </section>

      <section class="standard-section">
        <h2>Optional AI-assisted search</h2>
        <p>
          Search has an optional plain-language field. Keyword and facet
          search always work without it.
        </p>
        <ul>
          <li>
            The model is <code>qwen2.5:7b-instruct-q6_k</code>, running on
            Selis. The Worker sends only the visitor's ask text (capped),
            never PDFs, abstracts, or other unpublished fields.
          </li>
          <li>
            Suggested filters are re-validated against the public index;
            unknown tokens are dropped.
          </li>
          <li>
            If the GPU is offline, times out, or otherwise fails for a
            reason other than abuse rate-limiting, results fall back to
            plain keyword search.
          </li>
          <li>
            This is not therapy or clinical advice. Phrases that look like
            crisis intent skip the model and show the existing 988 copy.
          </li>
        </ul>
      </section>

      <section class="standard-section">
        <h2>Update cadence</h2>
        <p>
          Each public snapshot is regenerated from its source catalog and
          redeployed as a whole — coverage numbers on a collection landing
          always describe exactly the entries currently live, not a newer or
          older dataset.
        </p>
      </section>
    </Layout>
  );
};

export const CrisisResources: FC<{ banner?: boolean }> = (props) => (
  <div class={props.banner ? "crisis-block crisis-banner" : "crisis-block"}>
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
);

export const AboutPage: FC = () => (
  <Layout
    title="About"
    canonicalPath="/about"
    ogDescription="Why The Allodium exists: a deep desire to find knowledge and hand it on, freely — no ads, no accounts, no paywalls on the index."
  >
    <h1>Why The Allodium exists</h1>
    <div class="prose">
      <p>
        I have a deep desire to find things out and hand them on. Not to
        gatekeep them, not to meter them out — to put good information where
        anyone can reach it. That urge is the whole reason this site exists.
      </p>
      <p>
        An <em>allodium</em> is land held outright — owned freely, owing rent
        to no lord. That is what I want knowledge to be: held by everyone,
        owing nothing to anyone. So The Allodium collects published research
        and resources, runs every entry through the identity, legitimacy, and
        link-health checks described in <a href="/standard">The Standard</a>,
        and links you straight to the source.
      </p>
      <p>
        It starts with psychotherapy because that is where I began digging.
        It will not end there — physics, cosmology, and more fields are on
        the way. The shape stays the same wherever it goes: verified,
        readable, and free.
      </p>
      <h2>What you can count on</h2>
      <ul>
        <li>No ads, no accounts, no cookies, no tracking. Ever.</li>
        <li>
          Every entry is checked before it is listed, and the checks
          themselves are published — see{" "}
          <a href="/standard">The Standard</a>.
        </li>
        <li>
          The Allodium is an index. It links out to original sources rather
          than hosting or republishing anyone's work.
        </li>
      </ul>
      {hasSupportOptions() ? (
        <section class="support-section" aria-labelledby="support-heading">
          <h2 id="support-heading">If you'd like to leave a tip</h2>
          <p class="meta">
            Everything here is free and always will be — nothing is ever
            behind a tip. But if The Allodium has been useful and you feel
            like keeping the lights on, it's appreciated.
          </p>
          {SUPPORT_LINKS.length > 0 ? (
            <ul class="support-links">
              {SUPPORT_LINKS.map((link) => (
                <li key={link.href}>
                  <a href={link.href} rel="noopener noreferrer" target="_blank">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {SUPPORT_ADDRESSES.map((wallet, i) => (
            <div class="support-address" key={wallet.label}>
              <h3>{wallet.label}</h3>
              <pre id={`support-address-${i}`}>{wallet.address}</pre>
              <button
                type="button"
                class="copy-button"
                data-copy-target={`support-address-${i}`}
              >
                Copy address
              </button>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  </Layout>
);

export const DisclaimerPage: FC = () => (
  <Layout
    title="Disclaimer"
    canonicalPath="/psychotherapy/disclaimer"
    collection={PSYCHOTHERAPY}
    ogDescription="The Allodium is a verified index of psychotherapy resources, not therapy or a clinical service. Crisis resources included."
  >
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
      <CrisisResources />
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
  if (entry.overview) mainEntity.description = entry.overview;

  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: `${SITE_URL}/psychotherapy/entries/${entry.id}`,
    name: entry.title,
    description: entry.overview ?? undefined,
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
    return <span class="badge badge-unchecked">link unchecked</span>;
  }
  return (
    <span class="badge badge-ok">
      <CheckIcon />
      link ok
    </span>
  );
}

function formatEntryAuthors(entry: PublicEntry): string {
  if (entry.authors && entry.authors.length > 0) {
    return entry.authors
      .map((a) => (a.institution ? `${a.name} (${a.institution})` : a.name))
      .join(", ");
  }
  return entry.author ?? "—";
}

type ResultMetaFields = {
  therapy_modality: string;
  resource_type: string;
  audience: PublicEntry["audience"];
  published_date: string | null;
  citation_count: number | null;
  source_org: string | null;
  link_status: PublicEntry["link_status"];
};

function hitYear(publishedDate: string | null): string | null {
  const match = publishedDate?.match(/\d{4}/);
  return match ? match[0] : null;
}

function resultMetaParts(hit: ResultMetaFields): string {
  const parts: string[] = [hit.therapy_modality, hit.resource_type, hit.audience];
  const year = hitYear(hit.published_date);
  if (year) parts.push(year);
  if (hit.citation_count !== null) {
    parts.push(
      hit.citation_count === 1 ? "1 citation" : `${hit.citation_count.toLocaleString()} citations`,
    );
  }
  if (hit.source_org) parts.push(hit.source_org);
  return parts.join(" · ");
}

const CITATION_LABELS = {
  bibtex: "BibTeX",
  ris: "RIS",
  apa: "APA",
} as const;

/** Phase 2C: renders a citation's text with its trailing DOI/URL segment as
 * a real clickable `doi.org` link, while the combined text content stays
 * exactly `citations.apa` — enforced by slicing the known-length `url` off
 * the end of the full formatted string rather than duplicating formatting
 * logic. Shared by the single-entry (`ApaCitation`) and whole-shortlist
 * (`ApaCitationList`, Phase 2D) renderings below. */
function ApaCitationBody(props: { text: string; url: string }) {
  const prefix = props.text.slice(0, props.text.length - props.url.length);
  return (
    <>
      {prefix}
      <a href={props.url} rel="noopener noreferrer" target="_blank">
        {props.url}
      </a>
    </>
  );
}

function ApaCitation(props: { text: string; url: string }) {
  return (
    <p id="citation-apa">
      <ApaCitationBody text={props.text} url={props.url} />
    </p>
  );
}

/** Phase 2D: the shortlist page's combined APA block — one `<p>` per entry
 * inside a single wrapping `#citation-apa`, so the existing copy-button
 * `textContent` logic in `app.js` needs no changes to cover every entry. */
function ApaCitationList(props: { items: Array<{ id: string; text: string; url: string }> }) {
  return (
    <div id="citation-apa">
      {props.items.map((item) => (
        <p key={item.id}>
          <ApaCitationBody text={item.text} url={item.url} />
        </p>
      ))}
    </div>
  );
}

/** Phase 2E / v1.2: og:description for an entry page. Prefer the
 * machine-generated overview when present; otherwise fall back to
 * resource type · modality · source org. Never abstract/notes/rationale. */
function buildEntryOgDescription(entry: PublicEntry): string {
  if (entry.overview) {
    const trimmed = entry.overview.trim();
    if (trimmed.length <= 280) return trimmed;
    return `${trimmed.slice(0, 279).trimEnd()}…`;
  }
  const parts = [entry.resource_type, entry.therapy_modality];
  if (entry.source_org) parts.push(entry.source_org);
  return parts.filter(Boolean).join(" · ");
}

function CitationBlock(props: { format: "bibtex" | "ris"; text: string }) {
  return (
    <div class="citation-block">
      <h3>{CITATION_LABELS[props.format]}</h3>
      <pre id={`citation-${props.format}`}>{props.text}</pre>
      <button type="button" class="copy-button" data-copy-target={`citation-${props.format}`}>
        Copy {CITATION_LABELS[props.format]}
      </button>
    </div>
  );
}

export const EntryPage: FC<{ entry: PublicEntry; related: RelatedEntry[] }> = ({
  entry,
  related,
}) => {
  const citations = buildCitations(entry);
  const apaUrl = citationUrl(entry);
  return (
    <Layout
      title={entry.title}
      canonicalPath={`/psychotherapy/entries/${entry.id}`}
      collection={PSYCHOTHERAPY}
      headExtra={<EntryJsonLd entry={entry} />}
      ogType="article"
      ogImage={`${SITE_URL}/og/${entry.id}.png`}
      ogDescription={buildEntryOgDescription(entry)}
    >
      <h1>{entry.title}</h1>
      <p class="meta entry-meta">
        <span class="badge">{entry.therapy_modality}</span>
        <span class="badge">{entry.resource_type}</span>
        <span class="badge">{entry.audience}</span>
        <span class="badge">tier {entry.credibility_tier}</span>
        <LinkBadge status={entry.link_status} />
        {entry.is_link_only ? <span class="badge badge-unchecked">link-only</span> : null}
      </p>
      <p class="entry-actions">
        <a
          class="button-primary"
          href={entry.canonical_url}
          rel="noopener noreferrer"
          target="_blank"
        >
          Open source
        </a>
        <button
          type="button"
          class="shortlist-button"
          data-shortlist-id={entry.id}
          aria-pressed="false"
        >
          Add to shortlist
        </button>
      </p>
      {entry.overview ? <OverviewSection overview={entry.overview} /> : null}
      <dl class="entry-fields">
        <dt>ID</dt>
        <dd>
          <code>{entry.id}</code>
        </dd>
        <dt>Source org</dt>
        <dd>{entry.source_org ?? "—"}</dd>
        <dt>Author</dt>
        <dd>{formatEntryAuthors(entry)}</dd>
        <dt>Published</dt>
        <dd class="mono">{entry.published_date ?? "—"}</dd>
        <dt>OA status</dt>
        <dd>{entry.oa_status ?? "—"}</dd>
        <dt>DOI</dt>
        <dd class="mono">{entry.doi ?? "—"}</dd>
        <dt>PMID</dt>
        <dd class="mono">{entry.pmid ?? "—"}</dd>
        <dt>PMCID</dt>
        <dd class="mono">{entry.pmcid ?? "—"}</dd>
        <dt>Citations</dt>
        <dd class="mono">{entry.citation_count ?? "—"}</dd>
      </dl>

      <h2>Tags</h2>
      {entry.tags.length === 0 ? (
        <p class="meta">No tags</p>
      ) : (
        <ul class="tag-list">
          {entry.tags.map((t) => {
            const href = tagSearchHref(t);
            return (
              <li key={`${t.category}:${t.name}`}>
                {href ? <a href={href}>{t.name}</a> : t.name}{" "}
                <span class="meta">({t.category})</span>
              </li>
            );
          })}
        </ul>
      )}

      <h2>Verification</h2>
      <p class="meta">
        Automated checks only — not clinical endorsement or advice.
      </p>
      {entry.verifications.length === 0 ? (
        <p class="meta">No verification records</p>
      ) : (
        <ul class="verification-list">
          {entry.verifications.map((v, i) => (
            <li key={`${v.check_kind}-${i}`}>
              <span class="verification-kind">
                {v.result === "ok" ? <CheckIcon /> : null}
                {v.check_kind}
              </span>
              <span class="verification-detail">
                {v.result} via {v.method}
                {v.method_version ? ` (${v.method_version})` : ""}
                {v.score !== null ? ` · score ${v.score}` : ""}
                {v.checked_at ? ` · ${v.checked_at}` : " · checked_at unknown"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2>Cite this entry</h2>
      <CitationBlock format="bibtex" text={citations.bibtex} />
      <CitationBlock format="ris" text={citations.ris} />
      <div class="citation-block">
        <h3>{CITATION_LABELS.apa}</h3>
        <ApaCitation text={citations.apa} url={apaUrl} />
        <button type="button" class="copy-button" data-copy-target="citation-apa">
          Copy APA
        </button>
      </div>

      <h2>Related entries</h2>
      {related.length === 0 ? (
        <p class="meta">No related entries in this snapshot</p>
      ) : (
        <>
          <p class="meta">
            <a href={`/psychotherapy/search?like=${encodeURIComponent(entry.id)}`}>
              More like this
            </a>
          </p>
          <ul class="result-list">
            {related.map((r) => (
              <li key={r.id}>
                <a href={`/psychotherapy/entries/${r.id}`}>{r.title}</a>
                <div class="meta">
                  <span class="badge">{r.therapy_modality}</span>
                  <LinkBadge status={r.link_status} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Layout>
  );
};

const ACCESS_LABELS: Record<AccessValue, string> = {
  free: "Free to read",
  paywalled: "Paywalled",
};

const STORAGE_LABELS: Record<StorageValue, string> = {
  stored: "Available here",
  link_only: "External link only",
};

/** Topic and hexaflex tags start a fresh search; other categories stay text. */
function tagSearchHref(tag: { name: string; category: string }): string | null {
  if (tag.category === "topic") {
    return buildSearchHref("", { ...EMPTY_FACET_FILTERS, topic: [tag.name] });
  }
  if (tag.category === "hexaflex") {
    return buildSearchHref("", { ...EMPTY_FACET_FILTERS, hexaflex: [tag.name] });
  }
  return null;
}

function facetNameLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function clearableFilters(filters: FacetFilters): FacetFilters {
  return { ...EMPTY_FACET_FILTERS, kind: filters.kind };
}

/** Phase 2D: the shortlist's entire state is this one query param, so
 * "remove one item" is just linking to the same route with a shorter list —
 * no JS required to edit a shortlist you're currently viewing. */
function buildListHref(ids: string[]): string {
  if (ids.length === 0) return "/psychotherapy/list";
  return `/psychotherapy/list?ids=${ids.map(encodeURIComponent).join(",")}`;
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
            data-auto-submit
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
  sort: SortOption;
  likeId: string | null;
  likeTitle: string | null;
  crisis?: boolean;
  assistOffline?: boolean;
}> = (props) => {
  const totalPages = Math.max(1, Math.ceil(props.total / props.pageSize));
  const hasFilters = filterEntries(props.filters).length > 0;
  const isNeighbors = props.mode === "neighbors";
  const likeId = isNeighbors ? props.likeId : null;
  const hasClearableFilters =
    props.filters.modality.length > 0 ||
    props.filters.audience.length > 0 ||
    props.filters.access.length > 0 ||
    props.filters.storage.length > 0 ||
    props.filters.linkStatus.length > 0 ||
    props.filters.topic.length > 0 ||
    props.filters.hexaflex.length > 0 ||
    props.filters.type.length > 0 ||
    props.filters.decade.length > 0;
  const hasFacetOptions =
    props.facets.modality.length > 0 ||
    props.facets.audience.length > 0 ||
    props.facets.access.length > 0 ||
    props.facets.storage.length > 0 ||
    props.facets.linkStatus.length > 0 ||
    props.facets.topic.length > 0 ||
    props.facets.hexaflex.length > 0 ||
    props.facets.type.length > 0 ||
    props.facets.decade.length > 0;
  const sortOptions = props.query || isNeighbors
    ? SORT_OPTIONS
    : SORT_OPTIONS.filter((opt) => opt !== "relevance");
  const effectiveSort =
    !props.query && !isNeighbors && props.sort === "relevance" ? "title_asc" : props.sort;
  const kindCountByValue = Object.fromEntries(
    props.facets.kind.map((o) => [o.value, o.count]),
  ) as Partial<Record<KindValue, number>>;
  const allKindCount = KIND_VALUES.reduce(
    (sum, value) => sum + (kindCountByValue[value] ?? 0),
    0,
  );

  return (
    <Layout
      title="Search"
      canonicalPath="/psychotherapy/search"
      collection={PSYCHOTHERAPY}
      ogDescription="Keyword search and faceted browsing over The Allodium's verified psychotherapy research index."
    >
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
          <label class="visually-hidden" for="search-ask">
            Ask in plain language
          </label>
          <input
            id="search-ask"
            type="search"
            name="ask"
            value=""
            placeholder="Or ask in plain language"
          />
          <button type="submit">Search</button>
        </div>
        {likeId ? <input type="hidden" name="like" value={likeId} /> : null}
        <fieldset class="corpus-switch">
          <legend>Corpus</legend>
          <label class="corpus-option">
            <input type="radio" name="kind" value="" checked={props.filters.kind === null} />
            All{allKindCount > 0 ? ` (${allKindCount.toLocaleString()})` : ""}
          </label>
          {KIND_VALUES.map((value) => {
            const count = kindCountByValue[value];
            return (
              <label class="corpus-option" key={value}>
                <input
                  type="radio"
                  name="kind"
                  value={value}
                  checked={props.filters.kind === value}
                />
                {KIND_LABELS[value]}
                {count !== undefined ? ` (${count.toLocaleString()})` : ""}
              </label>
            );
          })}
        </fieldset>
        {hasFacetOptions ? (
          <div class="facet-band">
            <div class="facet-groups">
              <FacetGroup
                legend="Topic"
                paramName={FACET_PARAM_NAMES.topic}
                options={props.facets.topic}
                labelFor={facetNameLabel}
              />
              <FacetGroup
                legend="Hexaflex"
                paramName={FACET_PARAM_NAMES.hexaflex}
                options={props.facets.hexaflex}
                labelFor={facetNameLabel}
              />
              {props.filters.kind === "materials" ? (
                <FacetGroup
                  legend="Type"
                  paramName={FACET_PARAM_NAMES.type}
                  options={props.facets.type}
                />
              ) : null}
              {props.filters.kind === "literature" ? (
                <FacetGroup
                  legend="Decade"
                  paramName={FACET_PARAM_NAMES.decade}
                  options={props.facets.decade}
                />
              ) : null}
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
            </div>
            {hasClearableFilters ? (
              <p class="facet-toolbar">
                <a
                  href={buildSearchHref(
                    props.query,
                    clearableFilters(props.filters),
                    undefined,
                    props.sort,
                    likeId,
                  )}
                >
                  Clear filters
                </a>
              </p>
            ) : null}
          </div>
        ) : null}
        {props.mode !== "empty" || hasFacetOptions ? (
          <div class="sort-bar">
            <label for="search-sort">Sort by</label>
            <select
              id="search-sort"
              name="sort"
              data-auto-submit
              value={effectiveSort}
            >
              {sortOptions.map((opt) => (
                <option key={opt} value={opt} selected={opt === effectiveSort}>
                  {SORT_LABELS[opt]}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </form>
      {props.crisis ? <CrisisResources banner /> : null}
      {props.assistOffline ? (
        <p class="assist-notice" role="status">
          AI search assist is offline — showing keyword results.
        </p>
      ) : null}
      {props.mode === "empty" ? (
        <p class="status-prompt">
          Browse{" "}
          <a href="/psychotherapy/search?kind=literature">literature</a>
          {" or "}
          <a href="/psychotherapy/search?kind=materials">materials</a>
          , or type a keyword to search both.
        </p>
      ) : (
        <p class="meta" aria-live="polite">
          {props.total} result{props.total === 1 ? "" : "s"}
          {props.query ? (
            ` for "${props.query}"`
          ) : isNeighbors && likeId ? (
            <>
              {" similar to "}
              <a href={`/psychotherapy/entries/${likeId}`}>
                {props.likeTitle ?? likeId}
              </a>
            </>
          ) : hasFilters ? (
            " matching your filters"
          ) : (
            ""
          )}
        </p>
      )}
      {props.mode !== "empty" && props.total === 0 ? (
        <p class="status-prompt" role="status">
          {props.query ? (
            <>No results for "{props.query}". Try a broader or differently spelled term.</>
          ) : isNeighbors ? (
            <>No similar entries for this item.</>
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
                {resultMetaParts(hit)}
                {hit.link_status === "blocked" ? " · link inconclusive" : ""}
              </div>
              <button
                type="button"
                class="shortlist-button"
                data-shortlist-id={hit.id}
                aria-pressed="false"
              >
                Add to shortlist
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {props.total > props.pageSize ? (
        <nav class="pager" aria-label="Pagination">
          {props.page > 2 ? (
            <a href={buildSearchHref(props.query, props.filters, 1, props.sort, likeId)}>
              First
            </a>
          ) : null}
          {props.page > 1 ? (
            <a href={buildSearchHref(props.query, props.filters, props.page - 1, props.sort, likeId)}>
              Previous
            </a>
          ) : null}
          <span class="pager-status">
            Page {props.page} of {totalPages}
          </span>
          {props.page < totalPages ? (
            <a href={buildSearchHref(props.query, props.filters, props.page + 1, props.sort, likeId)}>
              Next
            </a>
          ) : null}
          {props.page < totalPages - 1 ? (
            <a href={buildSearchHref(props.query, props.filters, totalPages, props.sort, likeId)}>
              Last
            </a>
          ) : null}
        </nav>
      ) : null}
    </Layout>
  );
};

/**
 * Phase 2D: `/psychotherapy/list?ids=…` — the URL is the entire shared
 * state, no accounts, no cookies. `entries` is already in request order
 * with aliases resolved and duplicates collapsed (see
 * `getEntriesByIds()`); `missingCount` covers ids that didn't resolve to
 * anything at all, rendered as an honest note rather than silently dropped.
 */
export const ListPage: FC<{
  requestedCount: number;
  entries: PublicEntry[];
  missingCount: number;
}> = ({ requestedCount, entries, missingCount }) => {
  const ids = entries.map((e) => e.id);
  const apaItems = entries.map((e) => ({ id: e.id, text: buildApa(e), url: citationUrl(e) }));

  return (
    <Layout title="Shortlist" canonicalPath="/psychotherapy/list" collection={PSYCHOTHERAPY}>
      <h1>Shortlist</h1>
      {requestedCount === 0 ? (
        <div class="list-empty status-prompt">
          <p>
            No items yet. Use "Add to shortlist" on an entry or search result to
            build a personal list in this browser, or open a shortlist link
            someone shared with you.
          </p>
          <p class="meta">
            Shared lists live entirely in the URL — no accounts required.
          </p>
        </div>
      ) : (
        <>
          <p class="meta" aria-live="polite">
            {entries.length} {entries.length === 1 ? "entry" : "entries"} in this shortlist
            {missingCount > 0
              ? ` · ${missingCount} item${missingCount === 1 ? "" : "s"} in this link could not be shown (retired or unknown id${missingCount === 1 ? "" : "s"})`
              : ""}
          </p>
          {entries.length === 0 ? (
            <p class="status-prompt" role="status">
              None of the items in this link could be found.
            </p>
          ) : (
            <>
              <ul class="result-list">
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <a href={`/psychotherapy/entries/${entry.id}`}>{entry.title}</a>
                    <div class="meta">
                      {resultMetaParts(entry)}
                      {" "}
                      <LinkBadge status={entry.link_status} />
                    </div>
                    <div class="list-row-actions">
                      <a
                        class="remove-link"
                        href={buildListHref(ids.filter((id) => id !== entry.id))}
                      >
                        Remove from this shared list
                      </a>
                      <button
                        type="button"
                        class="shortlist-button"
                        data-shortlist-id={entry.id}
                        aria-pressed="false"
                      >
                        Add to shortlist
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <h2>Cite these entries</h2>
              <CitationBlock format="bibtex" text={buildBibtexList(entries)} />
              <CitationBlock format="ris" text={buildRisList(entries)} />
              <div class="citation-block">
                <h3>{CITATION_LABELS.apa}</h3>
                <ApaCitationList items={apaItems} />
                <button type="button" class="copy-button" data-copy-target="citation-apa">
                  Copy APA
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Layout>
  );
};
