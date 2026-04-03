"use server";

import { env } from "cloudflare:workers";
import { requestInfo } from "rwsdk/worker";

export async function switchOrganization(organizationId: string) {
  const { ctx } = requestInfo;
  const user = ctx.user!;

  const membership = user.memberships.find(
    (m: any) => m.organizationId === organizationId,
  );

  if (!membership) {
    throw new Error("No membership in target organization");
  }

  if (!membership.isApproved) {
    throw new Error("Membership not yet approved");
  }

  // Update the existing session DO directly instead of sessions.save(),
  // which creates a new session whose Set-Cookie can't propagate from
  // a server function back through the RSC flight protocol.
  const cookieHeader = requestInfo.request.headers.get("Cookie") ?? "";
  const sessionCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("session_id="));

  if (!sessionCookie) {
    throw new Error("No session");
  }

  const packedId = sessionCookie.split("=")[1];
  const unsignedSessionId = atob(packedId).split(":")[0];
  const doId = env.SESSION_DURABLE_OBJECT.idFromName(unsignedSessionId);
  const stub = env.SESSION_DURABLE_OBJECT.get(doId);

  await stub.saveSession({
    userId: user.id,
    challenge: null,
    currentOrganizationId: organizationId,
    role: membership.role,
  });

  return { success: true };
}
