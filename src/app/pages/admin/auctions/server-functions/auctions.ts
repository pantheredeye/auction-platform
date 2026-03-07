"use server";
import { db } from "@/db";
import { requestInfo } from "rwsdk/worker";
import { logAudit } from "@/lib/audit";
import { generateSlug } from "@/lib/slug";
import { encodeCursor, decodeCursor } from "@/lib/pagination";
import { assertAuctionTransition } from "@/auction/state-machine";
import type { AuctionStatus } from "@/auction/types";

export async function listAuctions(params: {
  cursor?: string;
  status?: string;
  search?: string;
  limit?: number;
}) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;
  const limit = params.limit ?? 25;

  let query = db
    .selectFrom("auctions")
    .selectAll()
    .where("organizationId", "=", orgId);

  if (params.status) {
    query = query.where("status", "=", params.status);
  }

  if (params.search) {
    query = query.where("title", "like", `%${params.search}%`);
  }

  if (params.cursor) {
    const decoded = decodeCursor(params.cursor);
    query = query.where("createdAt", "<", decoded);
  }

  query = query.orderBy("createdAt", "desc").limit(limit + 1);

  const rows = await query.execute();
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && items.length > 0
      ? encodeCursor(items[items.length - 1].createdAt)
      : null;

  // Get lot counts
  const auctionIds = items.map((a) => a.id);
  let lotCounts = new Map<string, number>();
  if (auctionIds.length > 0) {
    const counts = await db
      .selectFrom("lots")
      .select(["auctionId", db.fn.count("id").as("count")])
      .where("auctionId", "in", auctionIds)
      .groupBy("auctionId")
      .execute();
    lotCounts = new Map(counts.map((c) => [c.auctionId, Number(c.count)]));
  }

  return {
    items: items.map((a) => ({ ...a, lotCount: lotCounts.get(a.id) ?? 0 })),
    nextCursor,
    hasMore,
  };
}

export async function getAuction(id: string) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  const auction = await db
    .selectFrom("auctions")
    .selectAll()
    .where("id", "=", id)
    .where("organizationId", "=", orgId)
    .executeTakeFirst();

  if (!auction) throw new Error("Auction not found");
  return auction;
}

export async function createAuction(data: {
  type: string;
  title: string;
  description?: string | null;
  scheduledStartAt?: string | null;
  defaultIncrementCents: number;
  incrementRules?: string | null;
  buyerPremiumPct?: number;
  extensionSeconds?: number;
  auctioneerId?: string | null;
}) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;
  const userId = ctx.user!.id;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .insertInto("auctions")
    .values({
      id,
      organizationId: orgId,
      type: data.type,
      title: data.title,
      slug: generateSlug(data.title),
      description: data.description ?? null,
      status: "draft",
      scheduledStartAt: data.scheduledStartAt ?? null,
      actualStartAt: null,
      actualEndAt: null,
      defaultIncrementCents: data.defaultIncrementCents,
      incrementRules: data.incrementRules ?? null,
      buyerPremiumPct: data.buyerPremiumPct ?? 0,
      extensionSeconds: data.extensionSeconds ?? 0,
      streamProviderId: null,
      streamUrl: null,
      recording_key: null,
      recording_status: "none",
      auctioneerId: data.auctioneerId ?? null,
      createdByUserId: userId,
      clonedFromAuctionId: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    })
    .execute();

  // Insert initial state transition
  await db
    .insertInto("auction_state_transitions")
    .values({
      id: crypto.randomUUID(),
      auctionId: id,
      fromStatus: null,
      toStatus: "draft",
      triggeredByUserId: userId,
      reason: "Created",
      createdAt: now,
    })
    .execute();

  await logAudit("auction", id, "create", { title: data.title, type: data.type });
  return { id };
}

export async function updateAuction(
  id: string,
  data: {
    type?: string;
    title?: string;
    description?: string | null;
    scheduledStartAt?: string | null;
    defaultIncrementCents?: number;
    incrementRules?: string | null;
    buyerPremiumPct?: number;
    extensionSeconds?: number;
    auctioneerId?: string | null;
  },
  version: number,
) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  // Verify auction is draft or scheduled
  const auction = await db
    .selectFrom("auctions")
    .select(["status", "version"])
    .where("id", "=", id)
    .where("organizationId", "=", orgId)
    .executeTakeFirst();

  if (!auction) throw new Error("Auction not found");
  if (auction.status !== "draft" && auction.status !== "scheduled") {
    throw new Error("Can only edit draft or scheduled auctions");
  }

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
    version: version + 1,
  };

  if (data.type !== undefined) updates.type = data.type;
  if (data.title !== undefined) {
    updates.title = data.title;
    updates.slug = generateSlug(data.title);
  }
  if (data.description !== undefined) updates.description = data.description;
  if (data.scheduledStartAt !== undefined)
    updates.scheduledStartAt = data.scheduledStartAt;
  if (data.defaultIncrementCents !== undefined)
    updates.defaultIncrementCents = data.defaultIncrementCents;
  if (data.incrementRules !== undefined)
    updates.incrementRules = data.incrementRules;
  if (data.buyerPremiumPct !== undefined)
    updates.buyerPremiumPct = data.buyerPremiumPct;
  if (data.extensionSeconds !== undefined)
    updates.extensionSeconds = data.extensionSeconds;
  if (data.auctioneerId !== undefined)
    updates.auctioneerId = data.auctioneerId;

  const result = await db
    .updateTable("auctions")
    .set(updates)
    .where("id", "=", id)
    .where("organizationId", "=", orgId)
    .where("version", "=", version)
    .execute();

  if (!result[0]?.numUpdatedRows) {
    throw new Error("Auction not found or version conflict");
  }

  await logAudit("auction", id, "update", data);
  return { success: true };
}

export async function transitionAuctionStatus(
  id: string,
  toStatus: string,
  reason?: string,
  version?: number,
) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;
  const userId = ctx.user!.id;

  const auction = await db
    .selectFrom("auctions")
    .select(["status", "version"])
    .where("id", "=", id)
    .where("organizationId", "=", orgId)
    .executeTakeFirst();

  if (!auction) throw new Error("Auction not found");

  assertAuctionTransition(
    auction.status as AuctionStatus,
    toStatus as AuctionStatus,
  );

  const now = new Date().toISOString();

  const updates: Record<string, unknown> = {
    status: toStatus,
    updatedAt: now,
    version: (version ?? auction.version) + 1,
  };

  if (toStatus === "live") updates.actualStartAt = now;
  if (toStatus === "closed" || toStatus === "settled")
    updates.actualEndAt = now;

  await db
    .updateTable("auctions")
    .set(updates)
    .where("id", "=", id)
    .where("organizationId", "=", orgId)
    .where("version", "=", version ?? auction.version)
    .execute();

  await db
    .insertInto("auction_state_transitions")
    .values({
      id: crypto.randomUUID(),
      auctionId: id,
      fromStatus: auction.status,
      toStatus,
      triggeredByUserId: userId,
      reason: reason ?? null,
      createdAt: now,
    })
    .execute();

  await logAudit("auction", id, "transition", {
    from: auction.status,
    to: toStatus,
    reason,
  });

  return { success: true };
}

export async function deleteAuction(id: string) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  const auction = await db
    .selectFrom("auctions")
    .select("status")
    .where("id", "=", id)
    .where("organizationId", "=", orgId)
    .executeTakeFirst();

  if (!auction) throw new Error("Auction not found");
  if (auction.status !== "draft") {
    throw new Error("Can only delete draft auctions");
  }

  // Delete lots + lot_items (CASCADE in schema, but let's be explicit)
  const lots = await db
    .selectFrom("lots")
    .select("id")
    .where("auctionId", "=", id)
    .execute();

  for (const lot of lots) {
    await db.deleteFrom("lot_items").where("lotId", "=", lot.id).execute();
  }
  await db.deleteFrom("lots").where("auctionId", "=", id).execute();
  await db
    .deleteFrom("auction_state_transitions")
    .where("auctionId", "=", id)
    .execute();
  await db.deleteFrom("auctions").where("id", "=", id).execute();

  await logAudit("auction", id, "delete");
  return { success: true };
}

export async function listAuctioneers() {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  return db
    .selectFrom("memberships")
    .innerJoin("users", "users.id", "memberships.userId")
    .select([
      "users.id",
      "users.username",
      "users.displayName",
    ])
    .where("memberships.organizationId", "=", orgId)
    .where("memberships.role", "=", "auctioneer")
    .execute();
}
