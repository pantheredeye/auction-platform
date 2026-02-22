"use server";
import { db } from "@/db";
import { sql } from "kysely";
import { requestInfo } from "rwsdk/worker";
import { logAudit } from "@/lib/audit";

export async function listLots(auctionId: string) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  const lots = await db
    .selectFrom("lots")
    .selectAll()
    .where("auctionId", "=", auctionId)
    .where("organizationId", "=", orgId)
    .orderBy("lotNumber", "asc")
    .execute();

  // Get lot items with product info
  const lotIds = lots.map((l) => l.id);
  let itemsMap = new Map<
    string,
    { id: string; productId: string; quantity: number; title: string; sku: string | null; thumbnailUrl: string | null }[]
  >();

  if (lotIds.length > 0) {
    const items = await db
      .selectFrom("lot_items")
      .innerJoin("products", "products.id", "lot_items.productId")
      .select([
        "lot_items.id",
        "lot_items.lotId",
        "lot_items.productId",
        "lot_items.quantity",
        "lot_items.sortOrder",
        "products.title",
        "products.sku",
        "products.thumbnailUrl",
      ])
      .where("lot_items.lotId", "in", lotIds)
      .orderBy("lot_items.sortOrder", "asc")
      .execute();

    for (const item of items) {
      if (!itemsMap.has(item.lotId)) itemsMap.set(item.lotId, []);
      itemsMap.get(item.lotId)!.push({
        id: item.id,
        productId: item.productId,
        quantity: item.quantity,
        title: item.title,
        sku: item.sku,
        thumbnailUrl: item.thumbnailUrl,
      });
    }
  }

  return lots.map((lot) => ({
    ...lot,
    items: itemsMap.get(lot.id) ?? [],
  }));
}

export async function createLot(
  auctionId: string,
  data: {
    title: string;
    description?: string | null;
    startingPriceCents: number;
    reservePriceCents?: number | null;
    buyNowPriceCents?: number | null;
    incrementCents?: number | null;
    quantity?: number;
    extensionSeconds?: number | null;
  },
) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  // Verify auction is draft/scheduled
  const auction = await db
    .selectFrom("auctions")
    .select("status")
    .where("id", "=", auctionId)
    .where("organizationId", "=", orgId)
    .executeTakeFirst();

  if (!auction) throw new Error("Auction not found");

  // Get next lot number
  const maxLot = await db
    .selectFrom("lots")
    .select(db.fn.max("lotNumber").as("maxNum"))
    .where("auctionId", "=", auctionId)
    .executeTakeFirst();

  const lotNumber = ((maxLot?.maxNum as number) ?? 0) + 1;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .insertInto("lots")
    .values({
      id,
      organizationId: orgId,
      auctionId,
      lotNumber,
      title: data.title,
      description: data.description ?? null,
      startingPriceCents: data.startingPriceCents,
      reservePriceCents: data.reservePriceCents ?? null,
      buyNowPriceCents: data.buyNowPriceCents ?? null,
      incrementCents: data.incrementCents ?? null,
      currentBidCents: null,
      currentBidderId: null,
      bidCount: 0,
      status: "pending",
      quantity: data.quantity ?? 1,
      extensionSeconds: data.extensionSeconds ?? null,
      closesAt: null,
      winnerUserId: null,
      winnerAmountCents: null,
      imageUrls: null,
      thumbnailUrl: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    })
    .execute();

  await logAudit("lot", id, "create", {
    auctionId,
    title: data.title,
    lotNumber,
  });

  return { id, lotNumber };
}

export async function updateLot(
  id: string,
  data: {
    title?: string;
    description?: string | null;
    startingPriceCents?: number;
    reservePriceCents?: number | null;
    buyNowPriceCents?: number | null;
    incrementCents?: number | null;
    quantity?: number;
    extensionSeconds?: number | null;
  },
  version: number,
) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  // Verify auction is draft/scheduled
  const lot = await db
    .selectFrom("lots")
    .innerJoin("auctions", "auctions.id", "lots.auctionId")
    .select(["auctions.status as auctionStatus", "lots.version"])
    .where("lots.id", "=", id)
    .where("lots.organizationId", "=", orgId)
    .executeTakeFirst();

  if (!lot) throw new Error("Lot not found");
  if (lot.auctionStatus !== "draft" && lot.auctionStatus !== "scheduled") {
    throw new Error("Can only edit lots in draft/scheduled auctions");
  }

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
    version: version + 1,
  };

  if (data.title !== undefined) updates.title = data.title;
  if (data.description !== undefined) updates.description = data.description;
  if (data.startingPriceCents !== undefined)
    updates.startingPriceCents = data.startingPriceCents;
  if (data.reservePriceCents !== undefined)
    updates.reservePriceCents = data.reservePriceCents;
  if (data.buyNowPriceCents !== undefined)
    updates.buyNowPriceCents = data.buyNowPriceCents;
  if (data.incrementCents !== undefined)
    updates.incrementCents = data.incrementCents;
  if (data.quantity !== undefined) updates.quantity = data.quantity;
  if (data.extensionSeconds !== undefined)
    updates.extensionSeconds = data.extensionSeconds;

  const result = await db
    .updateTable("lots")
    .set(updates)
    .where("id", "=", id)
    .where("organizationId", "=", orgId)
    .where("version", "=", version)
    .execute();

  if (!result[0]?.numUpdatedRows) {
    throw new Error("Lot not found or version conflict");
  }

  await logAudit("lot", id, "update", data);
  return { success: true };
}

export async function deleteLot(id: string) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  // Verify auction is draft
  const lot = await db
    .selectFrom("lots")
    .innerJoin("auctions", "auctions.id", "lots.auctionId")
    .select(["auctions.status as auctionStatus", "lots.id"])
    .where("lots.id", "=", id)
    .where("lots.organizationId", "=", orgId)
    .executeTakeFirst();

  if (!lot) throw new Error("Lot not found");
  if (lot.auctionStatus !== "draft") {
    throw new Error("Can only delete lots from draft auctions");
  }

  // Restore product quantities from lot items
  const items = await db
    .selectFrom("lot_items")
    .selectAll()
    .where("lotId", "=", id)
    .execute();

  for (const item of items) {
    await db
      .updateTable("products")
      .set({
        quantityAvailable: sql`quantityAvailable + ${item.quantity}`,
      })
      .where("id", "=", item.productId)
      .execute()
      .catch(() => {});
  }

  await db.deleteFrom("lot_items").where("lotId", "=", id).execute();
  await db.deleteFrom("lots").where("id", "=", id).execute();

  await logAudit("lot", id, "delete");
  return { success: true };
}

export async function reorderLots(
  auctionId: string,
  ordered: { id: string; lotNumber: number }[],
) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;
  const now = new Date().toISOString();

  for (const item of ordered) {
    await db
      .updateTable("lots")
      .set({ lotNumber: item.lotNumber, updatedAt: now })
      .where("id", "=", item.id)
      .where("organizationId", "=", orgId)
      .where("auctionId", "=", auctionId)
      .execute();
  }

  return { success: true };
}

export async function addLotItem(
  lotId: string,
  productId: string,
  quantity: number,
) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  // Get max sortOrder
  const maxSort = await db
    .selectFrom("lot_items")
    .select(db.fn.max("sortOrder").as("maxSort"))
    .where("lotId", "=", lotId)
    .executeTakeFirst();

  const sortOrder = ((maxSort?.maxSort as number) ?? 0) + 1;
  const id = crypto.randomUUID();

  await db
    .insertInto("lot_items")
    .values({
      id,
      lotId,
      productId,
      quantity,
      sortOrder,
    })
    .execute();

  // Decrement quantityAvailable
  await db
    .updateTable("products")
    .set({
      quantityAvailable: sql`MAX(quantityAvailable - ${quantity}, 0)`,
      updatedAt: new Date().toISOString(),
    })
    .where("id", "=", productId)
    .where("organizationId", "=", orgId)
    .execute()
    .catch(() => {});

  // Auto-inherit thumbnail if lot has no image
  const lot = await db
    .selectFrom("lots")
    .select("thumbnailUrl")
    .where("id", "=", lotId)
    .executeTakeFirst();

  if (!lot?.thumbnailUrl) {
    const product = await db
      .selectFrom("products")
      .select("thumbnailUrl")
      .where("id", "=", productId)
      .executeTakeFirst();

    if (product?.thumbnailUrl) {
      await db
        .updateTable("lots")
        .set({ thumbnailUrl: product.thumbnailUrl })
        .where("id", "=", lotId)
        .execute();
    }
  }

  await logAudit("lot_item", id, "create", { lotId, productId, quantity });
  return { id };
}

export async function removeLotItem(lotItemId: string) {
  const item = await db
    .selectFrom("lot_items")
    .selectAll()
    .where("id", "=", lotItemId)
    .executeTakeFirst();

  if (!item) throw new Error("Lot item not found");

  // Restore quantityAvailable
  await db
    .updateTable("products")
    .set({
      quantityAvailable: sql`quantityAvailable + ${item.quantity}`,
      updatedAt: new Date().toISOString(),
    })
    .where("id", "=", item.productId)
    .execute()
    .catch(() => {});

  await db.deleteFrom("lot_items").where("id", "=", lotItemId).execute();

  await logAudit("lot_item", lotItemId, "delete", {
    lotId: item.lotId,
    productId: item.productId,
  });

  return { success: true };
}

export async function searchProducts(query: string, limit: number = 10) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  return db
    .selectFrom("products")
    .select([
      "id",
      "title",
      "sku",
      "thumbnailUrl",
      "quantityAvailable",
      "retailPriceCents",
    ])
    .where("organizationId", "=", orgId)
    .where("deletedAt", "is", null)
    .where("quantityAvailable", ">", 0)
    .where((eb) =>
      eb.or([
        eb("title", "like", `%${query}%`),
        eb("sku", "like", `%${query}%`),
      ]),
    )
    .orderBy("title", "asc")
    .limit(limit)
    .execute();
}
