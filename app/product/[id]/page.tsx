import { notFound } from "next/navigation";
import ProductDetail from "@/app/_pages/ProductDetail";
import { getProduct, getRelatedProducts } from "@/lib/db/products";

/** See `app/page.tsx`: prices are read live so the page cannot drift from checkout. */
export const dynamic = "force-dynamic";

/**
 * `/product/[id]`.
 *
 * `params` is a Promise on Next 15, so it is awaited before use. An unknown id
 * calls `notFound()` — the legacy page rendered a "Product not found" panel for
 * that, and the component still carries the same guard, but a 404 with the
 * right status is the correct answer for a URL that never existed.
 */
export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) notFound();

  const relatedProducts = await getRelatedProducts(product.category, product.id);
  return <ProductDetail product={product} relatedProducts={relatedProducts} />;
}