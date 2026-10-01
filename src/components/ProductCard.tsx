"use client";

import Link from 'next/link';
import { Heart, ShoppingBag, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Product } from '@/lib/store';
import { useStore } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { formatNPR } from '@/lib/currency';

interface ProductCardProps {
  product: Product;
}

const ProductCard = ({ product }: ProductCardProps) => {
  const { toast } = useToast();
  const addToCart = useStore((state) => state.addToCart);
  const addToWishlist = useStore((state) => state.addToWishlist);
  const removeFromWishlist = useStore((state) => state.removeFromWishlist);
  const isInWishlist = useStore((state) => state.isInWishlist);
  const inWishlist = isInWishlist(product.id);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    addToCart(product);
    toast({
      title: "Added to cart",
      description: `${product.name} has been added to your cart.`,
    });
  };

  const handleWishlistToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    if (inWishlist) {
      removeFromWishlist(product.id);
      toast({
        title: "Removed from wishlist",
        description: `${product.name} has been removed from your wishlist.`,
      });
    } else {
      addToWishlist(product);
      toast({
        title: "Added to wishlist",
        description: `${product.name} has been added to your wishlist.`,
      });
    }
  };

  return (
    <Link href={`/product/${product.id}`} className="group">
      <div className="card-hover bg-card rounded-lg overflow-hidden">
        <div className="relative aspect-[3/4] bg-muted">
          <img
            src={product.image}
            alt={product.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.src = '/placeholder.svg';
            }}
          />
          
          {/* Badges */}
          {product.tags && (
            <div className="absolute top-2 left-2 space-y-1">
              {product.tags.includes('bestseller') && (
                <Badge className="bg-accent text-accent-foreground">Bestseller</Badge>
              )}
              {product.originalPrice && (
                <Badge variant="destructive">
                  -{Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)}%
                </Badge>
              )}
              {!product.inStock && (
                <Badge variant="secondary">Out of Stock</Badge>
              )}
            </div>
          )}
          
          {/* Quick Actions */}
          <div className="absolute top-2 right-2 space-y-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              size="icon"
              variant="secondary"
              className="h-8 w-8 bg-background/90 backdrop-blur-sm"
              onClick={handleWishlistToggle}
            >
              <Heart className={cn("h-4 w-4", inWishlist && "fill-current text-accent")} />
            </Button>
            {product.inStock && (
              <Button
                size="icon"
                variant="secondary"
                className="h-8 w-8 bg-background/90 backdrop-blur-sm"
                onClick={handleAddToCart}
              >
                <ShoppingBag className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        
        <div className="p-4">
          <h3 className="font-medium text-sm mb-1 line-clamp-1">{product.name}</h3>
          <p className="text-xs text-muted-foreground mb-2">{product.category}</p>
          
          {/* Rating */}
          {product.rating && (
            <div className="flex items-center gap-1 mb-2">
              <Star className="h-3 w-3 fill-current text-warning" />
              <span className="text-xs text-muted-foreground">
                {product.rating} ({product.reviews})
              </span>
            </div>
          )}
          
          {/* Price */}
          <div className="flex items-center gap-2">
            <span className="font-semibold">{formatNPR(product.price)}</span>
            {product.originalPrice && (
              <span className="text-sm text-muted-foreground line-through">
                {formatNPR(product.originalPrice)}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
};

export default ProductCard;