"use server";

import { db } from "@/db";

export async function getAuctionBySlug(slug: string) {
  const auction = await db
    .selectFrom("auctions")
    .innerJoin("organizations", "organizations.id", "auctions.organizationId")
    .select([
      "auctions.id",
      "auctions.title",
      "auctions.slug",
      "auctions.status",
      "auctions.type",
      "auctions.scheduledStartAt",
      "auctions.actualStartAt",
      "auctions.actualEndAt",
      "auctions.streamUrl",
      "auctions.defaultIncrementCents",
      "auctions.buyerPremiumPct",
      "auctions.extensionSeconds",
      "auctions.organizationId",
      "organizations.bidderRequirement as orgBidderRequirement",
      "organizations.name as orgName",
      "organizations.slateImageUrl as orgSlateImageUrl",
      "auctions.bidderRequirement as auctionBidderRequirement",
    ])
    .where("auctions.slug", "=", slug)
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

export async function getGuestRegistrationStatus(guestId: string) {
  const registration = await db
    .selectFrom("bidder_registrations")
    .select(["userId"])
    .where("guestId", "=", guestId)
    .executeTakeFirst();

  if (!registration) {
    return { registered: false, hasCard: false } as const;
  }

  const user = await db
    .selectFrom("users")
    .select(["displayName", "username"])
    .where("id", "=", registration.userId)
    .executeTakeFirst();

  const activeMethod = await db
    .selectFrom("payment_methods")
    .select(["id"])
    .where("userId", "=", registration.userId)
    .where("status", "=", "active")
    .executeTakeFirst();

  return {
    registered: true,
    hasCard: !!activeMethod,
    userId: registration.userId,
    userName: user?.displayName ?? null,
    userEmail: user?.username ?? null,
  };
}
