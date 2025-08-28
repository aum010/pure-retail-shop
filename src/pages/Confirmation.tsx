import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Package, Mail, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import confetti from 'canvas-confetti';

const Confirmation = () => {
  useEffect(() => {
    // Trigger confetti animation
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    });
  }, []);
  
  const orderNumber = `ORD-${Date.now().toString().slice(-8)}`;
  const estimatedDelivery = new Date();
  estimatedDelivery.setDate(estimatedDelivery.getDate() + 7);
  
  return (
    <div className="min-h-screen py-12">
      <div className="container-custom max-w-3xl">
        <div className="text-center mb-8 animate-slide-up">
          <CheckCircle className="h-16 w-16 text-success mx-auto mb-4" />
          <h1 className="text-4xl font-serif mb-4">Order Confirmed!</h1>
          <p className="text-lg text-muted-foreground">
            Thank you for your purchase. We've received your order and will process it shortly.
          </p>
        </div>
        
        <Card className="p-8 mb-8">
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Package className="h-5 w-5 text-accent" />
                Order Details
              </h2>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Order Number:</span>
                  <p className="font-medium">{orderNumber}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Order Date:</span>
                  <p className="font-medium">{new Date().toLocaleDateString()}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Estimated Delivery:</span>
                  <p className="font-medium">{estimatedDelivery.toLocaleDateString()}</p>
                </div>
              </div>
            </div>
            
            <div>
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Mail className="h-5 w-5 text-accent" />
                Confirmation Email
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                A confirmation email has been sent to your registered email address with all the order details and tracking information.
              </p>
              <Button variant="outline" size="sm">
                Resend Confirmation Email
              </Button>
            </div>
          </div>
          
          <Separator className="my-6" />
          
          <div className="bg-muted/30 p-4 rounded-lg">
            <h3 className="font-semibold mb-2">What's Next?</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="text-accent mt-1">•</span>
                <span>You'll receive an email when your order is being prepared</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent mt-1">•</span>
                <span>We'll notify you once your order has been shipped with tracking details</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent mt-1">•</span>
                <span>You can track your order status in your account dashboard</span>
              </li>
            </ul>
          </div>
        </Card>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link to="/shop">
            <Button size="lg" variant="accent">
              Continue Shopping
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
          <Link to="/account">
            <Button size="lg" variant="outline">
              View Order History
            </Button>
          </Link>
        </div>
        
        <div className="mt-12 text-center">
          <p className="text-sm text-muted-foreground">
            Need help? <Link to="/contact" className="text-accent hover:underline">Contact our support team</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Confirmation;