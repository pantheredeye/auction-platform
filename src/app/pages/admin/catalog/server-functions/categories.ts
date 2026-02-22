"use server";
import { db } from "@/db";
import { requestInfo } from "rwsdk/worker";
import { logAudit } from "@/lib/audit";
import { slugify } from "@/lib/slug";

export async function listCategories() {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  return db
    .selectFrom("categories")
    .selectAll()
    .where("organizationId", "=", orgId)
    .where("deletedAt", "is", null)
    .orderBy("sortOrder", "asc")
    .orderBy("name", "asc")
    .execute();
}

export async function createCategory(data: {
  name: string;
  parentId?: string | null;
  sortOrder?: number;
}) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Get max sortOrder if not provided
  let sortOrder = data.sortOrder ?? 0;
  if (!data.sortOrder) {
    const max = await db
      .selectFrom("categories")
      .select(db.fn.max("sortOrder").as("maxSort"))
      .where("organizationId", "=", orgId)
      .where("parentId", data.parentId ? "=" : "is", data.parentId ?? null)
      .where("deletedAt", "is", null)
      .executeTakeFirst();
    sortOrder = ((max?.maxSort as number) ?? 0) + 1;
  }

  await db
    .insertInto("categories")
    .values({
      id,
      organizationId: orgId,
      name: data.name,
      slug: slugify(data.name),
      parentId: data.parentId ?? null,
      sortOrder,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    .execute();

  await logAudit("category", id, "create", { name: data.name });
  return { id };
}

export async function updateCategory(
  id: string,
  data: { name?: string; parentId?: string | null; sortOrder?: number },
  version: number,
) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (data.name !== undefined) {
    updates.name = data.name;
    updates.slug = slugify(data.name);
  }
  if (data.parentId !== undefined) updates.parentId = data.parentId;
  if (data.sortOrder !== undefined) updates.sortOrder = data.sortOrder;

  const result = await db
    .updateTable("categories")
    .set(updates)
    .where("id", "=", id)
    .where("organizationId", "=", orgId)
    .where("deletedAt", "is", null)
    .execute();

  if (!result[0]?.numUpdatedRows) {
    throw new Error("Category not found or version conflict");
  }

  await logAudit("category", id, "update", data);
  return { success: true };
}

export async function deleteCategory(id: string) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;
  const now = new Date().toISOString();

  // Soft delete
  await db
    .updateTable("categories")
    .set({ deletedAt: now, updatedAt: now })
    .where("id", "=", id)
    .where("organizationId", "=", orgId)
    .execute();

  // Nullify children parentId
  await db
    .updateTable("categories")
    .set({ parentId: null, updatedAt: now })
    .where("parentId", "=", id)
    .where("organizationId", "=", orgId)
    .execute();

  await logAudit("category", id, "delete");
  return { success: true };
}

export async function reorderCategories(
  ordered: { id: string; sortOrder: number }[],
) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;
  const now = new Date().toISOString();

  for (const item of ordered) {
    await db
      .updateTable("categories")
      .set({ sortOrder: item.sortOrder, updatedAt: now })
      .where("id", "=", item.id)
      .where("organizationId", "=", orgId)
      .execute();
  }

  return { success: true };
}
