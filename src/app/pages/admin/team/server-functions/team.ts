"use server";
import { db } from "@/db";
import { requestInfo } from "rwsdk/worker";
import { logAudit } from "@/lib/audit";
import { encodeCursor, decodeCursor } from "@/lib/pagination";

const EMPLOYEE_ROLES = [
  "super_admin",
  "admin",
  "auctioneer",
  "catalog_manager",
  "customer_service",
  "shipping",
] as const;

export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export interface MemberRow {
  membershipId: string;
  userId: string;
  name: string | null;
  displayName: string | null;
  email: string | null;
  role: string;
  isApproved: number;
  approvedAt: string | null;
  memberCreatedAt: string;
}

export async function listMembers(params: {
  cursor?: string;
  limit?: number;
}) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;
  const limit = params.limit ?? 25;

  let query = db
    .selectFrom("memberships")
    .innerJoin("users", "users.id", "memberships.userId")
    .select([
      "memberships.id as membershipId",
      "memberships.userId",
      "users.name",
      "users.displayName",
      "users.email",
      "memberships.role",
      "memberships.isApproved",
      "memberships.approvedAt",
      "memberships.createdAt as memberCreatedAt",
    ])
    .where("memberships.organizationId", "=", orgId)
    .where("memberships.role", "in", [...EMPLOYEE_ROLES])
    .where("users.deletedAt", "is", null);

  if (params.cursor) {
    const decoded = decodeCursor(params.cursor);
    query = query.where("memberships.createdAt", "<", decoded);
  }

  query = query.orderBy("memberships.createdAt", "desc").limit(limit + 1);

  const rows = await query.execute();
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && items.length > 0
      ? encodeCursor(items[items.length - 1].memberCreatedAt)
      : null;

  return { items, nextCursor, hasMore };
}

export async function updateMemberRole(
  membershipId: string,
  newRole: string,
) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;
  const currentUserId = ctx.user!.id;

  if (!EMPLOYEE_ROLES.includes(newRole as EmployeeRole)) {
    throw new Error("Invalid role");
  }

  // Fetch the membership
  const membership = await db
    .selectFrom("memberships")
    .selectAll()
    .where("id", "=", membershipId)
    .where("organizationId", "=", orgId)
    .executeTakeFirst();

  if (!membership) throw new Error("Member not found");
  if (membership.userId === currentUserId) {
    throw new Error("Cannot change your own role");
  }

  // Guard: don't leave zero super_admins
  if (membership.role === "super_admin" && newRole !== "super_admin") {
    const superAdminCount = await db
      .selectFrom("memberships")
      .select(db.fn.count("id").as("count"))
      .where("organizationId", "=", orgId)
      .where("role", "=", "super_admin")
      .executeTakeFirstOrThrow();
    if (Number(superAdminCount.count) <= 1) {
      throw new Error("Cannot remove the last super admin");
    }
  }

  await db
    .updateTable("memberships")
    .set({ role: newRole })
    .where("id", "=", membershipId)
    .where("organizationId", "=", orgId)
    .execute();

  await logAudit("membership", membershipId, "update_role", {
    oldRole: membership.role,
    newRole,
    userId: membership.userId,
  });

  return { success: true };
}

export async function removeMember(membershipId: string) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;
  const currentUserId = ctx.user!.id;

  const membership = await db
    .selectFrom("memberships")
    .selectAll()
    .where("id", "=", membershipId)
    .where("organizationId", "=", orgId)
    .executeTakeFirst();

  if (!membership) throw new Error("Member not found");
  if (membership.userId === currentUserId) {
    throw new Error("Cannot remove yourself");
  }

  if (membership.role === "super_admin") {
    const superAdminCount = await db
      .selectFrom("memberships")
      .select(db.fn.count("id").as("count"))
      .where("organizationId", "=", orgId)
      .where("role", "=", "super_admin")
      .executeTakeFirstOrThrow();
    if (Number(superAdminCount.count) <= 1) {
      throw new Error("Cannot remove the last super admin");
    }
  }

  await db
    .deleteFrom("memberships")
    .where("id", "=", membershipId)
    .where("organizationId", "=", orgId)
    .execute();

  await logAudit("membership", membershipId, "remove", {
    role: membership.role,
    userId: membership.userId,
  });

  return { success: true };
}

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = "";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

export async function createInvite(params: {
  role: string;
  expiresInHours?: number;
}) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;
  const userId = ctx.user!.id;

  if (!EMPLOYEE_ROLES.includes(params.role as EmployeeRole)) {
    throw new Error("Invalid role");
  }

  // Only super_admin can invite super_admin
  if (
    params.role === "super_admin" &&
    ctx.currentOrganization!.role !== "super_admin"
  ) {
    throw new Error("Only super admins can invite super admins");
  }

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + (params.expiresInHours ?? 72) * 60 * 60 * 1000,
  );
  const code = generateCode();
  const id = crypto.randomUUID();

  await db
    .insertInto("invite_codes")
    .values({
      id,
      organizationId: orgId,
      code,
      role: params.role,
      createdByUserId: userId,
      usedByUserId: null,
      usedAt: null,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
    })
    .execute();

  await logAudit("invite", id, "create", { role: params.role, code });

  return { id, code };
}

export interface InviteRow {
  id: string;
  code: string;
  role: string;
  createdByName: string | null;
  expiresAt: string;
  createdAt: string;
}

export async function listInvites(): Promise<InviteRow[]> {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;
  const now = new Date().toISOString();

  const rows = await db
    .selectFrom("invite_codes")
    .innerJoin("users", "users.id", "invite_codes.createdByUserId")
    .select([
      "invite_codes.id",
      "invite_codes.code",
      "invite_codes.role",
      "users.name as createdByName",
      "invite_codes.expiresAt",
      "invite_codes.createdAt",
    ])
    .where("invite_codes.organizationId", "=", orgId)
    .where("invite_codes.usedByUserId", "is", null)
    .where("invite_codes.expiresAt", ">", now)
    .orderBy("invite_codes.createdAt", "desc")
    .execute();

  return rows;
}

export async function revokeInvite(inviteId: string) {
  const { ctx } = requestInfo;
  const orgId = ctx.currentOrganization!.id;

  await db
    .deleteFrom("invite_codes")
    .where("id", "=", inviteId)
    .where("organizationId", "=", orgId)
    .execute();

  await logAudit("invite", inviteId, "revoke");

  return { success: true };
}

export async function redeemInvite(code: string) {
  const { ctx } = requestInfo;
  const userId = ctx.user!.id;
  const now = new Date().toISOString();

  const invite = await db
    .selectFrom("invite_codes")
    .selectAll()
    .where("code", "=", code)
    .executeTakeFirst();

  if (!invite) throw new Error("Invalid invite code");
  if (invite.usedByUserId) throw new Error("Invite already used");
  if (invite.expiresAt < now) throw new Error("Invite has expired");

  // Check if user already has a membership in this org
  const existing = await db
    .selectFrom("memberships")
    .selectAll()
    .where("userId", "=", userId)
    .where("organizationId", "=", invite.organizationId)
    .executeTakeFirst();

  if (existing) {
    throw new Error("You are already a member of this organization");
  }

  // Create membership
  await db
    .insertInto("memberships")
    .values({
      id: crypto.randomUUID(),
      userId,
      organizationId: invite.organizationId,
      role: invite.role,
      isApproved: 1,
      approvedAt: now,
      approvedByUserId: invite.createdByUserId,
      createdAt: now,
    })
    .execute();

  // Mark invite as used
  await db
    .updateTable("invite_codes")
    .set({ usedByUserId: userId, usedAt: now })
    .where("id", "=", invite.id)
    .execute();

  await logAudit("membership", userId, "invite_redeemed", {
    inviteId: invite.id,
    role: invite.role,
    organizationId: invite.organizationId,
  });

  return { organizationId: invite.organizationId, role: invite.role };
}
