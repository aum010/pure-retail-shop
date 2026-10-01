/**
 * Proves the PostgreSQL ledger is the ledger SQLite held.
 *
 * `export-orders.ts` writes a manifest per engine; this reads two of them and
 * answers one question with one exit code: *did every order survive the cutover
 * unchanged?* It is the gate for Phase 4 (production cutover) — if this fails,
 * the migration is not done, however healthy the new application looks.
 *
 *   npm run migration:compare -- migration-out/legacy.manifest.json migration-out/pg.manifest.json
 *   npm run migration:compare -- migration-out/legacy.manifest.json migration-out/pg.manifest.json --detail
 *
 * `--detail` additionally reads the sibling `<label>.ndjson` files and reports
 * *which field* differs on each changed row, which is what turns "hash mismatch"
 * into an actionable bug.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  CANONICAL_MANIFEST_VERSION,
  parseRowDump,
  toCanonicalOrder,
  type CanonicalOrder,
  type Manifest,
  type ManifestRow,
} from "./canonical-order.js";

const USAGE = `
Usage:
  tsx tools/migration/compare-manifests.ts <legacy.manifest.json> <target.manifest.json> [--detail]

  --detail   On a changed row, read the sibling .ndjson files and name the fields
             that differ. Slower, and only needed when something failed.
`;

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
    return;
  }
  failed += 1;
  console.log(`  FAIL  ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
}

/** Reads and shape-checks a manifest written by `export-orders.ts`. */
function readManifest(file: string): Manifest {
  if (!existsSync(file)) {
    throw new Error(`No manifest at ${file}. Run \`npm run migration:export\` for both engines first.`);
  }

  const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Manifest>;
  if (
    typeof parsed.rowCount !== "number" ||
    typeof parsed.checksum !== "string" ||
    !Array.isArray(parsed.rows) ||
    typeof parsed.source !== "string"
  ) {
    throw new Error(`${file} is not a migration manifest (needs source, rowCount, checksum, rows).`);
  }
  return parsed as Manifest;
}

/** `<dir>/<label>.manifest.json` → `<dir>/<label>.ndjson`, when it exists. */
function siblingNdjson(manifestFile: string): string | undefined {
  const candidate = manifestFile.replace(/\.manifest\.json$/i, ".ndjson");
  return candidate !== manifestFile && existsSync(candidate) ? candidate : undefined;
}

function loadCanonical(file: string): Map<string, CanonicalOrder> {
  const rows = parseRowDump(readFileSync(file, "utf8"));
  return new Map(rows.map((row) => toCanonicalOrder(row)).map((order) => [order.orderId, order]));
}

/** Field-by-field differences between two canonical records. */
function fieldDiff(left: CanonicalOrder, right: CanonicalOrder): string[] {
  const differences: string[] = [];
  for (const key of Object.keys(left) as (keyof CanonicalOrder)[]) {
    if (left[key] !== right[key]) {
      differences.push(`${key}: ${JSON.stringify(left[key])} → ${JSON.stringify(right[key])}`);
    }
  }
  return differences;
}

interface RowDiff {
  missing: string[];
  extra: string[];
  changed: string[];
}

function diffRows(left: ManifestRow[], right: ManifestRow[]): RowDiff {
  const rightById = new Map(right.map((row) => [row.orderId, row.hash]));
  const leftIds = new Set(left.map((row) => row.orderId));

  const missing: string[] = [];
  const changed: string[] = [];

  for (const row of left) {
    const hash = rightById.get(row.orderId);
    if (hash === undefined) missing.push(row.orderId);
    else if (hash !== row.hash) changed.push(row.orderId);
  }

  const extra = right.filter((row) => !leftIds.has(row.orderId)).map((row) => row.orderId);
  return { missing, extra, changed };
}

function sameCounts(left: Record<string, number>, right: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if ((left[key] ?? 0) !== (right[key] ?? 0)) return false;
  }
  return true;
}

/** Names the fields that differ on each changed row, straight from the dumps. */
function printFieldDiff(leftFile: string, rightFile: string, changed: string[], limit = 10) {
  const leftNdjson = siblingNdjson(leftFile);
  const rightNdjson = siblingNdjson(rightFile);

  if (!leftNdjson || !rightNdjson) {
    console.log(`\n  (--detail needs both .ndjson files next to their manifests; keeping them is worth it.)`);
    return;
  }

  const left = loadCanonical(leftNdjson);
  const right = loadCanonical(rightNdjson);

  console.log(`\n--- Field-level differences (first ${Math.min(limit, changed.length)}) ---\n`);
  for (const orderId of changed.slice(0, limit)) {
    const before = left.get(orderId);
    const after = right.get(orderId);
    if (!before || !after) continue;
    console.log(`  ${orderId}`);
    for (const difference of fieldDiff(before, after)) console.log(`      ${difference}`);
    console.log("");
  }
  if (changed.length > limit) console.log(`  … ${changed.length - limit} more changed rows\n`);
}

function main() {
  const argv = process.argv.slice(2);
  const detail = argv.includes("--detail");
  const files = argv.filter((argument) => !argument.startsWith("--"));

  if (files.length !== 2) {
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  const legacyFile = path.resolve(process.cwd(), files[0]);
  const targetFile = path.resolve(process.cwd(), files[1]);
  const legacy = readManifest(legacyFile);
  const target = readManifest(targetFile);

  console.log(`\n=== Ledger parity ===\n`);
  console.log(`  legacy   ${legacy.source}`);
  console.log(`           ${legacy.rowCount} rows   ${legacy.checksum.slice(0, 16)}…`);
  console.log(`  target   ${target.source}`);
  console.log(`           ${target.rowCount} rows   ${target.checksum.slice(0, 16)}…`);
  console.log("");

  const { missing, extra, changed } = diffRows(legacy.rows, target.rows);
  const identical = legacy.rowCount - missing.length - changed.length;

  check(
    "both manifests use the same canonical version",
    legacy.version === target.version && legacy.version === CANONICAL_MANIFEST_VERSION,
    { legacy: legacy.version, target: target.version, expected: CANONICAL_MANIFEST_VERSION }
  );
  check(`row count survived the cutover (${legacy.rowCount} → ${target.rowCount})`, legacy.rowCount === target.rowCount, {
    legacy: legacy.rowCount,
    target: target.rowCount,
  });
  check("aggregate checksum is identical", legacy.checksum === target.checksum, {
    legacy: legacy.checksum,
    target: target.checksum,
  });
  check(
    `completed orders are identical (${legacy.completedCount})`,
    legacy.completedCount === target.completedCount,
    { legacy: legacy.completedCount, target: target.completedCount }
  );
  check(
    `orders sorted by provider are identical`,
    sameCounts(legacy.countsByProvider, target.countsByProvider),
    { legacy: legacy.countsByProvider, target: target.countsByProvider }
  );
  check(
    `ordered total is identical (NPR ${legacy.totalOrderedAmount})`,
    legacy.totalOrderedAmount === target.totalOrderedAmount,
    { legacy: legacy.totalOrderedAmount, target: target.totalOrderedAmount }
  );
  check(
    `settled total is identical (NPR ${legacy.totalSettledAmount})`,
    legacy.totalSettledAmount === target.totalSettledAmount,
    { legacy: legacy.totalSettledAmount, target: target.totalSettledAmount }
  );
  check(
    `every order id survived (${legacy.rowCount - missing.length} of ${legacy.rowCount})`,
    missing.length === 0,
    missing.slice(0, 5)
  );
  check("the target holds no orders the legacy ledger did not", extra.length === 0, extra.slice(0, 5));
  check(
    `every row present in both ledgers is byte-identical (${identical} of ${legacy.rowCount})`,
    changed.length === 0,
    changed.slice(0, 5)
  );

  if (detail && changed.length) printFieldDiff(legacyFile, targetFile, changed);

  console.log(`\n${passed} passed, ${failed} failed\n`);

  if (failed) {
    console.log("Before treating this as data loss, check these three causes, in order:\n");
    console.log("  1. A missing row is usually the 2h sweep, not a broken copy.");
    console.log("     `server/orderStore.ts` deletes orders older than two hours on every read");
    console.log("     and write, so a row can vanish between the two exports. Re-export both");
    console.log("     sides inside the freeze window and compare again.");
    console.log("  2. A changed `amount` is REAL → numeric: a value that was never at 2 decimal");
    console.log("     places in SQLite. Compare with --detail and decide which side is right.");
    console.log("  3. A changed `createdAt`/`completedAt` is epoch milliseconds → timestamptz:");
    console.log("     a unit or timezone mistake in the import. --detail names it exactly.\n");
  }

  process.exitCode = failed === 0 ? 0 : 1;
}

try {
  main();
} catch (error) {
  console.error(`\n[compare] ${(error as Error).message}\n`);
  process.exitCode = 1;
}
