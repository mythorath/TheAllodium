import type { Child, FC } from "hono/jsx";
import type { CollectionDb } from "./db";
import { assertCollectionSlug } from "./slugs";

export type CollectionHttpMethod = "GET";

export type CollectionRoute = {
  method: CollectionHttpMethod;
  /** Path relative to the collection mount, e.g. `/` or `/entries/:id`. */
  path: string;
  handler: CollectionHandler;
};

export type CollectionRequest = {
  method: string;
  url: URL;
  params: Record<string, string>;
  query: (name: string) => string | undefined;
};

export type CollectionChrome = {
  slug: string;
  label: string;
  lede: string;
  status: "live";
  icon: "index" | "atom" | "orbit";
  nav: readonly { href: string; label: string }[];
  shortlistHref?: string;
  advisoryPath?: string;
};

export type CollectionLayout = FC<{
  title: string;
  canonicalPath?: string;
  collection?: CollectionChrome;
  children?: Child;
}>;

export type CollectionContext = {
  slug: string;
  collection: CollectionChrome;
  request: CollectionRequest;
  db: CollectionDb;
  Layout: CollectionLayout;
};

export type CollectionResult =
  | { kind: "html"; status?: number; body: Child }
  | { kind: "redirect"; status: 301 | 302; location: string }
  | { kind: "json"; status?: number; body: unknown }
  | { kind: "text"; status?: number; body: string; contentType?: string };

export type CollectionHandler = (
  ctx: CollectionContext,
) => CollectionResult | Promise<CollectionResult>;

export type CollectionNavPath = {
  path: string;
  label: string;
};

export type CollectionModuleDefinition = {
  slug: string;
  label: string;
  lede: string;
  icon: CollectionChrome["icon"];
  binding: string;
  facetCategories: readonly string[];
  nav: readonly CollectionNavPath[];
  shortlistPath?: string;
  advisoryPath?: string;
  routes: readonly CollectionRoute[];
};

export function defineCollection(
  definition: CollectionModuleDefinition,
): CollectionModuleDefinition {
  assertCollectionSlug(definition.slug);
  if (definition.routes.length === 0) {
    throw new Error(`Collection "${definition.slug}" must declare at least one route`);
  }
  const seen = new Set<string>();
  for (const route of definition.routes) {
    if (route.method !== "GET") {
      throw new Error(`Collection "${definition.slug}" route ${route.path} must be GET`);
    }
    assertCollectionRoutePath(route.path);
    const key = `${route.method}:${route.path}`;
    if (seen.has(key)) {
      throw new Error(`Collection "${definition.slug}" has a duplicate route ${key}`);
    }
    seen.add(key);
  }
  return definition;
}

export function collectionToChrome(definition: CollectionModuleDefinition): CollectionChrome {
  const prefix = `/${definition.slug}`;
  return {
    slug: definition.slug,
    label: definition.label,
    lede: definition.lede,
    status: "live",
    icon: definition.icon,
    nav: definition.nav.map((link) => ({
      href: `${prefix}${link.path === "/" ? "" : link.path}`,
      label: link.label,
    })),
    shortlistHref: definition.shortlistPath
      ? `${prefix}${definition.shortlistPath}`
      : undefined,
    advisoryPath: definition.advisoryPath
      ? `${prefix}${definition.advisoryPath}`
      : undefined,
  };
}

export function assertCollectionRoutePath(path: string): void {
  if (path !== "/" && !path.startsWith("/")) {
    throw new Error(`Collection route path must start with /: ${path}`);
  }
  if (path.includes("..") || path.includes("//") || path.includes("\\")) {
    throw new Error(`Collection route path is not allowed: ${path}`);
  }
}
