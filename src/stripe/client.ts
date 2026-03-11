import Stripe from "stripe";

export function getStripe(secretKey: string) {
  return new Stripe(secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export function getCryptoProvider() {
  return Stripe.createSubtleCryptoProvider();
}
