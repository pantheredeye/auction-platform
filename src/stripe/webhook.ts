import { env } from "cloudflare:workers";
import { db } from "@/db";
import { getStripe, getCryptoProvider } from "@/stripe/client";

export async function handleStripeWebhook(
  request: Request,
): Promise<Response> {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const stripe = getStripe(env.STRIPE_SECRET_KEY);
  const cryptoProvider = getCryptoProvider();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      env.STRIPE_WEBHOOK_SECRET,
      undefined,
      cryptoProvider,
    );
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  const now = new Date().toISOString();

  switch (event.type) {
    case "payment_method.updated": {
      const pm = event.data.object;
      const card = pm.card;
      if (card) {
        await db
          .updateTable("payment_methods")
          .set({
            last4: card.last4,
            brand: card.brand,
            expMonth: card.exp_month,
            expYear: card.exp_year,
            updatedAt: now,
          })
          .where("stripePaymentMethodId", "=", pm.id)
          .execute();
      }
      break;
    }
    case "payment_method.detached": {
      const pm = event.data.object;
      await db
        .updateTable("payment_methods")
        .set({
          status: "detached",
          updatedAt: now,
        })
        .where("stripePaymentMethodId", "=", pm.id)
        .execute();
      break;
    }
    case "account.updated": {
      const account = event.data.object;
      await db
        .updateTable("organizations")
        .set({
          stripeChargesEnabled: account.charges_enabled ? 1 : 0,
          updatedAt: now,
        })
        .where("stripeConnectAccountId", "=", account.id)
        .execute();
      break;
    }
  }

  return new Response("ok", { status: 200 });
}
