/**
 * Runs `drizzle/0000_init.sql` against the PostgreSQL named by DATABASE_URL.
 *
 * This is the Phase 2 "target foundation" step: the ledger table, its indexes
 * and the provider enum must exist before any route writes.
 *
 * Re-runnable by design (every statement in the migration is guarded), so a
 * partially applied run is safe to repeat. Run it with `npm run db:migrate`.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

/**
 * tsx does not load .env* on its own. Next.js loads .env.local for the app, but
 * these scripts run outside it, so the file is read explicitly. The legacy
 * `server/config.ts` did the same job with `dotenv/config` for the Express app.
 */
function loadLocalEnv(root: string) {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equals = trimmed.indexOf("=");
      if (equals <= 0) continue;
      const key = trimmed.slice(0, equals).trim();
      const value = trimmed.slice(equals + 1).trim();
      if (key && !(key in process.env)) process.env[key] = value;
    }
  }
}

loadLocalEnv(projectRoot);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");
if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
  throw new Error(
    "DATABASE_URL must be a postgres:// connection URL for this script. " +
      "The legacy SQLite ledger is handled by tools/migration instead."
  );
}

const migration = readFileSync(path.join(projectRoot, "drizzle", "0000_init.sql"), "utf8");

const client = new Client({ connectionString });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(migration);
  await client.query("COMMIT");
  console.log("[db:migrate] applied drizzle/0000_init.sql");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
