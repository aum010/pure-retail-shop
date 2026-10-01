/**
 * Seeds the `products` table from `src/lib/catalogue.ts`.
 *
 * Re-runnable: every row is upserted, so re-seeding repairs drift without
 * touching orders. Run with `npm run db:seed`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { catalogue } from "../src/lib/catalogue.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

for (const name of [".env.local", ".env"]) {
  const file = path.join(projectRoot, name);
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

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");

const client = new Client({ connectionString });
await client.connect();
try {
  await client.query("BEGIN");
  for (const [index, product] of catalogue.entries()) {
    await client.query(
      `INSERT INTO products (
         id, name, price, original_price, description, image, category,
         in_stock, rating, reviews, sizes, colors, tags, sort_order
       ) VALUES (
         $1, $2, $3::numeric(12,2), $4::numeric(12,2), $5, $6, $7,
         $8, $9::numeric(2,1), $10, $11::text[], $12::text[], $13::text[], $14
       )
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         price = EXCLUDED.price,
         original_price = EXCLUDED.original_price,
         description = EXCLUDED.description,
         image = EXCLUDED.image,
         category = EXCLUDED.category,
         in_stock = EXCLUDED.in_stock,
         rating = EXCLUDED.rating,
         reviews = EXCLUDED.reviews,
         sizes = EXCLUDED.sizes,
         colors = EXCLUDED.colors,
         tags = EXCLUDED.tags,
         sort_order = EXCLUDED.sort_order`,
      [
        product.id,
        product.name,
        product.price.toFixed(2),
        product.originalPrice === undefined ? null : product.originalPrice.toFixed(2),
        product.description,
        product.image,
        product.category,
        product.inStock,
        product.rating.toFixed(1),
        product.reviews,
        product.sizes ?? [],
        product.colors ?? [],
        product.tags ?? [],
        index,
      ]
    );
  }
  await client.query("COMMIT");
  const { rows } = await client.query<{ n: string }>("SELECT COUNT(*) AS n FROM products");
  console.log(
    `[db:seed] seeded ${catalogue.length} catalogue rows (table now holds ${rows[0]?.n})`
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
