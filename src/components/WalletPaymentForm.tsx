"use client";

import { useState } from 'react';
import { ArrowRight, Info, Lock, ShieldCheck, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { paymentProviders, esewaTestHint, khaltiTestHint } from '@/lib/payments';
import { SIMULATED_OUTCOMES } from '@/lib/payments/simulated-gateway';
import type { PaymentProvider } from '@/lib/payments';
import type { SimulatedOutcome } from '@/lib/payments/simulated-gateway';
import { formatNPR } from '@/lib/currency';

interface CredentialField {
  id: string;
  label: string;
  /** The test value, shown as a hint only — never written into the input. */
  placeholder: string;
  type?: string;
  inputMode?: 'numeric' | 'text';
  maxLength?: number;
  autoComplete?: string;
}

/**
 * The fields each wallet asks for on its own login screen.
 *
 * These mirror eSewa's and Khalti's real forms so the panel feels familiar, but
 * the values in `placeholder` are demo credentials and nothing more: every
 * input starts empty, so nobody can mistake sandbox data for a stored
 * credential or ship a form that pays itself.
 */
const WALLET_FIELDS: Record<PaymentProvider, CredentialField[]> = {
  esewa: [
    { id: 'walletId', label: 'eSewa ID', placeholder: '9711111111', inputMode: 'numeric', autoComplete: 'username' },
    { id: 'password', label: 'Password', placeholder: 'Test@123', type: 'password', autoComplete: 'current-password' },
    { id: 'mpin', label: 'MPIN', placeholder: '1122', type: 'password', inputMode: 'numeric', maxLength: 4, autoComplete: 'off' },
  ],
  khalti: [
    { id: 'walletId', label: 'Khalti Mobile Number', placeholder: '9800000000', inputMode: 'numeric', autoComplete: 'username' },
    { id: 'mpin', label: 'MPIN', placeholder: '1111', type: 'password', inputMode: 'numeric', maxLength: 4, autoComplete: 'off' },
    { id: 'otp', label: 'OTP', placeholder: '987654', inputMode: 'numeric', maxLength: 6, autoComplete: 'one-time-code' },
  ],
};

const TEST_HINT: Record<PaymentProvider, string> = {
  esewa: esewaTestHint,
  khalti: khaltiTestHint,
};

export interface WalletPaymentFormProps {
  provider: PaymentProvider;
  /** Amount in rupees, shown on the pay button. */
  amount: number;
  isProcessing: boolean;
  onPay: (outcome: SimulatedOutcome) => void;
  onBack: () => void;
}

/**
 * Pays with a wallet without ever leaving the checkout page.
 *
 * The panel stands in for the wallet's own login screen: the shopper signs in
 * here, and the outcome is settled against the API in place — no popup, no
 * redirect, and the cart and checkout state stay exactly where they were.
 *
 * Signing in is required to approve a payment, which is what makes the flow
 * read as a real checkout. The other outcomes (pending / failed / cancel) are
 * one click away because those are what a tester needs to reach quickly, and a
 * shopper who abandons a checkout never fills the form in.
 */
const WalletPaymentForm = ({
  provider,
  amount,
  isProcessing,
  onPay,
  onBack,
}: WalletPaymentFormProps) => {
  const fields = WALLET_FIELDS[provider];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.id, '']))
  );
  const [showErrors, setShowErrors] = useState(false);

  const credentialsEntered = fields.every((field) => values[field.id]?.trim());

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!credentialsEntered) {
      setShowErrors(true);
      return;
    }
    onPay('success');
  };

  return (
    <form onSubmit={submit} className="text-left">
      <div className="flex flex-col items-center text-center mb-5">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-success/15 text-success text-xs font-semibold mb-3">
          <Smartphone className="h-3.5 w-3.5" />
          Pay on this page — no redirect
        </div>
        <h3 className="text-lg font-semibold">Log in to {paymentProviders[provider].label}</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Your {paymentProviders[provider].label} details are used for this payment only.
        </p>
      </div>

      <div className="mb-5 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground flex items-start gap-2">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          <span className="font-medium text-foreground">Test credentials</span> — {TEST_HINT[provider]}.
          Type them in below; the boxes are left empty on purpose.
        </span>
      </div>

      <div className="space-y-4">
        {fields.map((field) => {
          const isMissing = showErrors && !values[field.id]?.trim();
          // MPIN and OTP are digits only, so the field corrects typos itself.
          const digitsOnly = field.type === 'password' && field.inputMode === 'numeric';
          return (
            <div key={field.id}>
              <Label htmlFor={`wallet-${field.id}`}>{field.label}</Label>
              <Input
                id={`wallet-${field.id}`}
                type={field.type ?? 'text'}
                inputMode={field.inputMode}
                autoComplete={field.autoComplete}
                maxLength={field.maxLength}
                placeholder={field.placeholder}
                value={values[field.id] ?? ''}
                disabled={isProcessing}
                aria-invalid={isMissing}
                onChange={(e) =>
                  setValues((current) => ({
                    ...current,
                    [field.id]: digitsOnly ? e.target.value.replace(/\D/g, '') : e.target.value,
                  }))
                }
              />
              {isMissing && (
                <p className="text-xs text-destructive mt-1">
                  Enter the {field.label.toLowerCase()} shown above.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-muted/30 p-3 rounded-md flex items-center gap-2 text-sm mt-4">
        <Lock className="h-4 w-4 text-success shrink-0" />
        <span>Signed and verified on the server — the browser never sees a secret key.</span>
      </div>

      <div className="flex gap-4 mt-5">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="flex-1"
          onClick={onBack}
          disabled={isProcessing}
        >
          Back
        </Button>
        <Button
          type="submit"
          size="lg"
          variant="accent"
          className="flex-1"
          disabled={isProcessing}
          aria-busy={isProcessing}
        >
          {isProcessing ? 'Processing…' : `Pay ${formatNPR(amount)}`}
          {!isProcessing && <ArrowRight className="ml-2 h-4 w-4" />}
        </Button>
      </div>

      <Separator className="my-5" />

      {/* Every other outcome a real gateway can report, one click away. */}
      <div className="text-center">
        <p className="text-xs text-muted-foreground mb-3">
          Simulate a different outcome without filling the form
        </p>
        <div className="grid grid-cols-3 gap-2">
          {SIMULATED_OUTCOMES.map((outcome) => (
            <Button
              key={outcome.value}
              type="button"
              size="sm"
              variant="outline"
              title={outcome.hint}
              disabled={isProcessing}
              onClick={() => onPay(outcome.value)}
            >
              {outcome.label}
            </Button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-5 flex items-center justify-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 text-success shrink-0" />
        Simulation only — no real wallet is charged and nothing is stored
      </p>
    </form>
  );
};

export default WalletPaymentForm;

