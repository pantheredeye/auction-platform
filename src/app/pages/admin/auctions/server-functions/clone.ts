"use server";
import { db } from "@/db";
import { requestInfo } from "rwsdk/worker";
import { logAudit } from "@/lib/audit";
import { generateSlug } from "@/lib/slug";

export async function cloneAuction(sourceId: string) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;
  const userId = ctx.user!.id;

  const source = await db
    .selectFrom("auctions")
    .selectAll()
    .where("id", "=", sourceId)
    .where("organizationId", "=", orgId)
    .executeTakeFirst();

  if (!source) throw new Error("Source auction not found");

  const now = new Date().toISOString();
  const newId = crypto.randomUUID();
  const newTitle = `${source.title} (Copy)`;

  // Clone auction
  await db
    .insertInto("auctions")
    .values({
      id: newId,
      organizationId: orgId,
      type: source.type,
      title: newTitle,
      slug: generateSlug(newTitle),
      description: source.description,
      status: "draft",
      scheduledStartAt: null,
      actualStartAt: null,
      actualEndAt: null,
      defaultIncrementCents: source.defaultIncrementCents,
      incrementRules: source.incrementRules,
      buyerPremiumPct: source.buyerPremiumPct,
      extensionSeconds: source.extensionSeconds,
      streamProviderId: source.streamProviderId,
      streamUrl: null,
      recording_key: null,
      recording_status: "none",
      auctioneerId: source.auctioneerId,
      createdByUserId: userId,
      clonedFromAuctionId: sourceId,
      createdAt: now,
      updatedAt: now,
      version: 1,
    })
    .execute();

  // Insert state transition
  await db
    .insertInto("auction_state_transitions")
    .values({
      id: crypto.randomUUID(),
      auctionId: newId,
      fromStatus: null,
      toStatus: "draft",
      triggeredByUserId: userId,
      reason: `Cloned from ${source.title}`,
      createdAt: now,
    })
    .execute();

  // Clone lots
  const lots = await db
    .selectFrom("lots")
    .selectAll()
    .where("auctionId", "=", sourceId)
    .orderBy("lotNumber", "asc")
    .execute();

  for (const lot of lots) {
    const newLotId = crypto.randomUUID();

    await db
      .insertInto("lots")
      .values({
        id: newLotId,
        organizationId: orgId,
        auctionId: newId,
        lotNumber: lot.lotNumber,
        title: lot.title,
        description: lot.description,
        startingPriceCents: lot.startingPriceCents,
        reservePriceCents: lot.reservePriceCents,
        buyNowPriceCents: lot.buyNowPriceCents,
        incrementCents: lot.incrementCents,
        currentBidCents: null,
        currentBidderId: null,
        bidCount: 0,
        status: "pending",
        quantity: lot.quantity,
        saleMode: lot.saleMode ?? "english",
        quantityClaimed: 0,
        maxClaimsPerUser: lot.maxClaimsPerUser ?? null,
        extensionSeconds: lot.extensionSeconds,
        closesAt: null,
        winnerUserId: null,
        winnerAmountCents: null,
        imageUrls: lot.imageUrls,
        thumbnailUrl: lot.thumbnailUrl,
        createdAt: now,
        updatedAt: now,
        version: 1,
      })
      .execute();

    // Clone lot items
    const items = await db
      .selectFrom("lot_items")
      .selectAll()
      .where("lotId", "=", lot.id)
      .execute();

    for (const item of items) {
      await db
        .insertInto("lot_items")
        .values({
          id: crypto.randomUUID(),
          lotId: newLotId,
          productId: item.productId,
          quantity: item.quantity,
          sortOrder: item.sortOrder,
        })
        .execute();
    }
  }

  await logAudit("auction", newId, "clone", { sourceId, sourceTitle: source.title });
  return { id: newId };
}
