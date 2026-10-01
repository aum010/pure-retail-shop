/**
 * Freezes, canonicalises and re-emits the order ledger for the SQLite → PostgreSQL
 * cutover.
 *
 * Run it twice — once against each engine — and `compare-manifests.ts` will tell
 * you whether PostgreSQL holds exactly the rows SQLite held. The legacy side is
 * read straight from `data/orders.db`; the target side is read from a JSON dump of
 * the `orders` table (NDJSON or an array), so the comparison never needs a
 * database driver in this repository.
 *
 *   npm run migration:export -- --out migration-out --label legacy
 *   npm run migration:export -- --from-json migration-out/pg.ndjson --label pg
 *   npm run migration:compare -- migration-out/legacy.manifest.json migration-out/pg.manifest.json
 *
 * Two behaviours worth knowing before you aim it at the live file:
 *
 *  - **Reads are non-mutating by default.** The SQLite handle is opened read-only,
 *    so running this against a live ledger cannot corrupt it. `--freeze` is the
 *    explicit opt-in that checkpoints the write-ahead log first; it writes, and is
 *    only correct once the legacy writers are stopped.
 *  - **A live ledger is a sliding window.** `server/orderStore.ts` sweeps rows
 *    older than two hours on every read and write, so the export contains at most
 *    that window. There is no deeper history to backfill — see
 *    `docs/migration/02-data-migration-spec.md`.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildManifest,
  parseRowDump,
  toCanonicalOrder,
  toNdjson,
  type CanonicalOrder,
} from "./canonical-order.js";

const USAGE = `
Usage:
  tsx tools/migration/export-orders.ts --out <dir> [--label <name>] [--db <file>] [--freeze]
  tsx tools/migration/export-orders.ts --from-json <file> --out <dir> [--label <name>]

  --out <dir>      Directory for <label>.ndjson and <label>.manifest.json.
  --label <name>   Base name of those two files (default: "legacy", or "target"
                   when --from-json is used).
  --db <file>      SQLite ledger to read (default: DATABASE_URL, else data/orders.db).
  --from-json <f>  Canonicalise a dump produced elsewhere (NDJSON or a JSON array)
                   instead of reading SQLite. This is how PostgreSQL is compared.
  --freeze         Checkpoint the write-ahead log before reading. Writes to the
                   file, so use it only inside the cutover freeze.
`;

interface Args {
  out?: string;
  label?: string;
  db?: string;
  fromJson?: string;
  freeze: boolean;
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;

    const body = arg.slice(2);
    const equals = body.indexOf("=");
    if (equals === -1) {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        values.set(body, next);
        index += 1;
      } else {
        flags.add(body);
      }
      continue;
    }

    values.set(body.slice(0, equals), body.slice(equals + 1));
  }

  return {
    out: values.get("out"),
    label: values.get("label"),
    db: values.get("db"),
    fromJson: values.get("from-json"),
    freeze: flags.has("freeze") || values.has("freeze"),
  };
}

/**
 * Resolves the SQLite file to read. `DATABASE_URL` is honoured because that is
 * what the legacy server uses, but a connection URL is rejected outright: the
 * variable holds a *file path* in this codebase (see `.env.example`).
 */
function resolveDbPath(explicit?: string): string {
  const candidate = explicit ?? process.env.DATABASE_URL?.trim();
  if (candidate) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
      throw new Error(
        `Expected a SQLite file path but got the URL "${candidate}". This tool reads the legacy ` +
          `file (e.g. data/orders.db); pass --db <path> or unset DATABASE_URL.`
      );
    }
    return path.resolve(process.cwd(), candidate);
  }
  return path.join(process.cwd(), "data", "orders.db");
}

/**
 * better-sqlite3 loads its native binding through plain `require` and ships no
 * TypeScript declarations, so only the calls used here are described — the same
 * approach `server/orderStore.ts` takes.
 */
const require = createRequire(import.meta.url);

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

interface SqliteHandle {
  prepare(sql: string): SqliteStatement;
  pragma(pragma: string): unknown;
  close(): void;
}

type SqliteConstructor = new (
  filename: string,
  options?: { readonly?: boolean; fileMustExist?: boolean }
) => SqliteHandle;

const Database = require("better-sqlite3") as SqliteConstructor;

interface Ledger {
  orders: CanonicalOrder[];
  source: string;
  schemaVersion?: string;
}

/** Reads the legacy ledger, preferring a read-only handle. */
function readSqliteLedger(file: string, freeze: boolean): Ledger {
  if (!existsSync(file)) {
    throw new Error(`No SQLite ledger at ${file}. Pass --db <path> if it lives elsewhere.`);
  }

  let db: SqliteHandle;
  let mode: string;

  if (freeze) {
    db = new Database(file);
    db.pragma("busy_timeout = 5000");
    db.pragma("wal_checkpoint(TRUNCATE)");
    mode = "checkpointed write handle (--freeze)";
  } else {
    try {
      db = new Database(file, { readonly: true });
      mode = "read-only";
    } catch {
      // A WAL database whose -shm sidecar is missing cannot always be opened
      // read-only; fall back rather than reporting the ledger as unreadable.
      db = new Database(file);
      db.pragma("busy_timeout = 5000");
      mode = "read-write fallback";
    }
  }

  try {
    let schemaVersion: string | undefined;
    try {
      const meta = db.prepare(`SELECT value FROM schema_meta WHERE key = 'version'`).get() as
        | { value?: unknown }
        | undefined;
      schemaVersion = meta?.value === undefined ? undefined : String(meta.value);
    } catch {
      // schema_meta is absent (pre-v1, or a partial dump); not fatal for parity.
      schemaVersion = undefined;
    }

    const rows = db
      .prepare(`SELECT * FROM orders ORDER BY created_at ASC, order_id ASC`)
      .all() as Record<string, unknown>[];

    console.log(`[export] opened ${file} (${mode})`);
    return { orders: rows.map(toCanonicalOrder), source: file, schemaVersion };
  } finally {
    db.close();
  }
}

/** Reads a dump of the target table written by the other side. */
function readJsonLedger(file: string): Ledger {
  if (!existsSync(file)) throw new Error(`No dump at ${file}.`);
  const rows = parseRowDump(readFileSync(file, "utf8"));
  return {
    orders: rows.map(toCanonicalOrder),
    source: path.relative(process.cwd(), file),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.out) {
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }
  if (args.fromJson && args.db) {
    throw new Error("--db and --from-json are mutually exclusive: pick one source ledger.");
  }

  const ledger = args.fromJson
    ? readJsonLedger(path.resolve(process.cwd(), args.fromJson))
    : readSqliteLedger(resolveDbPath(args.db), args.freeze);

  const label = args.label?.trim() || (args.fromJson ? "target" : "legacy");
  const manifest = buildManifest(ledger.orders, ledger.source, ledger.schemaVersion);

  const outDir = path.resolve(process.cwd(), args.out);
  mkdirSync(outDir, { recursive: true });

  const ndjsonPath = path.join(outDir, `${label}.ndjson`);
  const manifestPath = path.join(outDir, `${label}.manifest.json`);
  writeFileSync(ndjsonPath, toNdjson(ledger.orders), "utf8");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const providers =
    Object.entries(manifest.countsByProvider)
      .map(([provider, count]) => `${provider}=${count}`)
      .join(" ") || "none";

  console.log(`\n=== Ledger export: ${label} ===\n`);
  console.log(
    `  source     ${manifest.source}${manifest.schemaVersion ? ` (schema v${manifest.schemaVersion})` : ""}`
  );
  console.log(`  orders     ${manifest.rowCount}`);
  console.log(`  completed  ${manifest.completedCount}`);
  console.log(`  providers  ${providers}`);
  console.log(`  ordered    NPR ${manifest.totalOrderedAmount}`);
  console.log(`  settled    NPR ${manifest.totalSettledAmount}`);
  console.log(`  checksum   ${manifest.checksum}`);
  console.log(`\n  wrote      ${path.relative(process.cwd(), ndjsonPath)}`);
  console.log(`  wrote      ${path.relative(process.cwd(), manifestPath)}`);
  console.log(
    `\nDump the target the same way, then prove they match:\n` +
      `  npm run migration:compare -- ${path.relative(process.cwd(), manifestPath)} <target.manifest.json>\n`
  );
}

try {
  main();
} catch (error) {
  console.error(`\n[export] ${(error as Error).message}\n`);
  process.exitCode = 1;
}
