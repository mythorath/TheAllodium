import type { FC, Child } from "hono/jsx";
import type { PublicEntry, SearchHit } from "../contract";

export const Layout: FC<{ title: string; children?: Child }> = (props) => {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} · The Allodium</title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <main>
          <header>
            <p>
              <a href="/">The Allodium</a>
              {" · "}
              <a href="/psychotherapy/search">Search</a>
            </p>
          </header>
          {props.children}
        </main>
      </body>
    </html>
  );
};

export const HomePage: FC = () => (
  <Layout title="Home">
    <h1>The Allodium</h1>
    <p class="meta">
      Phase 1A spike — publication contract and D1 search path. Psychotherapy
      collection only.
    </p>
    <p>
      <a href="/psychotherapy/search">Open keyword search</a>
    </p>
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
  </Layout>
);

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
  <Layout title={entry.title}>
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

export const SearchPage: FC<{
  query: string;
  hits: SearchHit[];
  total: number;
  page: number;
  pageSize: number;
  mode: string;
}> = (props) => {
  const totalPages = Math.max(1, Math.ceil(props.total / props.pageSize));
  const q = encodeURIComponent(props.query);
  return (
    <Layout title="Search">
      <h1>Psychotherapy search</h1>
      <form class="search-form" method="get" action="/psychotherapy/search">
        <input
          type="search"
          name="q"
          value={props.query}
          placeholder="Keyword search"
          aria-label="Search query"
        />
        <button type="submit">Search</button>
      </form>
      {props.query ? (
        <p class="meta">
          {props.total} result{props.total === 1 ? "" : "s"} · mode {props.mode} ·
          page {props.page}/{totalPages}
        </p>
      ) : (
        <p class="meta">Enter a keyword to search the public index.</p>
      )}
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
      {props.total > props.pageSize ? (
        <nav class="pager" aria-label="Pagination">
          {props.page > 1 ? (
            <a href={`/psychotherapy/search?q=${q}&page=${props.page - 1}`}>
              Previous
            </a>
          ) : null}
          {props.page < totalPages ? (
            <a href={`/psychotherapy/search?q=${q}&page=${props.page + 1}`}>Next</a>
          ) : null}
        </nav>
      ) : null}
    </Layout>
  );
};
