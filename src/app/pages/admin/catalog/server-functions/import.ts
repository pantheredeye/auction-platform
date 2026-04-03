"use server";
import { env } from "cloudflare:workers";
import { db } from "@/db";
import { requestInfo } from "rwsdk/worker";
import { logAudit } from "@/lib/audit";
import { encrypt } from "@/lib/encrypt";

export async function startShopifyImport(data: {
  shopUrl: string;
  accessToken: string;
  collectionId?: string;
}) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;
  const userId = ctx.user!.id;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Encrypt access token before storing
  const encryptedToken = await encrypt(data.accessToken, env.AUTH_SECRET_KEY);

  await db
    .insertInto("import_jobs")
    .values({
      id,
      organizationId: orgId,
      source: "shopify",
      status: "pending",
      totalItems: 0,
      processedItems: 0,
      failedItems: 0,
      errorLog: null,
      config: JSON.stringify({
        shopUrl: data.shopUrl,
        collectionId: data.collectionId,
        encryptedAccessToken: encryptedToken,
      }),
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    })
    .execute();

  // Only send jobId — consumer reads token from DB
  await env.IMPORT_QUEUE.send({
    type: "shopify-import",
    jobId: id,
    organizationId: orgId,
  });

  await logAudit("import_job", id, "create", {
    source: "shopify",
    shopUrl: data.shopUrl,
  });

  return { id };
}

export async function getImportJob(id: string) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  return db
    .selectFrom("import_jobs")
    .selectAll()
    .where("id", "=", id)
    .where("organizationId", "=", orgId)
    .executeTakeFirst();
}

export async function listImportJobs() {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  return db
    .selectFrom("import_jobs")
    .selectAll()
    .where("organizationId", "=", orgId)
    .orderBy("createdAt", "desc")
    .limit(50)
    .execute();
}
