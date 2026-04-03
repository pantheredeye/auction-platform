"use server";
import { env } from "cloudflare:workers";
import { db } from "@/db";
import { getStripe } from "@/stripe/client";
import { requestInfo } from "rwsdk/worker";
import { assertAdminRole } from "@/lib/validate";

export async function startConnectOnboarding(): Promise<{ url: string }> {
  const { ctx } = requestInfo;
  assertAdminRole(ctx.currentOrganization?.role);
  const orgId = ctx.currentOrganization!.id;
  const stripe = getStripe(env.STRIPE_SECRET_KEY);

  const org = await db
    .selectFrom("organizations")
    .select(["stripeConnectAccountId"])
    .where("id", "=", orgId)
    .executeTakeFirstOrThrow();

  let accountId = org.stripeConnectAccountId;

  if (!accountId) {
    const account = await stripe.accounts.create({});
    accountId = account.id;

    await db
      .updateTable("organizations")
      .set({
        stripeConnectAccountId: accountId,
        updatedAt: new Date().toISOString(),
      })
      .where("id", "=", orgId)
      .execute();
  }

  const origin = new URL(requestInfo.request.url).origin;

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    return_url: `${origin}/admin/settings?stripe=return`,
    refresh_url: `${origin}/admin/settings?stripe=refresh`,
  });

  return { url: accountLink.url };
}

export async function refreshConnectStatus(): Promise<{
  stripeChargesEnabled: boolean;
}> {
  const { ctx } = requestInfo;
  assertAdminRole(ctx.currentOrganization?.role);
  const orgId = ctx.currentOrganization!.id;

  const org = await db
    .selectFrom("organizations")
    .select(["stripeConnectAccountId"])
    .where("id", "=", orgId)
    .executeTakeFirstOrThrow();

  if (!org.stripeConnectAccountId) {
    return { stripeChargesEnabled: false };
  }

  const stripe = getStripe(env.STRIPE_SECRET_KEY);
  const account = await stripe.accounts.retrieve(org.stripeConnectAccountId);

  const enabled = account.charges_enabled ?? false;

  await db
    .updateTable("organizations")
    .set({
      stripeChargesEnabled: enabled ? 1 : 0,
      updatedAt: new Date().toISOString(),
    })
    .where("id", "=", orgId)
    .execute();

  return { stripeChargesEnabled: enabled };
}

export async function disconnectStripeConnect(): Promise<{ success: true }> {
  const { ctx } = requestInfo;
  assertAdminRole(ctx.currentOrganization?.role);
  const orgId = ctx.currentOrganization!.id;

  await db
    .updateTable("organizations")
    .set({
      stripeConnectAccountId: null,
      stripeChargesEnabled: 0,
      updatedAt: new Date().toISOString(),
    })
    .where("id", "=", orgId)
    .execute();

  return { success: true };
}
