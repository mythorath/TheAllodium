/** Ambient types for authoring a collection in another IDE.
 * The host implements these in src/collections/module.ts. */

declare module "@allodium/collection" {
  export type CollectionHttpMethod = "GET";

  export type CollectionNavPath = { path: string; label: string };

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

  export type CollectionRequest = {
    method: string;
    url: URL;
    params: Record<string, string>;
    query: (name: string) => string | undefined;
  };

  export type CollectionDb = {
    query<T extends Record<string, unknown>>(sql: string, binds?: unknown[]): Promise<T[]>;
    first<T extends Record<string, unknown>>(sql: string, binds?: unknown[]): Promise<T | null>;
  };

  export type CollectionLayout = (props: {
    title: string;
    canonicalPath?: string;
    collection?: CollectionChrome;
    children?: unknown;
  }) => unknown;

  export type CollectionContext = {
    slug: string;
    collection: CollectionChrome;
    request: CollectionRequest;
    db: CollectionDb;
    Layout: CollectionLayout;
  };

  export type CollectionResult =
    | { kind: "html"; status?: number; body: unknown }
    | { kind: "redirect"; status: 301 | 302; location: string }
    | { kind: "json"; status?: number; body: unknown }
    | { kind: "text"; status?: number; body: string; contentType?: string };

  export type CollectionHandler = (
    ctx: CollectionContext,
  ) => CollectionResult | Promise<CollectionResult>;

  export type CollectionRoute = {
    method: CollectionHttpMethod;
    path: string;
    handler: CollectionHandler;
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
  ): CollectionModuleDefinition;
}
