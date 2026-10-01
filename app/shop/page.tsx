import Shop from "@/app/_pages/Shop";
import { listProducts } from "@/lib/db/products";

/** See `app/page.tsx`: prices are read live so the grid cannot drift from checkout. */
export const dynamic = "force-dynamic";

/**
 * `/shop` — the filtering, sorting and price slider all stay client-side; only
 * the source of the product list moved, from the static mockData array to a
 * query, so what a shopper browses matches what checkout will validate.
 */
export default async function ShopPage() {
  const products = await listProducts();
  return <Shop products={products} />;
}