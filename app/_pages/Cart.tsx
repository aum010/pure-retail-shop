"use client";

import Link from 'next/link';
import { Trash2, Plus, Minus, ShoppingBag, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useStore } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import { calculateTotals, formatNPR } from '@/lib/currency';

const Cart = () => {
  const { toast } = useToast();
  const cart = useStore((state) => state.cart);
  const removeFromCart = useStore((state) => state.removeFromCart);
  const updateQuantity = useStore((state) => state.updateQuantity);
  const getCartTotal = useStore((state) => state.getCartTotal);
  const clearCart = useStore((state) => state.clearCart);

  const { subtotal, shipping, tax, total, freeShippingGap } = calculateTotals(getCartTotal());

  const handleRemove = (productId: string, productName: string) => {
    removeFromCart(productId);
    toast({
      title: "Removed from cart",
      description: `${productName} has been removed from your cart.`,
    });
  };

  if (cart.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <ShoppingBag className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-2xl font-serif mb-4">Your cart is empty</h2>
          <p className="text-muted-foreground mb-6">
            Looks like you haven't added anything to your cart yet.
          </p>
          <Link href="/shop">
            <Button size="lg" variant="accent">
              Continue Shopping
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8">
      <div className="container-custom">
        <h1 className="text-4xl font-serif mb-8">Shopping Cart</h1>
        
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Cart Items */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex justify-between items-center mb-4">
              <p className="text-muted-foreground">{cart.length} items</p>
              <Button variant="ghost" size="sm" onClick={clearCart}>
                Clear Cart
              </Button>
            </div>
            
            {cart.map((item) => (
              <Card key={`${item.id}-${item.selectedSize}-${item.selectedColor}`} className="p-6">
                <div className="flex gap-4">
                  <div className="w-24 h-24 bg-muted rounded-md overflow-hidden flex-shrink-0">
                    <img
                      src={item.image}
                      alt={item.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.src = '/placeholder.svg';
                      }}
                    />
                  </div>
                  
                  <div className="flex-1">
                    <div className="flex justify-between">
                      <div>
                        <h3 className="font-medium">{item.name}</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          {item.category}
                          {item.selectedSize && ` • Size: ${item.selectedSize}`}
                          {item.selectedColor && ` • Color: ${item.selectedColor}`}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemove(item.id, item.name)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    
                    <div className="flex items-center justify-between mt-4">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-12 text-center">{item.quantity}</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      
                      <div className="text-right">
                        <p className="font-semibold">{formatNPR(item.price * item.quantity)}</p>
                        {item.quantity > 1 && (
                          <p className="text-xs text-muted-foreground">
                            {formatNPR(item.price)} each
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
            
            <Link href="/shop">
              <Button variant="outline" className="mt-4">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Continue Shopping
              </Button>
            </Link>
          </div>
          
          {/* Order Summary */}
          <div>
            <Card className="p-6 sticky top-20">
              <h2 className="text-xl font-semibold mb-4">Order Summary</h2>
              
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{formatNPR(subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Shipping</span>
                  <span>{shipping === 0 ? 'FREE' : formatNPR(shipping)}</span>
                </div>
                <div className="flex justify-between">
                  <span>VAT (13%)</span>
                  <span>{formatNPR(tax)}</span>
                </div>
                
                <Separator />
                
                <div className="flex justify-between font-semibold text-lg">
                  <span>Total</span>
                  <span>{formatNPR(total)}</span>
                </div>
              </div>
              
              {freeShippingGap > 0 && (
                <p className="text-sm text-muted-foreground mt-4">
                  Add {formatNPR(freeShippingGap)} more for free delivery
                </p>
              )}
              
              <Link href="/checkout">
                <Button size="lg" className="w-full mt-6" variant="accent">
                  Proceed to Checkout
                </Button>
              </Link>
              
              <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                <p>✓ Secure checkout</p>
                <p>✓ 30-day return policy</p>
                <p>✓ 2-year warranty</p>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Cart;