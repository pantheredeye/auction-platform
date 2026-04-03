"use server";
import { db } from "@/db";
import { env } from "cloudflare:workers";
import { requestInfo } from "rwsdk/worker";
import { logAudit } from "@/lib/audit";
import { assertAuctioneerRole } from "@/lib/validate";

async function checkStripeConnect(
  orgId: string,
): Promise<{ error: string | null; testMode: boolean }> {
  if (!env.STRIPE_SECRET_KEY) return { error: null, testMode: false };
  const org = await db
    .selectFrom("organizations")
    .select(["stripeChargesEnabled", "testMode"])
    .where("id", "=", orgId)
    .executeTakeFirstOrThrow();
  if (org.testMode) return { error: null, testMode: true };
  if (!org.stripeChargesEnabled) {
    return {
      error: "Stripe Connect or Test Mode required. Update Organization Settings before going live.",
      testMode: false,
    };
  }
  return { error: null, testMode: false };
}

export async function quickGoLive(): Promise<
  { auctionId: string } | { error: string }
> {
  const { ctx } = requestInfo;
  assertAuctioneerRole(ctx.currentOrganization?.role);
  const orgId = ctx.currentOrganization!.id;
  const userId = ctx.user!.id;

  const stripe = await checkStripeConnect(orgId);
  if (stripe.error) return { error: stripe.error };

  const id = crypto.randomUUID();
  const now = new Date();
  const nowIso = now.toISOString();

  const title = `Live Auction - ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  const slug = `live-${Date.now()}`;

  await db
    .insertInto("auctions")
    .values({
      id,
      organizationId: orgId,
      type: "live_consumer",
      title,
      slug,
      description: null,
      status: "live",
      scheduledStartAt: null,
      actualStartAt: nowIso,
      actualEndAt: null,
      defaultIncrementCents: 100,
      incrementRules: null,
      buyerPremiumPct: 0,
      extensionSeconds: 0,
      streamProviderId: null,
      streamUrl: null,
      recording_key: null,
      recording_status: "none",
      isTestMode: stripe.testMode ? 1 : 0,
      auctioneerId: userId,
      createdByUserId: userId,
      clonedFromAuctionId: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    })
    .execute();

  await db
    .insertInto("auction_state_transitions")
    .values({
      id: crypto.randomUUID(),
      auctionId: id,
      fromStatus: null,
      toStatus: "live",
      triggeredByUserId: userId,
      reason: "Quick go live",
      createdAt: nowIso,
    })
    .execute();

  await db
    .insertInto("auction_summaries")
    .values({
      auctionId: id,
      organizationId: orgId,
      type: "live_consumer",
      title,
      status: "live",
      totalLots: 0,
      activeLotNumber: null,
      totalBids: 0,
      totalRevenueCents: 0,
      viewerCount: 0,
      scheduledStartAt: null,
      updatedAt: nowIso,
    })
    .execute();

  // Initialize AuctionRoomDO
  const doId = env.AUCTION_ROOM.idFromName(id);
  const stub = env.AUCTION_ROOM.get(doId);
  await stub.fetch(
    new Request("https://do/init", {
      method: "POST",
      headers: { "X-DO-Secret": env.AUTH_SECRET_KEY },
      body: JSON.stringify({ auctionId: id }),
    }),
  );

  await logAudit("auction", id, "quick_go_live", { title, type: "live_consumer" });

  return { auctionId: id };
}
