import type { PaymentProvider } from './types';
import { esewaLabel, esewaGatewayUrl, esewaTestHint } from './esewa';
import { khaltiLabel, khaltiGatewayUrl, khaltiTestHint } from './khalti';

export * from './types';
export * from './api';
export * from './simulated-gateway';
export * from './khalti-widget';
export * from './esewa-app';
export { esewaLabel, esewaGatewayUrl, esewaTestHint } from './esewa';
export { khaltiLabel, khaltiGatewayUrl, khaltiTestHint } from './khalti';

export interface PaymentProviderInfo {
  provider: PaymentProvider;
  label: string;
  gatewayUrl: string;
  testHint: string;
}

export const paymentProviders: Record<PaymentProvider, PaymentProviderInfo> = {
  esewa: { provider: 'esewa', label: esewaLabel, gatewayUrl: esewaGatewayUrl, testHint: esewaTestHint },
  khalti: { provider: 'khalti', label: khaltiLabel, gatewayUrl: khaltiGatewayUrl, testHint: khaltiTestHint },
};

export const isPaymentProvider = (value: string): value is PaymentProvider =>
  Object.prototype.hasOwnProperty.call(paymentProviders, value);
