export type CoverageMode = "live" | "enrichment" | "harvest" | "unavailable";

export type CoverageSource = {
  id: string;
  label: string;
  mode: CoverageMode;
  scope: string;
  limitation: string | null;
  href: string;
};

export const COVERAGE_SOURCES: readonly CoverageSource[] = [
  {
    id: "crossref",
    label: "Crossref",
    mode: "live",
    scope: "DOI-registered journal articles, proceedings, books, chapters, and reports",
    limitation: "Metadata completeness is publisher-supplied and uneven.",
    href: "https://www.crossref.org/",
  },
  {
    id: "europe-pmc",
    label: "Europe PMC",
    mode: "live",
    scope: "Life-science literature and preprints",
    limitation: "Domain-specific; upstream availability can be intermittent.",
    href: "https://europepmc.org/",
  },
  {
    id: "datacite",
    label: "DataCite",
    mode: "live",
    scope: "Datasets, software, theses, preprints, and other research outputs",
    limitation: "Granular versions and files can resemble duplicate works.",
    href: "https://datacite.org/",
  },
  {
    id: "pubmed",
    label: "PubMed",
    mode: "live",
    scope: "Biomedical and life-science literature",
    limitation: "Domain-specific and rate-limited.",
    href: "https://pubmed.ncbi.nlm.nih.gov/",
  },
  {
    id: "doaj",
    label: "DOAJ",
    mode: "live",
    scope: "Open-access journals and articles across disciplines",
    limitation: "Only journals admitted to DOAJ are represented.",
    href: "https://doaj.org/",
  },
  {
    id: "zenodo",
    label: "Zenodo direct API",
    mode: "unavailable",
    scope: "Datasets, software, posters, reports, and publications",
    limitation:
      "The adapter is implemented, but staging proved the origin blocks or times out Cloudflare egress. Zenodo DOI records remain reachable through DataCite.",
    href: "https://zenodo.org/",
  },
  {
    id: "hal",
    label: "HAL",
    mode: "live",
    scope: "French and international repository deposits",
    limitation: "Repository coverage is strongest in France.",
    href: "https://hal.science/",
  },
  {
    id: "arxiv",
    label: "arXiv",
    mode: "live",
    scope: "Preprints in physics, mathematics, computer science, and adjacent fields",
    limitation: "Most records lack a version-of-record DOI.",
    href: "https://arxiv.org/",
  },
  {
    id: "openalex",
    label: "OpenAlex",
    mode: "enrichment",
    scope: "Cross-disciplinary venue, institution, publisher, and field authority data",
    limitation: "The live API is credit-limited; Allodium uses redistributable snapshots.",
    href: "https://openalex.org/",
  },
  {
    id: "ajol",
    label: "African Journals Online",
    mode: "harvest",
    scope: "African-published journals",
    limitation: "OAI-PMH supports scheduled harvesting, not live relevance search.",
    href: "https://www.ajol.info/",
  },
  {
    id: "la-referencia",
    label: "LA Referencia",
    mode: "harvest",
    scope: "Latin American repository output in Spanish and Portuguese",
    limitation: "OAI-PMH supports scheduled harvesting, not live relevance search.",
    href: "https://www.lareferencia.info/",
  },
  {
    id: "cnki",
    label: "CNKI and Wanfang",
    mode: "unavailable",
    scope: "Chinese-language scholarship",
    limitation: "No free, redistributable public search API is available.",
    href: "https://www.cnki.net/",
  },
  {
    id: "standards",
    label: "Standards organizations",
    mode: "unavailable",
    scope: "ISO, IEEE, ANSI, DIN, and related standards",
    limitation: "Metadata and documents are generally proprietary or paywalled.",
    href: "https://www.iso.org/standards.html",
  },
  {
    id: "repec",
    label: "RePEc",
    mode: "unavailable",
    scope: "Economics working papers",
    limitation: "No stable public JSON search API.",
    href: "https://repec.org/",
  },
  {
    id: "philpapers",
    label: "PhilPapers",
    mode: "unavailable",
    scope: "Philosophy literature",
    limitation: "No open API suitable for federated public search.",
    href: "https://philpapers.org/",
  },
] as const;

export function coverageByMode(mode: CoverageMode): CoverageSource[] {
  return COVERAGE_SOURCES.filter((source) => source.mode === mode);
}
