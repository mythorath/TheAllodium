import { collectionBindingName } from "./contract-v2";
import { assertCollectionSlug } from "./slugs";

export type CollectionJson = {
  slug: string;
  label: string;
  lede: string;
  icon: "index" | "atom" | "orbit";
  facetCategories: string[];
  nav: Array<{ path: string; label: string }>;
  shortlistPath?: string | null;
  advisoryPath?: string | null;
  moduleContract: "1";
};

export function parseCollectionJson(raw: unknown): CollectionJson {
  if (!raw || typeof raw !== "object") {
    throw new Error("collection.json must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (value.moduleContract !== "1") {
    throw new Error('collection.json moduleContract must be "1"');
  }
  if (typeof value.slug !== "string") throw new Error("collection.json slug is required");
  assertCollectionSlug(value.slug);
  if (typeof value.label !== "string" || value.label.length < 1 || value.label.length > 80) {
    throw new Error("collection.json label must be 1–80 characters");
  }
  if (typeof value.lede !== "string" || value.lede.length < 1 || value.lede.length > 280) {
    throw new Error("collection.json lede must be 1–280 characters");
  }
  if (value.icon !== "index" && value.icon !== "atom" && value.icon !== "orbit") {
    throw new Error("collection.json icon must be index, atom, or orbit");
  }
  if (!Array.isArray(value.facetCategories) || value.facetCategories.length < 1) {
    throw new Error("collection.json facetCategories must be a non-empty array");
  }
  const facetCategories = value.facetCategories.map((item) => {
    if (typeof item !== "string" || !/^[a-z][a-z0-9_]{0,31}$/.test(item)) {
      throw new Error(`Invalid facet category: ${String(item)}`);
    }
    return item;
  });
  const nav = Array.isArray(value.nav)
    ? value.nav.map((item) => {
        if (!item || typeof item !== "object") {
          throw new Error("collection.json nav entries must be objects");
        }
        const link = item as Record<string, unknown>;
        if (typeof link.path !== "string" || typeof link.label !== "string") {
          throw new Error("collection.json nav entries need path and label");
        }
        return { path: link.path, label: link.label };
      })
    : [];
  return {
    slug: value.slug,
    label: value.label,
    lede: value.lede,
    icon: value.icon,
    facetCategories,
    nav,
    shortlistPath:
      value.shortlistPath === undefined ? null : (value.shortlistPath as string | null),
    advisoryPath:
      value.advisoryPath === undefined ? null : (value.advisoryPath as string | null),
    moduleContract: "1",
  };
}

export function derivedBinding(slug: string): string {
  return collectionBindingName(slug);
}
