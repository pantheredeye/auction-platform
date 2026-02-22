"use server";
import { db } from "@/db";
import { requestInfo } from "rwsdk/worker";
import { logAudit } from "@/lib/audit";
import { encodeCursor, decodeCursor } from "@/lib/pagination";
import { uploadImage, deleteImage } from "@/lib/r2";

export async function listProducts(params: {
  cursor?: string;
  search?: string;
  categoryId?: string;
  conditionType?: string;
  isPerishable?: boolean;
  limit?: number;
}) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;
  const limit = params.limit ?? 25;

  let query = db
    .selectFrom("products")
    .selectAll()
    .where("organizationId", "=", orgId)
    .where("deletedAt", "is", null);

  if (params.search) {
    query = query.where((eb) =>
      eb.or([
        eb("title", "like", `%${params.search}%`),
        eb("sku", "like", `%${params.search}%`),
      ]),
    );
  }

  if (params.categoryId) {
    query = query.where("categoryId", "=", params.categoryId);
  }

  if (params.conditionType) {
    query = query.where("conditionType", "=", params.conditionType);
  }

  if (params.isPerishable !== undefined) {
    query = query.where("isPerishable", "=", params.isPerishable ? 1 : 0);
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

  return { items, nextCursor, hasMore };
}

export async function getProduct(id: string) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  const product = await db
    .selectFrom("products")
    .selectAll()
    .where("id", "=", id)
    .where("organizationId", "=", orgId)
    .where("deletedAt", "is", null)
    .executeTakeFirst();

  if (!product) throw new Error("Product not found");
  return product;
}

export async function createProduct(data: {
  title: string;
  description?: string | null;
  categoryId?: string | null;
  sku?: string | null;
  conditionType?: string | null;
  retailPriceCents?: number | null;
  quantity?: number;
  isPerishable?: boolean;
  expiryDate?: string | null;
  coldChainRequired?: boolean;
  storageTemp?: string | null;
  handlingInstructions?: string | null;
  tags?: string | null;
}) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const qty = data.quantity ?? 1;

  await db
    .insertInto("products")
    .values({
      id,
      organizationId: orgId,
      title: data.title,
      description: data.description ?? null,
      categoryId: data.categoryId ?? null,
      sku: data.sku ?? null,
      conditionType: data.conditionType ?? null,
      retailPriceCents: data.retailPriceCents ?? null,
      quantity: qty,
      quantityAvailable: qty,
      isPerishable: data.isPerishable ? 1 : 0,
      expiryDate: data.expiryDate ?? null,
      coldChainRequired: data.coldChainRequired ? 1 : 0,
      storageTemp: data.storageTemp ?? null,
      handlingInstructions: data.handlingInstructions ?? null,
      imageUrls: null,
      thumbnailUrl: null,
      shopifyProductId: null,
      shopifyVariantId: null,
      tags: data.tags ?? null,
      metadata: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1,
    })
    .execute();

  await logAudit("product", id, "create", { title: data.title });
  return { id };
}

export async function updateProduct(
  id: string,
  data: {
    title?: string;
    description?: string | null;
    categoryId?: string | null;
    sku?: string | null;
    conditionType?: string | null;
    retailPriceCents?: number | null;
    quantity?: number;
    isPerishable?: boolean;
    expiryDate?: string | null;
    coldChainRequired?: boolean;
    storageTemp?: string | null;
    handlingInstructions?: string | null;
    tags?: string | null;
  },
  version: number,
) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
    version: version + 1,
  };

  if (data.title !== undefined) updates.title = data.title;
  if (data.description !== undefined) updates.description = data.description;
  if (data.categoryId !== undefined) updates.categoryId = data.categoryId;
  if (data.sku !== undefined) updates.sku = data.sku;
  if (data.conditionType !== undefined)
    updates.conditionType = data.conditionType;
  if (data.retailPriceCents !== undefined)
    updates.retailPriceCents = data.retailPriceCents;
  if (data.quantity !== undefined) {
    updates.quantity = data.quantity;
    updates.quantityAvailable = data.quantity;
  }
  if (data.isPerishable !== undefined)
    updates.isPerishable = data.isPerishable ? 1 : 0;
  if (data.expiryDate !== undefined) updates.expiryDate = data.expiryDate;
  if (data.coldChainRequired !== undefined)
    updates.coldChainRequired = data.coldChainRequired ? 1 : 0;
  if (data.storageTemp !== undefined) updates.storageTemp = data.storageTemp;
  if (data.handlingInstructions !== undefined)
    updates.handlingInstructions = data.handlingInstructions;
  if (data.tags !== undefined) updates.tags = data.tags;

  const result = await db
    .updateTable("products")
    .set(updates)
    .where("id", "=", id)
    .where("organizationId", "=", orgId)
    .where("version", "=", version)
    .where("deletedAt", "is", null)
    .execute();

  if (!result[0]?.numUpdatedRows) {
    throw new Error("Product not found or version conflict");
  }

  await logAudit("product", id, "update", data);
  return { success: true };
}

export async function deleteProduct(id: string) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;
  const now = new Date().toISOString();

  await db
    .updateTable("products")
    .set({ deletedAt: now, updatedAt: now })
    .where("id", "=", id)
    .where("organizationId", "=", orgId)
    .execute();

  await logAudit("product", id, "delete");
  return { success: true };
}

export async function uploadProductImage(productId: string, file: File) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  const ext = file.name.split(".").pop() || "jpg";
  const key = `products/${orgId}/${productId}/${crypto.randomUUID()}.${ext}`;
  await uploadImage(file, key);

  // Get current images
  const product = await db
    .selectFrom("products")
    .select(["imageUrls", "thumbnailUrl"])
    .where("id", "=", productId)
    .where("organizationId", "=", orgId)
    .executeTakeFirst();

  const existing: string[] = product?.imageUrls
    ? JSON.parse(product.imageUrls)
    : [];
  existing.push(key);

  await db
    .updateTable("products")
    .set({
      imageUrls: JSON.stringify(existing),
      thumbnailUrl: product?.thumbnailUrl || key,
      updatedAt: new Date().toISOString(),
    })
    .where("id", "=", productId)
    .where("organizationId", "=", orgId)
    .execute();

  return { key };
}

export async function removeProductImage(productId: string, key: string) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  await deleteImage(key);

  const product = await db
    .selectFrom("products")
    .select(["imageUrls", "thumbnailUrl"])
    .where("id", "=", productId)
    .where("organizationId", "=", orgId)
    .executeTakeFirst();

  const existing: string[] = product?.imageUrls
    ? JSON.parse(product.imageUrls)
    : [];
  const filtered = existing.filter((k) => k !== key);

  await db
    .updateTable("products")
    .set({
      imageUrls: filtered.length ? JSON.stringify(filtered) : null,
      thumbnailUrl:
        product?.thumbnailUrl === key ? (filtered[0] ?? null) : product?.thumbnailUrl ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where("id", "=", productId)
    .where("organizationId", "=", orgId)
    .execute();

  return { success: true };
}
