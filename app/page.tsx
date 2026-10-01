import Home from "@/app/_pages/Home";
import { getFeaturedProducts } from "@/lib/db/products";

/**
 * `/` — a Server Component reads the featured four from PostgreSQL and hands
 * them to the presentational page, which stays a Client Component for its
 * product cards. The legacy `products.slice(0, 4)` is now `getFeaturedProducts(4)`.
 */

/**
 * Rendered per request, not baked at build.
 *
 * The storefront's prices are the checkout's prices: checkout re-validates every
 * line against the database, so an HTML snapshot taken when `npm run build`
 * happened to run would advertise amounts the server then refuses. Live reads
 * cost a query and make that mismatch impossible.
 */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const featuredProducts = await getFeaturedProducts();
  return <Home featuredProducts={featuredProducts} />;
}