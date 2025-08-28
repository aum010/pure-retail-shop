import { Product } from './store';
import leatherJacket from '@/assets/products/leather-jacket.jpg';
import cottonTshirt from '@/assets/products/cotton-tshirt.jpg';
import sunglasses from '@/assets/products/sunglasses.jpg';
import canvasSneakers from '@/assets/products/canvas-sneakers.jpg';
import silkScarf from '@/assets/products/silk-scarf.jpg';
import denimJacket from '@/assets/products/denim-jacket.jpg';

export const products: Product[] = [
  {
    id: '1',
    name: 'Premium Leather Jacket',
    price: 299.99,
    originalPrice: 399.99,
    description: 'Handcrafted genuine leather jacket with a modern fit. Features premium YKK zippers and soft cotton lining.',
    image: leatherJacket,
    category: 'Outerwear',
    inStock: true,
    rating: 4.8,
    reviews: 234,
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    colors: ['Black', 'Brown', 'Navy'],
    tags: ['bestseller', 'premium']
  },
  {
    id: '2',
    name: 'Organic Cotton T-Shirt',
    price: 39.99,
    description: 'Sustainable organic cotton t-shirt with a comfortable relaxed fit. Perfect for everyday wear.',
    image: cottonTshirt,
    category: 'Tops',
    inStock: true,
    rating: 4.6,
    reviews: 189,
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    colors: ['White', 'Black', 'Gray', 'Navy', 'Olive'],
    tags: ['sustainable', 'basics']
  },
  {
    id: '3',
    name: 'Designer Sunglasses',
    price: 159.99,
    originalPrice: 199.99,
    description: 'UV400 protection designer sunglasses with polarized lenses. Includes premium leather case.',
    image: sunglasses,
    category: 'Accessories',
    inStock: true,
    rating: 4.7,
    reviews: 98,
    tags: ['trending', 'summer']
  },
  {
    id: '4',
    name: 'Canvas Sneakers',
    price: 79.99,
    description: 'Classic canvas sneakers with vulcanized rubber sole. Timeless design meets modern comfort.',
    image: canvasSneakers,
    category: 'Footwear',
    inStock: true,
    rating: 4.5,
    reviews: 312,
    sizes: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45'],
    colors: ['White', 'Black', 'Red', 'Navy'],
    tags: ['classic', 'comfortable']
  },
  {
    id: '5',
    name: 'Silk Scarf',
    price: 89.99,
    description: 'Luxurious 100% silk scarf with hand-rolled edges. Features exclusive artistic prints.',
    image: silkScarf,
    category: 'Accessories',
    inStock: true,
    rating: 4.9,
    reviews: 67,
    colors: ['Floral', 'Geometric', 'Abstract'],
    tags: ['luxury', 'gift']
  },
  {
    id: '6',
    name: 'Denim Jacket',
    price: 129.99,
    description: 'Premium denim jacket with distressed details. A wardrobe essential with contemporary styling.',
    image: denimJacket,
    category: 'Outerwear',
    inStock: true,
    rating: 4.4,
    reviews: 145,
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    colors: ['Light Blue', 'Dark Blue', 'Black'],
    tags: ['casual', 'versatile']
  },
  {
    id: '7',
    name: 'Leather Wallet',
    price: 69.99,
    originalPrice: 89.99,
    description: 'Genuine leather bi-fold wallet with RFID protection. Multiple card slots and bill compartments.',
    image: silkScarf,
    category: 'Accessories',
    inStock: true,
    rating: 4.8,
    reviews: 203,
    colors: ['Black', 'Brown', 'Tan'],
    tags: ['practical', 'gift']
  },
  {
    id: '8',
    name: 'Wool Sweater',
    price: 149.99,
    description: 'Merino wool sweater with ribbed trim. Naturally temperature regulating and odor-resistant.',
    image: denimJacket,
    category: 'Knitwear',
    inStock: false,
    rating: 4.7,
    reviews: 89,
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['Cream', 'Navy', 'Forest Green', 'Burgundy'],
    tags: ['winter', 'cozy']
  },
  {
    id: '9',
    name: 'Sport Watch',
    price: 249.99,
    originalPrice: 349.99,
    description: 'Water-resistant sport watch with GPS tracking and heart rate monitor. 7-day battery life.',
    image: leatherJacket,
    category: 'Accessories',
    inStock: true,
    rating: 4.6,
    reviews: 421,
    colors: ['Black', 'Silver', 'Gold'],
    tags: ['tech', 'fitness']
  },
  {
    id: '10',
    name: 'Linen Pants',
    price: 99.99,
    description: 'Breathable linen pants with elastic waistband. Perfect for warm weather and casual elegance.',
    image: cottonTshirt,
    category: 'Bottoms',
    inStock: true,
    rating: 4.5,
    reviews: 156,
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    colors: ['Beige', 'White', 'Navy', 'Olive'],
    tags: ['summer', 'comfortable']
  },
  {
    id: '11',
    name: 'Crossbody Bag',
    price: 119.99,
    description: 'Versatile crossbody bag in vegan leather. Multiple compartments with adjustable strap.',
    image: sunglasses,
    category: 'Bags',
    inStock: true,
    rating: 4.7,
    reviews: 234,
    colors: ['Black', 'Tan', 'Burgundy', 'Navy'],
    tags: ['practical', 'vegan']
  },
  {
    id: '12',
    name: 'Cashmere Cardigan',
    price: 229.99,
    originalPrice: 299.99,
    description: 'Luxurious cashmere cardigan with pearl buttons. Incredibly soft and lightweight.',
    image: canvasSneakers,
    category: 'Knitwear',
    inStock: true,
    rating: 4.9,
    reviews: 78,
    sizes: ['XS', 'S', 'M', 'L'],
    colors: ['Cream', 'Gray', 'Blush', 'Black'],
    tags: ['luxury', 'elegant']
  }
];

export const categories = [
  'All',
  'Outerwear',
  'Tops',
  'Bottoms',
  'Knitwear',
  'Footwear',
  'Accessories',
  'Bags'
];

export const sortOptions = [
  { value: 'featured', label: 'Featured' },
  { value: 'price-asc', label: 'Price: Low to High' },
  { value: 'price-desc', label: 'Price: High to Low' },
  { value: 'rating', label: 'Highest Rated' },
  { value: 'newest', label: 'Newest First' }
];