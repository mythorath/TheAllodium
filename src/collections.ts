export type CollectionIcon = "index" | "atom" | "orbit";

export type CollectionStatus = "live" | "planned";

export type CollectionNavLink = {
  href: string;
  label: string;
};

export type Collection = {
  slug: string;
  label: string;
  lede: string;
  status: CollectionStatus;
  icon: CollectionIcon;
  /** Collection-local primary nav (Search, Topics, …). Empty for planned collections. */
  nav: readonly CollectionNavLink[];
  /** When set, Layout renders the shortlist control pointed at this href. */
  shortlistHref?: string;
  /** When set, Layout renders the crisis/clinical advisory linking here. */
  advisoryPath?: string;
};

export type HomeDoor =
  | { kind: "curated"; collection: Collection }
  | {
      kind: "federated";
      slug: "open-index";
      label: string;
      lede: string;
      status: "live";
      icon: CollectionIcon;
      href: string;
    };

export const PSYCHOTHERAPY: Collection = {
  slug: "psychotherapy",
  label: "Psychotherapy",
  lede: "Research papers and client resources across therapeutic approaches.",
  status: "live",
  icon: "index",
  nav: [
    { href: "/psychotherapy/search", label: "Search" },
    { href: "/psychotherapy/topics", label: "Topics" },
    { href: "/psychotherapy/hexaflex", label: "Hexaflex" },
  ],
  shortlistHref: "/psychotherapy/list",
  advisoryPath: "/psychotherapy/disclaimer",
};

export const COLLECTIONS: readonly Collection[] = [
  PSYCHOTHERAPY,
];

export const HOME_DOORS: readonly HomeDoor[] = [
  {
    kind: "federated",
    slug: "open-index",
    label: "The Open Index",
    lede: "Federated research search across every field, with transparent credibility signals.",
    status: "live",
    icon: "orbit",
    href: "/open-index",
  },
  {
    kind: "curated",
    collection: PSYCHOTHERAPY,
  },
];

export function liveCollections(): Collection[] {
  return COLLECTIONS.filter((collection) => collection.status === "live");
}

/**
 * Returns the live collection whose slug prefixes `pathname`, or null for
 * site-wide routes (`/`, `/standard`) and unknown paths.
 */
export function collectionForPath(pathname: string): Collection | null {
  const path = pathname.split("?")[0] ?? pathname;
  for (const collection of COLLECTIONS) {
    if (collection.status !== "live") continue;
    const prefix = `/${collection.slug}`;
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return collection;
    }
  }
  return null;
}
