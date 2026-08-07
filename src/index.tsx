import { Hono } from "hono";
import {
  getEntry,
  getManifest,
  resolveCanonicalId,
  searchEntries,
} from "./db/repository";
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

const app = new Hono<{ Bindings: AppBindings }>();

app.get("/", async (c) => {
  const manifest = await getManifest(c.env.DB);
  return c.html(<HomePage manifest={manifest} />);
});

app.get("/standard", async (c) => {
  const manifest = await getManifest(c.env.DB);
  return c.html(<StandardPage manifest={manifest} />);
});

app.get("/disclaimer", (c) => c.html(<DisclaimerPage />));

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

app.onError((err, c) => {
  console.error(err);
  return c.html(<ErrorPage />, 500);
});

export default app;
