/** Canonical Open Index browse paths. Encode every id and label. */

export function fieldsPath(...ids: string[]): string {
  return `/fields/${ids.map(encodeURIComponent).join("/")}`;
}

export function keywordPath(keyword: string): string {
  return `/keywords/${encodeURIComponent(keyword)}`;
}

export function venuePath(id: string): string {
  return `/venues/${encodeURIComponent(id)}`;
}

export function venueTypePath(type: string): string {
  return `/venues/type/${encodeURIComponent(type)}`;
}

export function issnPath(issn: string): string {
  return `/issn/${encodeURIComponent(issn)}`;
}

export function publisherPath(id: string): string {
  return `/publishers/${encodeURIComponent(id)}`;
}

export function organizationPath(rorId: string): string {
  return `/organizations/${encodeURIComponent(rorId)}`;
}

export function organizationCountryPath(code: string): string {
  return `/organizations/country/${encodeURIComponent(code)}`;
}

export function subjectPath(subject: string): string {
  return `/subjects/${encodeURIComponent(subject)}`;
}

export function retractionPath(id: string): string {
  return `/retractions/${encodeURIComponent(id)}`;
}

export function retractionReasonPath(reason: string): string {
  return `/retractions/reasons/${encodeURIComponent(reason)}`;
}

export function searchPath(query: string): string {
  return `/search?q=${encodeURIComponent(query)}`;
}

export function workPath(doi: string): string {
  return `/works/${encodeURIComponent(doi)}`;
}

export function worksPartialPath(query: string): string {
  return `/partials/works?q=${encodeURIComponent(query)}`;
}

export function browsePagePath(path: string, after: string | null, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(extra);
  if (after) params.set("after", after);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
