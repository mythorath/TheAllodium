import { applyD1Migrations, env } from "cloudflare:test";
import { resetAuthority } from "./authority-fixture";

if (!env.TEST_MIGRATIONS) {
  throw new Error("TEST_MIGRATIONS binding missing from vitest miniflare config");
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

if (!env.TEST_AUTHORITY_MIGRATIONS) {
  throw new Error("TEST_AUTHORITY_MIGRATIONS binding missing from vitest miniflare config");
}
if (!env.AUTHORITY) {
  throw new Error("AUTHORITY binding missing from vitest miniflare config");
}

await applyD1Migrations(env.AUTHORITY, env.TEST_AUTHORITY_MIGRATIONS);
await resetAuthority(env.AUTHORITY);

if (!env.TEST_COLLECTION_MIGRATIONS) {
  throw new Error("TEST_COLLECTION_MIGRATIONS binding missing from vitest miniflare config");
}
if (!env.COLLECTION_MINERALS) {
  throw new Error("COLLECTION_MINERALS binding missing from vitest miniflare config");
}
await applyD1Migrations(env.COLLECTION_MINERALS, env.TEST_COLLECTION_MIGRATIONS);
