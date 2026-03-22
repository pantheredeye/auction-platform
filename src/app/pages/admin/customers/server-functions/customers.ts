"use server";
import { db } from "@/db";
import { requestInfo } from "rwsdk/worker";
import { encodeCursor, decodeCursor } from "@/lib/pagination";
import { escapeLike } from "@/lib/sql";

export interface CustomerRow {
  userId: string;
  name: string | null;
  displayName: string | null;
  email: string | null;
  role: string;
  memberCreatedAt: string;
  hasCard: boolean;
  cardBrand: string | null;
  cardLast4: string | null;
}

export async function listCustomers(params: {
  cursor?: string;
  search?: string;
  limit?: number;
}) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;
  const limit = params.limit ?? 25;

  let query = db
    .selectFrom("memberships")
    .innerJoin("users", "users.id", "memberships.userId")
    .leftJoin("payment_methods", (join) =>
      join
        .onRef("payment_methods.userId", "=", "memberships.userId")
        .on("payment_methods.status", "=", "active")
        .on("payment_methods.isDefault", "=", 1),
    )
    .select([
      "memberships.userId",
      "users.name",
      "users.displayName",
      "users.email",
      "memberships.role",
      "memberships.createdAt as memberCreatedAt",
      "payment_methods.brand as cardBrand",
      "payment_methods.last4 as cardLast4",
    ])
    .where("memberships.organizationId", "=", orgId)
    .where("memberships.role", "in", ["consumer", "dealer"])
    .where("users.deletedAt", "is", null);

  if (params.search) {
    const escaped = escapeLike(params.search);
    query = query.where((eb) =>
      eb.or([
        eb("users.name", "like", `%${escaped}%`),
        eb("users.displayName", "like", `%${escaped}%`),
        eb("users.email", "like", `%${escaped}%`),
      ]),
    );
  }

  if (params.cursor) {
    const decoded = decodeCursor(params.cursor);
    query = query.where("memberships.createdAt", "<", decoded);
  }

  query = query.orderBy("memberships.createdAt", "desc").limit(limit + 1);

  const rows = await query.execute();
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
    ...r,
    hasCard: !!r.cardLast4,
  }));
  const nextCursor =
    hasMore && items.length > 0
      ? encodeCursor(items[items.length - 1].memberCreatedAt)
      : null;

  return { items, nextCursor, hasMore };
}

export interface PaymentMethodDetail {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: number;
  status: string;
}

export interface BidSummary {
  totalBids: number;
  totalWins: number;
  totalSpentCents: number;
}

export interface RecentBid {
  auctionTitle: string;
  lotTitle: string | null;
  amountCents: number;
  createdAt: string;
}

export interface CustomerDetail {
  user: {
    id: string;
    name: string | null;
    displayName: string | null;
    email: string | null;
    phone: string | null;
    authMethod: string;
    createdAt: string;
  };
  role: string;
  paymentMethods: PaymentMethodDetail[];
  bidSummary: BidSummary;
  recentBids: RecentBid[];
}

export async function getCustomerDetail(
  userId: string,
): Promise<CustomerDetail | null> {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  // Verify the user is a customer of this org
  const membership = await db
    .selectFrom("memberships")
    .innerJoin("users", "users.id", "memberships.userId")
    .select([
      "users.id",
      "users.name",
      "users.displayName",
      "users.email",
      "users.phone",
      "users.authMethod",
      "users.createdAt",
      "memberships.role",
    ])
    .where("memberships.userId", "=", userId)
    .where("memberships.organizationId", "=", orgId)
    .where("memberships.role", "in", ["consumer", "dealer"])
    .where("users.deletedAt", "is", null)
    .executeTakeFirst();

  if (!membership) return null;

  // Payment methods
  const paymentMethods = await db
    .selectFrom("payment_methods")
    .select([
      "id",
      "brand",
      "last4",
      "expMonth",
      "expYear",
      "isDefault",
      "status",
    ])
    .where("userId", "=", userId)
    .orderBy("isDefault", "desc")
    .orderBy("createdAt", "desc")
    .execute();

  // Bid summary
  const bidCount = await db
    .selectFrom("bid_events")
    .select(db.fn.count("id").as("count"))
    .where("userId", "=", userId)
    .where("organizationId", "=", orgId)
    .executeTakeFirstOrThrow();

  const winCount = await db
    .selectFrom("lots")
    .innerJoin("auctions", "auctions.id", "lots.auctionId")
    .select(db.fn.count("lots.id").as("count"))
    .where("lots.winnerUserId", "=", userId)
    .where("auctions.organizationId", "=", orgId)
    .executeTakeFirstOrThrow();

  const totalSpent = await db
    .selectFrom("lots")
    .innerJoin("auctions", "auctions.id", "lots.auctionId")
    .select(db.fn.sum("lots.winnerAmountCents").as("total"))
    .where("lots.winnerUserId", "=", userId)
    .where("auctions.organizationId", "=", orgId)
    .executeTakeFirstOrThrow();

  // Recent bids (last 10)
  const recentBids = await db
    .selectFrom("bid_events")
    .innerJoin("auctions", "auctions.id", "bid_events.auctionId")
    .leftJoin("lots", "lots.id", "bid_events.lotId")
    .select([
      "auctions.title as auctionTitle",
      "lots.title as lotTitle",
      "bid_events.amountCents",
      "bid_events.createdAt",
    ])
    .where("bid_events.userId", "=", userId)
    .where("bid_events.organizationId", "=", orgId)
    .orderBy("bid_events.createdAt", "desc")
    .limit(10)
    .execute();

  return {
    user: {
      id: membership.id,
      name: membership.name,
      displayName: membership.displayName,
      email: membership.email,
      phone: membership.phone,
      authMethod: membership.authMethod,
      createdAt: membership.createdAt,
    },
    role: membership.role,
    paymentMethods,
    bidSummary: {
      totalBids: Number(bidCount.count),
      totalWins: Number(winCount.count),
      totalSpentCents: Number(totalSpent.total) || 0,
    },
    recentBids,
  };
}
