"use server";
import { env } from "cloudflare:workers";
import { db } from "@/db";
import { requestInfo } from "rwsdk/worker";

export async function getOrgSettings() {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  const result = await db
    .selectFrom("organizations")
    .select([
      "bidderRequirement",
      "stripeConnectAccountId",
      "stripeChargesEnabled",
      "testMode",
    ])
    .where("id", "=", orgId)
    .executeTakeFirst();

  return {
    bidderRequirement: result?.bidderRequirement ?? "guest",
    stripeConnectAccountId: result?.stripeConnectAccountId ?? null,
    stripeChargesEnabled: result?.stripeChargesEnabled ?? 0,
    stripeConfigured: !!env.STRIPE_SECRET_KEY,
    testMode: result?.testMode ?? 0,
  };
}

const VALID_BIDDER_REQUIREMENTS = ["guest", "registered", "card_on_file"] as const;

export async function updateOrgSettings({
  bidderRequirement,
}: {
  bidderRequirement: string;
}) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  if (!VALID_BIDDER_REQUIREMENTS.includes(bidderRequirement as any)) {
    throw new Error(`Invalid bidder requirement: ${bidderRequirement}`);
  }

  // Guard: cannot change while auction is live
  const liveAuctions = await db
    .selectFrom("auctions")
    .select("id")
    .where("organizationId", "=", orgId)
    .where("status", "in", ["live", "closing"])
    .executeTakeFirst();

  if (liveAuctions) {
    throw new Error(
      "Cannot change bidder requirement while an auction is live.",
    );
  }

  await db
    .updateTable("organizations")
    .set({
      bidderRequirement,
      updatedAt: new Date().toISOString(),
    })
    .where("id", "=", orgId)
    .execute();

  return { success: true };
}

export async function updateTestMode(enabled: boolean) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  const liveAuction = await db
    .selectFrom("auctions")
    .select("id")
    .where("organizationId", "=", orgId)
    .where("status", "in", ["live", "closing"])
    .executeTakeFirst();

  if (liveAuction) {
    throw new Error("Cannot change test mode while an auction is live.");
  }

  await db
    .updateTable("organizations")
    .set({
      testMode: enabled ? 1 : 0,
      updatedAt: new Date().toISOString(),
    })
    .where("id", "=", orgId)
    .execute();

  return { success: true };
}
