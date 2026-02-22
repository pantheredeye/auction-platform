"use server";
import { db } from "@/db";
import { requestInfo } from "rwsdk/worker";

export async function logAudit(
  entityType: string,
  entityId: string,
  action: string,
  changes?: Record<string, unknown>,
) {
  const { ctx } = requestInfo;

  await db
    .insertInto("audit_logs")
    .values({
      id: crypto.randomUUID(),
      organizationId: ctx.currentOrganization?.id ?? "",
      userId: ctx.user?.id ?? null,
      entityType,
      entityId,
      action,
      changes: changes ? JSON.stringify(changes) : null,
      createdAt: new Date().toISOString(),
    })
    .execute();
}
