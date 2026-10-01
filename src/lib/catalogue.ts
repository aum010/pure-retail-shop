/**
 * The catalogue — the 12 products that used to live in `src/lib/mockData.ts`,
 * rewritten as plain data so the same list can be seeded into PostgreSQL
 * (`scripts/db-seed-products.ts`) and rendered by Server Components.
 *
 * The one change from the legacy file: `image` is now a `public/` path instead
 * of a bundler-resolved asset import. Next.js resolves `/products/x.jpg` from
 * `public/products/`, which means the seed script can run outside the bundler
 * and the same string is stored in the database.
 *
 * `src/lib/store.ts` keeps the `Product` interface, so the Zustand cart and
 * every existing component accept these rows unchanged.
 */
import type { Product } from "./store";

const P = (file: string) => `/products/${file}`;

export const catalogue: Product[] = [
  {
    id: "1",
    name: "Premium Leather Jacket",
    price: 12500,
    originalPrice: 15000,
    description:
      "Handcrafted genuine leather jacket with a modern fit. Features premium YKK zippers and soft cotton lining.",
    image: P("leather-jacket.jpg"),
    category: "Outerwear",
    inStock: true,
    rating: 4.8,
    reviews: 234,
    sizes: ["XS", "S", "M", "L", "XL"],
    colors: ["Black", "Brown", "Navy"],
    tags: ["bestseller", "premium"],
  },
  {
    id: "2",
    name: "Organic Cotton T-Shirt",
    price: 1250,
    description:
      "Sustainable organic cotton t-shirt with a comfortable relaxed fit. Perfect for everyday wear.",
    image: P("cotton-tshirt.jpg"),
    category: "Tops",
    inStock: true,
    rating: 4.6,
    reviews: 189,
    sizes: ["XS", "S", "M", "L", "XL", "XXL"],
    colors: ["White", "Black", "Gray", "Navy", "Olive"],
    tags: ["sustainable", "basics"],
  },
  {
    id: "3",
    name: "Designer Sunglasses",
    price: 4500,
    originalPrice: 5500,
    description:
      "UV400 protection designer sunglasses with polarized lenses. Includes premium leather case.",
    image: P("sunglasses.jpg"),
    category: "Accessories",
    inStock: true,
    rating: 4.7,
    reviews: 98,
    tags: ["trending", "summer"],
  },
  {
    id: "4",
    name: "Canvas Sneakers",
    price: 3200,
    description:
      "Classic canvas shoes with vulcanized rubber sole. Timeless design meets modern comfort.",
    image: P("canvas-sneakers.jpg"),
    category: "Footwear",
    inStock: true,
    rating: 4.5,
    reviews: 312,
    sizes: ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45"],
    colors: ["White", "Black", "Red", "Navy"],
    tags: ["classic", "comfortable"],
  },
  {
    id: "5",
    name: "Silk Scarf",
    price: 2800,
    description:
      "Luxurious 100% silk scarf with hand-rolled edges. Features exclusive artistic prints.",
    image: P("silk-scarf.jpg"),
    category: "Accessories",
    inStock: true,
    rating: 4.9,
    reviews: 67,
    colors: ["Floral", "Geometric", "Abstract"],
    tags: ["luxury", "gift"],
  },
  {
    id: "6",
    name: "Denim Jacket",
    price: 5900,
    description:
      "Premium denim jacket with distressed details. A wardrobe essential with contemporary styling.",
    image: P("denim-jacket.jpg"),
    category: "Outerwear",
    inStock: true,
    rating: 4.4,
    reviews: 145,
    sizes: ["XS", "S", "M", "L", "XL"],
    colors: ["Light Blue", "Dark Blue", "Black"],
    tags: ["casual", "versatile"],
  },
  {
    id: "7",
    name: "Leather Wallet",
    price: 2400,
    originalPrice: 3200,
    description:
      "Genuine leather bi-fold wallet with RFID protection. Multiple card slots and bill compartments.",
    image: P("silk-scarf.jpg"),
    category: "Accessories",
    inStock: true,
    rating: 4.8,
    reviews: 203,
    colors: ["Black", "Brown", "Tan"],
    tags: ["practical", "gift"],
  },
  {
    id: "8",
    name: "Wool Sweater",
    price: 6500,
    description:
      "Merino wool sweater with ribbed trim. Naturally temperature regulating and odor-resistant.",
    image: P("denim-jacket.jpg"),
    category: "Knitwear",
    inStock: false,
    rating: 4.7,
    reviews: 89,
    sizes: ["S", "M", "L", "XL"],
    colors: ["Cream", "Navy", "Forest Green", "Burgundy"],
    tags: ["winter", "cozy"],
  },
  {
    id: "9",
    name: "Sport Watch",
    price: 12900,
    originalPrice: 16500,
    description:
      "Water-resistant sport watch with GPS tracking and heart rate monitor. 7-day battery life.",
    image: P("leather-jacket.jpg"),
    category: "Accessories",
    inStock: true,
    rating: 4.6,
    reviews: 421,
    colors: ["Black", "Silver", "Gold"],
    tags: ["tech", "fitness"],
  },
  {
    id: "10",
    name: "Linen Pants",
    price: 3900,
    description:
      "Breathable linen pants with elastic waistband. Perfect for warm weather and casual elegance.",
    image: P("cotton-tshirt.jpg"),
    category: "Bottoms",
    inStock: true,
    rating: 4.5,
    reviews: 156,
    sizes: ["XS", "S", "M", "L", "XL"],
    colors: ["Beige", "White", "Navy", "Olive"],
    tags: ["summer", "comfortable"],
  },
  {
    id: "11",
    name: "Crossbody Bag",
    price: 4900,
    description:
      "Versatile crossbody bag in vegan leather. Multiple compartments with adjustable strap.",
    image: P("sunglasses.jpg"),
    category: "Bags",
    inStock: true,
    rating: 4.7,
    reviews: 234,
    colors: ["Black", "Tan", "Burgundy", "Navy"],
    tags: ["practical", "vegan"],
  },
  {
    id: "12",
    name: "Cashmere Cardigan",
    price: 11500,
    originalPrice: 14500,
    description:
      "Luxurious cashmere cardigan with pearl buttons. Incredibly soft and lightweight.",
    image: P("canvas-sneakers.jpg"),
    category: "Knitwear",
    inStock: true,
    rating: 4.9,
    reviews: 78,
    sizes: ["S", "M", "L"],
    colors: ["Cream", "Gray", "Blush", "Black"],
    tags: ["luxury", "elegant"],
  },
];

/** Alias kept for the component names the legacy pages already use. */
export const products = catalogue;

export const categories = [
  "All",
  "Outerwear",
  "Tops",
  "Bottoms",
  "Knitwear",
  "Footwear",
  "Accessories",
  "Bags",
];

export const sortOptions = [
  { value: "featured", label: "Featured" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
  { value: "rating", label: "Highest Rated" },
  { value: "newest", label: "Newest First" },
];

