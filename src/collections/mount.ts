import { Hono } from "hono";
import { Layout } from "../views/pages";
import { CollectionDb } from "./db";
import { INSTALLED_COLLECTION_MODULES } from "./installed";
import {
  collectionToChrome,
  type CollectionLayout,
  type CollectionModuleDefinition,
  type CollectionResult,
} from "./module";

type HostEnv = Record<string, unknown>;

function bindingDatabase(env: HostEnv, binding: string): D1Database | undefined {
  const value = env[binding];
  if (value && typeof value === "object" && "prepare" in value) {
    return value as D1Database;
  }
  return undefined;
}

/** A redirect is only allowed to an absolute path inside the collection's
 * own mount. Relative targets are rejected too: the browser resolves them
 * against the current path, so `../../psychotherapy` escapes the mount
 * without ever looking like it does. */
function assertSafeRedirect(slug: string, location: string): void {
  const prefix = `/${slug}`;
  if (location !== prefix && !location.startsWith(`${prefix}/`)) {
    throw new Error(`Redirect target must stay under ${prefix}: ${location}`);
  }
}

function applyResult(
  c: {
    html: (body: unknown, status?: 200 | 404 | 500) => Response | Promise<Response>;
    json: (body: unknown, status?: 200 | 404 | 500) => Response;
    redirect: (location: string, status?: 301 | 302) => Response;
    text: (
      body: string,
      status?: 200 | 404 | 500 | 503,
      headers?: Record<string, string>,
    ) => Response;
  },
  slug: string,
  result: CollectionResult,
): Response | Promise<Response> {
  switch (result.kind) {
    case "html":
      return c.html(result.body, (result.status as 200 | 404 | 500 | undefined) ?? 200);
    case "redirect":
      assertSafeRedirect(slug, result.location);
      return c.redirect(result.location, result.status);
    case "json":
      return c.json(result.body, (result.status as 200 | 404 | 500 | undefined) ?? 200);
    case "text":
      return c.text(
        result.body,
        (result.status as 200 | 404 | 500 | undefined) ?? 200,
        {
          "Content-Type": result.contentType ?? "text/plain; charset=UTF-8",
        },
      );
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

export function createCollectionApp(
  definition: CollectionModuleDefinition,
): Hono<{ Bindings: HostEnv }> {
  const chrome = collectionToChrome(definition);
  const sub = new Hono<{ Bindings: HostEnv }>();

  for (const route of definition.routes) {
    if (route.method !== "GET") {
      throw new Error(
        `Collection "${definition.slug}" route ${route.path} must be GET`,
      );
    }
    sub.get(route.path, async (c) => {
      const db = bindingDatabase(c.env, definition.binding);
      if (!db) {
        return c.text(`Collection "${definition.slug}" is not bound`, 503);
      }
      const url = new URL(c.req.url);
      const result = await route.handler({
        slug: definition.slug,
        collection: chrome,
        request: {
          method: c.req.method,
          url,
          params: { ...c.req.param() },
          query: (name) => c.req.query(name),
        },
        db: new CollectionDb(db),
        Layout: Layout as CollectionLayout,
      });
      return applyResult(c as never, definition.slug, result);
    });
  }

  return sub;
}

export function mountInstalledCollections(app: {
  route: (path: string, sub: Hono<{ Bindings: HostEnv }>) => unknown;
}): void {
  for (const definition of INSTALLED_COLLECTION_MODULES) {
    app.route(`/${definition.slug}`, createCollectionApp(definition));
  }
}
