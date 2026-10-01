/**
 * Catalogue reads — the Server-Component side of Phase 3, slice 1.
 *
 * `src/lib/mockData.ts` was the entire backend for 12 products; these queries
 * replace it with PostgreSQL so that the price a shopper sees and the amount the
 * checkout validates come from the same row.
 *
 * Mapping notes:
 *   numeric(12,2)  -> number here, unlike the order store, because these values
 *                     are displayed rather than settled, and the storefront's
 *                     `formatNPR` takes a number.
 *   text[] columns -> `[]` in the database. Products without sizes must report
 *                     *no* sizes key at all: an empty array is truthy, so a
 *                     "no sizes" product would otherwise demand a size choice
 *                     before it could be added to the cart.
 */
import "server-only";

import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { products, type ProductRow } from "@/lib/db/schema";
import type { Product } from "@/lib/store";

function toNumber(value: string | number | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalNumber(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function toProduct(row: ProductRow): Product {
  const originalPrice = toOptionalNumber(row.originalPrice);
  const rating = toNumber(row.rating);
  const reviews = Math.trunc(toNumber(row.reviews));

  return {
    id: row.id,
    name: row.name,
    price: toNumber(row.price),
    ...(originalPrice === undefined ? {} : { originalPrice }),
    description: row.description,
    image: row.image,
    category: row.category,
    inStock: row.inStock,
    rating,
    reviews,
    ...(row.sizes.length ? { sizes: row.sizes } : {}),
    ...(row.colors.length ? { colors: row.colors } : {}),
    ...(row.tags.length ? { tags: row.tags } : {}),
  };
}

/** Full catalogue in the seed order (`sort_order`, which mirrors legacy ids). */
export async function listProducts(): Promise<Product[]> {
  const rows = await db
    .select()
    .from(products)
    .orderBy(asc(products.sortOrder), asc(products.id));
  return rows.map(toProduct);
}

export async function getProduct(id: string): Promise<Product | null> {
  const rows = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return rows[0] ? toProduct(rows[0]) : null;
}

/** Home page: the same four products the legacy `products.slice(0, 4)` showed. */
export async function getFeaturedProducts(limit = 4): Promise<Product[]> {
  const rows = await db
    .select()
    .from(products)
    .orderBy(asc(products.sortOrder))
    .limit(limit);
  return rows.map(toProduct);
}

/**
 * Related products on a product page: same category, excluding the product
 * itself. The legacy code filtered the full array; this does it in SQL.
 */
export async function getRelatedProducts(
  category: string,
  excludeId: string,
  limit = 4
): Promise<Product[]> {
  const rows = await db
    .select()
    .from(products)
    .where(sql`${products.category} = ${category} AND ${products.id} <> ${excludeId}`)
    .orderBy(asc(products.sortOrder))
    .limit(limit);
  return rows.map(toProduct);
}

/** Distinct categories present in the catalogue, in `sort_order` order. */
export async function listCategories(): Promise<string[]> {
  const rows = await db.selectDistinct({ category: products.category }).from(products);
  return rows.map((row) => row.category);
}

export async function listProductsByIds(ids: string[]): Promise<Product[]> {
  if (!ids.length) return [];
  const rows = await db.select().from(products).where(inArray(products.id, ids));
  return rows.map(toProduct);
}

/** Prices only — enough for the shop's price-range filter bounds. */
export async function priceBounds(): Promise<[number, number]> {
  const rows = await db
    .select({
      min: sql<string | null>`min(${products.price})`,
      max: sql<string | null>`max(${products.price})`,
    })
    .from(products);
  const min = toNumber(rows[0]?.min, 0);
  const max = Math.ceil(toNumber(rows[0]?.max, 0) / 1000) * 1000;
  return [0, max || 1000];
}
