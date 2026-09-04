import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { config } from "./load-env";
import { parseFlags, requireEnv } from "./cli";

config();

type Deposition = {
  id: number;
  links: {
    bucket: string;
    publish: string;
    html?: string;
  };
  doi?: string;
};

const METADATA_FILES = ["manifest.json", "licenses.json", "import.sql.sha256"] as const;

async function zenodoFetch(
  url: string,
  token: string,
  init: RequestInit,
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Zenodo ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  return response;
}

async function main(): Promise<void> {
  const { flags, booleans } = parseFlags(process.argv.slice(2));
  const directory = resolve(flags.directory ?? "exports/authority/latest");
  const apiOrigin = (flags.api ?? "https://zenodo.org").replace(/\/$/, "");
  for (const name of METADATA_FILES) {
    if (!existsSync(resolve(directory, name))) {
      throw new Error(`Missing authority metadata artifact: ${resolve(directory, name)}`);
    }
  }
  if (!booleans.has("yes")) {
    console.log(
      JSON.stringify({
        dry_run: true,
        api: apiOrigin,
        files: METADATA_FILES.map((name) => resolve(directory, name)),
        note: "Pass --yes with ZENODO_TOKEN to create and publish the metadata record.",
      }, null, 2),
    );
    return;
  }
  requireEnv(["ZENODO_TOKEN"]);
  const token = process.env.ZENODO_TOKEN as string;
  const manifest = JSON.parse(
    readFileSync(resolve(directory, "manifest.json"), "utf8"),
  ) as { snapshot_id?: string; snapshot_at?: string };
  const created = await zenodoFetch(
    `${apiOrigin}/api/deposit/depositions`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
  const deposition = (await created.json()) as Deposition;
  for (const name of METADATA_FILES) {
    const path = resolve(directory, name);
    await zenodoFetch(
      `${deposition.links.bucket}/${encodeURIComponent(basename(path))}`,
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: readFileSync(path),
      },
    );
  }
  await zenodoFetch(
    `${apiOrigin}/api/deposit/depositions/${deposition.id}`,
    token,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metadata: {
          title: `The Allodium authority snapshot ${manifest.snapshot_id ?? ""}`.trim(),
          upload_type: "dataset",
          description:
            "Versioned metadata authority tables used for transparent credibility signals in The Allodium Open Index. Families are licensed individually in licenses.json: OpenAlex, ROR, and DOAJ metadata are CC0 1.0; Retraction Watch via Crossref is CC BY 4.0; NLM Catalog journal data is included under NLM data terms with the required attribution “Courtesy of the U.S. National Library of Medicine” and is a dated snapshot that does not reflect the most current NLM data. The full D1 import is distributed through Cloudflare R2; this DOI record contains manifests, licenses, and checksums. Inclusion does not imply NLM endorsement.",
          creators: [{ name: "The Allodium" }],
          access_right: "open",
          license: "other-open",
          version: manifest.snapshot_id ?? manifest.snapshot_at ?? "unknown",
          keywords: ["scholarly metadata", "research index", "provenance"],
        },
      }),
    },
  );
  const published = await zenodoFetch(deposition.links.publish, token, {
    method: "POST",
  });
  const record = (await published.json()) as Deposition;
  console.log(
    JSON.stringify({
      id: record.id,
      doi: record.doi ?? null,
      url: record.links.html ?? null,
    }, null, 2),
  );
}

await main();
