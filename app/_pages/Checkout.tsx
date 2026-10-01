"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, Lock, ChevronRight, Check, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import WalletPaymentForm from '@/components/WalletPaymentForm';
import { useStore } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import {
  paymentProviders,
  isPaymentProvider,
  initiatePayment,
  verifyPayment,
  fetchPaymentMode,
  isKhaltiWidgetConfigured,
  openKhaltiWidget,
  openEsewaApp,
  ESEWA_ANDROID_URL,
  buildSimulatedCallback,
} from '@/lib/payments';
import type { PaymentProvider, SimulatedOutcome } from '@/lib/payments';
import { stashOrder } from '@/lib/paymentOrder';
import { calculateTotals, formatNPR } from '@/lib/currency';
import confetti from 'canvas-confetti';

const WALLET_METHODS: { value: PaymentProvider; label: string }[] = [
  { value: 'esewa', label: 'eSewa' },
  { value: 'khalti', label: 'Khalti' },
];

/**
 * eSewa expects the signed fields to be POSTed as a form. Building the form
 * in JS and submitting it avoids a full page reload and keeps the redirect
 * behaviour identical to a server-rendered form.
 */
function submitGatewayForm(action: string, method: 'POST' | 'GET', fields: Record<string, string>) {
  const form = document.createElement('form');
  form.method = method;
  form.action = action;
  form.style.display = 'none';

  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
}

const Checkout = () => {
  const router = useRouter();
  const { toast } = useToast();
  const cart = useStore((state) => state.cart);
  const getCartTotal = useStore((state) => state.getCartTotal);
  const clearCart = useStore((state) => state.clearCart);
  const setLastOrder = useStore((state) => state.setLastOrder);
  
  const [step, setStep] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [isProcessing, setIsProcessing] = useState(false);

  /**
   * Which gateways the API is actually going to call. A gateway that is *not*
   * live is settled in place on this page; a live one authenticates on its own
   * domain and therefore cannot be embedded. Decided per gateway rather than
   * globally, because Khalti falls back to the simulator in sandbox mode when no
   * secret key is configured. `null` means the check has not answered yet.
   */
  const [liveProviders, setLiveProviders] = useState<Record<PaymentProvider, boolean> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPaymentMode()
      .then((config) => {
        if (cancelled) return;
        setLiveProviders(
          Object.fromEntries(
            Object.entries(config.providers).map(([key, value]) => [key, value.live])
          ) as Record<PaymentProvider, boolean>
        );
      })
      .catch(() => {
        // Unreachable API: leave the panel in its safe, redirect-shaped state
        // rather than promising in-page payment.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** True when the selected wallet can be paid for right here. */
  const paysInPage = isPaymentProvider(paymentMethod) && liveProviders?.[paymentMethod] === false;

  // Khalti can take payment without leaving the page once a public key is set.
  const isKhaltiInPage = paymentMethod === 'khalti' && isKhaltiWidgetConfigured;
  
  const [billingInfo, setBillingInfo] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    country: ''
  });
  
  const [shippingInfo, setShippingInfo] = useState({
    firstName: '',
    lastName: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    country: ''
  });
  
  const [cardInfo, setCardInfo] = useState({
    cardNumber: '',
    cardHolder: '',
    expiryDate: '',
    cvv: ''
  });
  
  const [sameAsBilling, setSameAsBilling] = useState(true);
  
  const { subtotal, shipping, tax, total } = calculateTotals(getCartTotal());

  /**
   * An empty cart belongs on the cart page — but this is a navigation, and a
   * navigation cannot happen *during render*.
   *
   * Under Vite that was harmless, because the component only ever ran in a
   * browser. Next prerenders this route on a server, where the router's read of
   * `location.href` throws `ReferenceError: location is not defined`; the build
   * logs it and still ships the page, so the redirect silently doesn't happen.
   *
   * `hydrated` exists because the cart lives in localStorage: on the server, and
   * on the client's first paint, `cart` is empty whether or not the shopper has
   * anything in their basket. Redirecting on that first read would bounce a
   * shopper who does have items — the opposite of what this guard is for.
   *
   * An effect is the gate rather than zustand's `persist.hasHydrated()`: effects
   * only run in the browser, and by then rehydration is done (localStorage is a
   * synchronous store, so zustand restores it while the store is being created).
   * `api.persist` itself is not usable here — the middleware skips creating it
   * when there is no storage to read, which is exactly the server case.
   */
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const emptyCart = hydrated && cart.length === 0;
  useEffect(() => {
    if (emptyCart) router.replace('/cart');
  }, [emptyCart, router]);

  // Before rehydration settles, "empty" and "full" are both unknown, so render a
  // neutral shell instead of a checkout form that may be about to redirect.
  if (!hydrated || emptyCart) {
    return (
      <div className="min-h-screen py-16">
        <div className="container-custom text-sm text-muted-foreground">Preparing your checkout…</div>
      </div>
    );
  }
  
  const handleBillingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (sameAsBilling) {
      setShippingInfo({
        firstName: billingInfo.firstName,
        lastName: billingInfo.lastName,
        address: billingInfo.address,
        city: billingInfo.city,
        state: billingInfo.state,
        zipCode: billingInfo.zipCode,
        country: billingInfo.country
      });
    }
    setStep(2);
  };
  
  const handleShippingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStep(3);
  };
  
  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    
    // Simulate payment processing
    setTimeout(() => {
      clearCart();
      toast({
        title: "Payment Successful!",
        description: "Your order has been placed successfully.",
      });
      router.push('/confirmation');
    }, 2000);
  };
  
  const formatCardNumber = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    const matches = v.match(/\d{4,16}/g);
    const match = (matches && matches[0]) || '';
    const parts = [];
    
    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }
    
    if (parts.length) {
      return parts.join(' ');
    } else {
      return value;
    }
  };
  
  const formatExpiryDate = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    if (v.length >= 2) {
      return v.slice(0, 2) + '/' + v.slice(2, 4);
    }
    return v;
  };

  /**
   * Completes a payment once the gateway reports success, whether that came
   * back through a redirect or from the in-page Khalti widget. The API is
   * always the one that decides the outcome.
   */
  const completePayment = async (
    provider: PaymentProvider,
    orderId: string,
    amount: number,
    gatewayRef: string,
    callback: Record<string, string>
  ) => {
    stashOrder({
      orderId,
      provider,
      amount,
      description: cart.length === 1 ? cart[0].name : `${cart.length} items`,
      gatewayRef,
      request: {},
    });

    const result = await verifyPayment(provider, callback);

    if (result.status === 'completed') {
      clearCart();
      setLastOrder({
        orderId: result.orderId ?? orderId,
        amount: result.amount ?? amount,
        provider,
        transactionId: result.transactionId ?? '',
        transactionCode: result.transactionCode ?? '',
        placedAt: new Date().toISOString(),
      });
      confetti({ particleCount: 130, spread: 75, origin: { y: 0.6 } });
      toast({
        title: 'Payment successful!',
        description: result.message,
      });
      router.push('/confirmation');
      return;
    }

    setIsProcessing(false);
    toast({
      title: 'Payment not completed',
      description: result.message,
      variant: 'destructive',
    });
  };

  /**
   * Starts a payment.
   *
   * In `mock` mode everything settles on this page: the API returns the signed
   * fields it would have sent to the wallet, the callback those fields produce
   * is rebuilt locally, and the outcome is verified — all without a single
   * navigation. `sandbox` and `live` reach the real gateways, which is why the
   * Khalti widget and the redirect paths are still here.
   */
  const handleWalletPay = async (provider: PaymentProvider, outcome: SimulatedOutcome = 'success') => {
    if (!isPaymentProvider(provider)) return;

    setIsProcessing(true);
    const orderId = `ORD-${Date.now().toString().slice(-8)}`;
    const description = cart.length === 1 ? cart[0].name : `${cart.length} items`;

    try {
      const response = await initiatePayment(provider, {
        orderId,
        amount: total,
        description,
        customer: {
          name: `${shippingInfo.firstName} ${shippingInfo.lastName}`.trim() || 'Guest',
          email: billingInfo.email,
          phone: billingInfo.phone,
        },
      });

      stashOrder({
        orderId,
        provider,
        amount: response.amount,
        description,
        gatewayRef: response.pidx ?? response.transactionUuid ?? '',
        request: response.fields ?? {},
      });

      // Simulated: the gateway's answer is replayed here instead of remotely.
      if (response.mode === 'mock') {
        await completePayment(
          provider,
          orderId,
          response.amount,
          response.pidx ?? response.transactionUuid ?? '',
          buildSimulatedCallback(provider, response, outcome)
        );
        return;
      }

      // In-page Khalti: no navigation away from the storefront.
      if (provider === 'khalti' && isKhaltiWidgetConfigured) {
        setIsProcessing(false);
        await openKhaltiWidget({
          orderId,
          productName: description,
          amountPaisa: response.amountPaisa ?? Math.round(response.amount * 100),
          onSuccess: (payload) => {
            void completePayment(provider, orderId, response.amount, payload.pidx ?? '', {
              orderId,
              pidx: payload.pidx ?? '',
              status: payload.status ?? 'Completed',
            });
          },
          onError: (error) => {
            setIsProcessing(false);
            toast({
              title: 'Khalti checkout failed',
              description:
                error instanceof Error ? error.message : 'Please try another payment method.',
              variant: 'destructive',
            });
          },
          onClose: () => setIsProcessing(false),
        });
        return;
      }

      // eSewa returns signed fields to POST; Khalti's redirect is the fallback.
      if (response.redirectUrl) {
        window.location.assign(response.redirectUrl);
        return;
      }

      if (response.action && response.fields) {
        submitGatewayForm(response.action, response.method ?? 'POST', response.fields);
        return;
      }

      throw new Error('The payment service did not return a gateway redirect.');
    } catch (error) {
      setIsProcessing(false);
      toast({
        title: 'Payment could not be started',
        description:
          error instanceof Error ? error.message : 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    }
  };
  
  return (
    <div className="min-h-screen py-8">
      <div className="container-custom">
        <h1 className="text-3xl font-serif mb-8">Checkout</h1>
        
        {/* Progress Steps */}
        <div className="flex items-center justify-center mb-8">
          <div className="flex items-center space-x-4">
            <div className={`flex items-center ${step >= 1 ? 'text-accent' : 'text-muted-foreground'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step >= 1 ? 'bg-accent text-accent-foreground' : 'bg-muted'}`}>
                {step > 1 ? <Check className="h-4 w-4" /> : '1'}
              </div>
              <span className="ml-2 text-sm font-medium">Billing</span>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <div className={`flex items-center ${step >= 2 ? 'text-accent' : 'text-muted-foreground'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step >= 2 ? 'bg-accent text-accent-foreground' : 'bg-muted'}`}>
                {step > 2 ? <Check className="h-4 w-4" /> : '2'}
              </div>
              <span className="ml-2 text-sm font-medium">Shipping</span>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <div className={`flex items-center ${step >= 3 ? 'text-accent' : 'text-muted-foreground'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step >= 3 ? 'bg-accent text-accent-foreground' : 'bg-muted'}`}>
                3
              </div>
              <span className="ml-2 text-sm font-medium">Payment</span>
            </div>
          </div>
        </div>
        
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Forms */}
          <div className="lg:col-span-2">
            {/* Billing Information */}
            {step === 1 && (
              <Card className="p-6">
                <h2 className="text-xl font-semibold mb-4">Billing Information</h2>
                <form onSubmit={handleBillingSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="firstName">First Name</Label>
                      <Input
                        id="firstName"
                        required
                        value={billingInfo.firstName}
                        onChange={(e) => setBillingInfo({...billingInfo, firstName: e.target.value})}
                      />
                    </div>
                    <div>
                      <Label htmlFor="lastName">Last Name</Label>
                      <Input
                        id="lastName"
                        required
                        value={billingInfo.lastName}
                        onChange={(e) => setBillingInfo({...billingInfo, lastName: e.target.value})}
                      />
                    </div>
                  </div>
                  
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      required
                      value={billingInfo.email}
                      onChange={(e) => setBillingInfo({...billingInfo, email: e.target.value})}
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      type="tel"
                      required
                      value={billingInfo.phone}
                      onChange={(e) => setBillingInfo({...billingInfo, phone: e.target.value})}
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="address">Address</Label>
                    <Input
                      id="address"
                      required
                      value={billingInfo.address}
                      onChange={(e) => setBillingInfo({...billingInfo, address: e.target.value})}
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="city">City</Label>
                      <Input
                        id="city"
                        required
                        value={billingInfo.city}
                        onChange={(e) => setBillingInfo({...billingInfo, city: e.target.value})}
                      />
                    </div>
                    <div>
                      <Label htmlFor="state">State/Province</Label>
                      <Input
                        id="state"
                        required
                        value={billingInfo.state}
                        onChange={(e) => setBillingInfo({...billingInfo, state: e.target.value})}
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="zipCode">ZIP Code</Label>
                      <Input
                        id="zipCode"
                        required
                        value={billingInfo.zipCode}
                        onChange={(e) => setBillingInfo({...billingInfo, zipCode: e.target.value})}
                      />
                    </div>
                    <div>
                      <Label htmlFor="country">Country</Label>
                      <Input
                        id="country"
                        required
                        value={billingInfo.country}
                        onChange={(e) => setBillingInfo({...billingInfo, country: e.target.value})}
                      />
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="sameAsBilling"
                      checked={sameAsBilling}
                      onChange={(e) => setSameAsBilling(e.target.checked)}
                      className="rounded"
                    />
                    <Label htmlFor="sameAsBilling" className="text-sm font-normal cursor-pointer">
                      Shipping address same as billing
                    </Label>
                  </div>
                  
                  <Button type="submit" size="lg" className="w-full" variant="accent">
                    Continue to Shipping
                  </Button>
                </form>
              </Card>
            )}
            
            {/* Shipping Information */}
            {step === 2 && (
              <Card className="p-6">
                <h2 className="text-xl font-semibold mb-4">Shipping Information</h2>
                {sameAsBilling ? (
                  <div className="space-y-2 mb-6">
                    <p className="text-sm text-muted-foreground">Shipping to:</p>
                    <p className="font-medium">{billingInfo.firstName} {billingInfo.lastName}</p>
                    <p>{billingInfo.address}</p>
                    <p>{billingInfo.city}, {billingInfo.state} {billingInfo.zipCode}</p>
                    <p>{billingInfo.country}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSameAsBilling(false)}
                      className="mt-2"
                    >
                      Use Different Address
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleShippingSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="shipFirstName">First Name</Label>
                        <Input
                          id="shipFirstName"
                          required
                          value={shippingInfo.firstName}
                          onChange={(e) => setShippingInfo({...shippingInfo, firstName: e.target.value})}
                        />
                      </div>
                      <div>
                        <Label htmlFor="shipLastName">Last Name</Label>
                        <Input
                          id="shipLastName"
                          required
                          value={shippingInfo.lastName}
                          onChange={(e) => setShippingInfo({...shippingInfo, lastName: e.target.value})}
                        />
                      </div>
                    </div>
                    
                    <div>
                      <Label htmlFor="shipAddress">Address</Label>
                      <Input
                        id="shipAddress"
                        required
                        value={shippingInfo.address}
                        onChange={(e) => setShippingInfo({...shippingInfo, address: e.target.value})}
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="shipCity">City</Label>
                        <Input
                          id="shipCity"
                          required
                          value={shippingInfo.city}
                          onChange={(e) => setShippingInfo({...shippingInfo, city: e.target.value})}
                        />
                      </div>
                      <div>
                        <Label htmlFor="shipState">State/Province</Label>
                        <Input
                          id="shipState"
                          required
                          value={shippingInfo.state}
                          onChange={(e) => setShippingInfo({...shippingInfo, state: e.target.value})}
                        />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="shipZipCode">ZIP Code</Label>
                        <Input
                          id="shipZipCode"
                          required
                          value={shippingInfo.zipCode}
                          onChange={(e) => setShippingInfo({...shippingInfo, zipCode: e.target.value})}
                        />
                      </div>
                      <div>
                        <Label htmlFor="shipCountry">Country</Label>
                        <Input
                          id="shipCountry"
                          required
                          value={shippingInfo.country}
                          onChange={(e) => setShippingInfo({...shippingInfo, country: e.target.value})}
                        />
                      </div>
                    </div>
                  </form>
                )}
                
                <div className="flex gap-4 mt-6">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => setStep(1)}
                    className="flex-1"
                  >
                    Back
                  </Button>
                  <Button
                    size="lg"
                    onClick={() => setStep(3)}
                    className="flex-1"
                    variant="accent"
                  >
                    Continue to Payment
                  </Button>
                </div>
              </Card>
            )}
            
            {/* Payment Information */}
            {step === 3 && (
              <Card className="p-6">
                <h2 className="text-xl font-semibold mb-4">Payment Information</h2>
                
                <RadioGroup value={paymentMethod} onValueChange={setPaymentMethod} className="mb-6">
                  <div className="flex items-center space-x-2 mb-3">
                    <RadioGroupItem value="card" id="card" />
                    <Label htmlFor="card" className="flex items-center cursor-pointer">
                      <CreditCard className="h-4 w-4 mr-2" />
                      Credit/Debit Card
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2 mb-3">
                    <RadioGroupItem value="paypal" id="paypal" />
                    <Label htmlFor="paypal" className="cursor-pointer">PayPal</Label>
                  </div>
                  <div className="flex items-center space-x-2 mb-3">
                    <RadioGroupItem value="stripe" id="stripe" />
                    <Label htmlFor="stripe" className="cursor-pointer">Stripe</Label>
                  </div>
                  {WALLET_METHODS.map((method) => {
                    return (
                      <div key={method.value} className="flex items-center space-x-2 mb-3">
                        <RadioGroupItem value={method.value} id={method.value} />
                        <Label htmlFor={method.value} className="flex items-center cursor-pointer">
                          <Smartphone className="h-4 w-4 mr-2" />
                          {method.label} Wallet
                        </Label>
                        <Badge variant="secondary" className="ml-auto">Nepal</Badge>
                      </div>
                    );
                  })}
                </RadioGroup>
                
                {paymentMethod === 'card' && (
                  <form onSubmit={handlePaymentSubmit} className="space-y-4">
                    <div>
                      <Label htmlFor="cardNumber">Card Number</Label>
                      <div className="relative">
                        <Input
                          id="cardNumber"
                          placeholder="1234 5678 9012 3456"
                          required
                          maxLength={19}
                          value={cardInfo.cardNumber}
                          onChange={(e) => setCardInfo({...cardInfo, cardNumber: formatCardNumber(e.target.value)})}
                        />
                        <CreditCard className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                    
                    <div>
                      <Label htmlFor="cardHolder">Cardholder Name</Label>
                      <Input
                        id="cardHolder"
                        placeholder="John Doe"
                        required
                        value={cardInfo.cardHolder}
                        onChange={(e) => setCardInfo({...cardInfo, cardHolder: e.target.value})}
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="expiryDate">Expiry Date</Label>
                        <Input
                          id="expiryDate"
                          placeholder="MM/YY"
                          required
                          maxLength={5}
                          value={cardInfo.expiryDate}
                          onChange={(e) => setCardInfo({...cardInfo, expiryDate: formatExpiryDate(e.target.value)})}
                        />
                      </div>
                      <div>
                        <Label htmlFor="cvv">CVV</Label>
                        <div className="relative">
                          <Input
                            id="cvv"
                            placeholder="123"
                            required
                            maxLength={4}
                            value={cardInfo.cvv}
                            onChange={(e) => setCardInfo({...cardInfo, cvv: e.target.value.replace(/\D/g, '')})}
                          />
                          <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-muted/30 p-3 rounded-md flex items-center gap-2 text-sm">
                      <Lock className="h-4 w-4 text-success" />
                      <span>Your payment information is encrypted and secure</span>
                    </div>
                    
                    <div className="flex gap-4">
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        onClick={() => setStep(2)}
                        className="flex-1"
                        disabled={isProcessing}
                      >
                        Back
                      </Button>
                      <Button
                        type="submit"
                        size="lg"
                        className="flex-1"
                        disabled={isProcessing}
                        variant="accent"
                      >
                        {isProcessing ? 'Processing...' : `Pay ${formatNPR(total)}`}
                      </Button>
                    </div>
                  </form>
                )}
                
                {paymentMethod === 'paypal' && (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground mb-4">You will be redirected to PayPal to complete your purchase.</p>
                    <Button
                      size="lg"
                      onClick={handlePaymentSubmit}
                      disabled={isProcessing}
                      variant="accent"
                    >
                      {isProcessing ? 'Processing...' : 'Continue to PayPal'}
                    </Button>
                  </div>
                )}
                
                {paymentMethod === 'stripe' && (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground mb-4">You will be redirected to Stripe to complete your purchase.</p>
                    <Button
                      size="lg"
                      onClick={handlePaymentSubmit}
                      disabled={isProcessing}
                      variant="accent"
                    >
                      {isProcessing ? 'Processing...' : 'Continue to Stripe'}
                    </Button>
                  </div>
                )}
                
                {isPaymentProvider(paymentMethod) && (
                  paysInPage ? (
                    <WalletPaymentForm
                      key={paymentMethod}
                      provider={paymentMethod}
                      amount={total}
                      isProcessing={isProcessing}
                      onPay={(outcome) => handleWalletPay(paymentMethod, outcome)}
                      onBack={() => setStep(2)}
                    />
                  ) : (
                  <div className="text-center py-6">
                    {isKhaltiInPage ? (
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-success/15 text-success text-xs font-semibold mb-4">
                        Pay on this page — no redirect
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-warning/15 text-warning text-xs font-semibold mb-4">
                        You'll be redirected to {paymentProviders[paymentMethod].label}
                      </div>
                    )}
                    <p className="text-muted-foreground mb-4">
                      {isKhaltiInPage
                        ? `A secure ${paymentProviders[paymentMethod].label} checkout opens over this page. Your order is confirmed the moment payment goes through.`
                        : paymentMethod === 'esewa'
                          ? 'eSewa handles authentication on its own site, so you will be taken to eSewa and returned here afterwards. On a phone you can pay directly in the eSewa app instead.'
                          : `You will be redirected to ${paymentProviders[paymentMethod].label} to complete your purchase, then returned here to confirm the transaction.`}
                    </p>

                    {paymentMethod === 'esewa' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mb-4"
                        onClick={() => {
                          if (!openEsewaApp()) {
                            window.open(ESEWA_ANDROID_URL, '_blank', 'noopener,noreferrer');
                          }
                        }}
                      >
                        <Smartphone className="h-4 w-4" />
                        Open the eSewa app instead
                      </Button>
                    )}

                    <div className="flex gap-4">
                      <Button
                        type="button"
                        size="lg"
                        variant="outline"
                        onClick={() => setStep(2)}
                        className="flex-1"
                        disabled={isProcessing}
                      >
                        Back
                      </Button>
                      <Button
                        type="button"
                        size="lg"
                        variant="accent"
                        className="flex-1"
                        disabled={isProcessing}
                        onClick={() => handleWalletPay(paymentMethod)}
                      >
                        {isProcessing
                          ? 'Redirecting...'
                          : isKhaltiInPage
                            ? `Pay ${formatNPR(total)} with Khalti`
                            : `Pay ${formatNPR(total)} with ${paymentProviders[paymentMethod].label}`}
                      </Button>
                    </div>
                  </div>
                  )
                )}
              </Card>
            )}
          </div>
          
          {/* Order Summary */}
          <div>
            <Card className="p-6 sticky top-20">
              <h2 className="text-xl font-semibold mb-4">Order Summary</h2>
              
              <div className="space-y-3 mb-4">
                {cart.map((item) => (
                  <div key={`${item.id}-${item.selectedSize}-${item.selectedColor}`} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {item.name} × {item.quantity}
                    </span>
                    <span>{formatNPR(item.price * item.quantity)}</span>
                  </div>
                ))}
              </div>
              
              <Separator className="my-4" />
              
              <div className="space-y-2">
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
              
              <div className="mt-6 p-3 bg-muted/30 rounded-md">
                <p className="text-xs text-muted-foreground">
                  By placing your order, you agree to our Terms of Service and Privacy Policy.
                </p>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Checkout;