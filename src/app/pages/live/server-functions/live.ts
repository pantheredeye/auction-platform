"use server";

import { db } from "@/db";

export async function getAuctionBySlug(slug: string) {
  const auction = await db
    .selectFrom("auctions")
    .select([
      "id",
      "title",
      "slug",
      "status",
      "type",
      "scheduledStartAt",
      "actualStartAt",
      "actualEndAt",
      "streamUrl",
      "defaultIncrementCents",
      "buyerPremiumPct",
      "extensionSeconds",
      "organizationId",
    ])
    .where("slug", "=", slug)
    .executeTakeFirst();

  if (!auction) return null;

  const activeLot = await db
    .selectFrom("lots")
    .select([
      "id",
      "lotNumber",
      "title",
      "description",
      "startingPriceCents",
      "currentBidCents",
      "currentBidderId",
      "bidCount",
      "status",
      "incrementCents",
      "closesAt",
      "thumbnailUrl",
      "imageUrls",
    ])
    .where("auctionId", "=", auction.id)
    .where("status", "=", "active")
    .executeTakeFirst();

  return {
    ...auction,
    activeLot: activeLot ?? null,
  };
}
