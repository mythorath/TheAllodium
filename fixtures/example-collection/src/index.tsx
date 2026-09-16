import { defineCollection } from "@allodium/collection";

export default defineCollection({
  slug: "minerals",
  label: "Minerals",
  lede: "A tiny public-domain geology sample used to prove the collection module contract.",
  icon: "atom",
  binding: "COLLECTION_MINERALS",
  facetCategories: ["topic", "era"],
  nav: [{ path: "/search", label: "Search" }],
  routes: [
    {
      method: "GET",
      path: "/",
      handler: async (ctx) => {
        const countRow = await ctx.db.first<{ c: number }>(
          "SELECT COUNT(*) AS c FROM entries",
        );
        const Layout = ctx.Layout;
        return {
          kind: "html",
          body: (
            <Layout
              title="Minerals"
              canonicalPath="/minerals"
              collection={ctx.collection}
            >
              <h1>Minerals</h1>
              <p class="lede">{ctx.collection.lede}</p>
              <p class="meta">{countRow?.c ?? 0} entries</p>
              <p>
                <a href="/minerals/search">Search</a>
              </p>
            </Layout>
          ),
        };
      },
    },
    {
      method: "GET",
      path: "/search",
      handler: async (ctx) => {
        const q = (ctx.request.query("q") ?? "").trim();
        const hits = q
          ? await ctx.db.query<{ id: string; title: string }>(
              "SELECT e.id, e.title FROM entry_fts JOIN entries e ON e.id = entry_fts.entry_id WHERE entry_fts MATCH ? LIMIT 25",
              [q],
            )
          : await ctx.db.query<{ id: string; title: string }>(
              "SELECT id, title FROM entries ORDER BY title LIMIT 25",
            );
        const Layout = ctx.Layout;
        return {
          kind: "html",
          body: (
            <Layout
              title="Minerals search"
              canonicalPath="/minerals/search"
              collection={ctx.collection}
            >
              <h1>Search minerals</h1>
              <form action="/minerals/search" method="get">
                <label>
                  Query
                  <input type="search" name="q" value={q} />
                </label>
                <button type="submit">Search</button>
              </form>
              <ul>
                {hits.map((hit) => (
                  <li key={hit.id}>
                    <a href={`/minerals/entries/${hit.id}`}>{hit.title}</a>
                  </li>
                ))}
              </ul>
            </Layout>
          ),
        };
      },
    },
    {
      method: "GET",
      path: "/entries/:id",
      handler: async (ctx) => {
        const id = ctx.request.params.id;
        const entry = await ctx.db.first<{
          id: string;
          title: string;
          overview: string | null;
          canonical_url: string;
        }>(
          "SELECT id, title, overview, canonical_url FROM entries WHERE id = ?",
          [id],
        );
        if (!entry) {
          return { kind: "text", status: 404, body: "Not found" };
        }
        const Layout = ctx.Layout;
        return {
          kind: "html",
          body: (
            <Layout
              title={entry.title}
              canonicalPath={`/minerals/entries/${entry.id}`}
              collection={ctx.collection}
            >
              <h1>{entry.title}</h1>
              {entry.overview ? <p>{entry.overview}</p> : null}
              <p>
                <a href={entry.canonical_url}>Open source</a>
              </p>
            </Layout>
          ),
        };
      },
    },
  ],
});
