"use server";
import { sql } from "kysely";
import { db } from "@/db";
import { requestInfo } from "rwsdk/worker";

export async function listLiveAuctions() {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization?.id;
  if (!orgId) return [];

  const rows = await db
    .selectFrom("auctions")
    .innerJoin(
      "auction_summaries",
      "auction_summaries.auctionId",
      "auctions.id",
    )
    .select([
      "auctions.id",
      "auctions.title",
      "auctions.slug",
      "auctions.status",
      "auctions.type",
      "auctions.scheduledStartAt",
      "auction_summaries.viewerCount",
      "auction_summaries.totalLots",
    ])
    .where("auctions.organizationId", "=", orgId)
    .where("auctions.status", "in", ["live", "scheduled", "preview"])
    .orderBy(
      sql`case auctions.status when 'live' then 0 when 'preview' then 1 else 2 end`,
    )
    .orderBy("auctions.scheduledStartAt", "asc")
    .execute();

  return rows;
}

export async function getAuctionBySlug(slug: string) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization?.id;
  if (!orgId) return null;

  const auction = await db
    .selectFrom("auctions")
    .selectAll()
    .where("organizationId", "=", orgId)
    .where("slug", "=", slug)
    .where("status", "in", ["live", "scheduled", "preview"])
    .executeTakeFirst();

  if (!auction) return null;

  const lots = await db
    .selectFrom("lots")
    .selectAll()
    .where("auctionId", "=", auction.id)
    .where("organizationId", "=", orgId)
    .orderBy("lotNumber", "asc")
    .execute();

  const activeLot = lots.find((l) => l.status === "active") ?? null;
  const upcomingLots = lots.filter((l) => l.status === "pending");

  return {
    auction,
    activeLot,
    upcomingLots,
    streamUrl: auction.streamUrl,
  };
}
