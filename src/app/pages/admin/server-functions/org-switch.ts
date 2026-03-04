"use server";

import { requestInfo } from "rwsdk/worker";
import { sessions } from "@/session/store";

export async function switchOrganization(organizationId: string) {
  const { ctx, response } = requestInfo;
  const user = ctx.user!;

  const membership = user.memberships.find(
    (m: any) => m.organizationId === organizationId
  );

  if (!membership) {
    throw new Error("No membership in target organization");
  }

  await sessions.save(response.headers, {
    userId: user.id,
    challenge: null,
    currentOrganizationId: organizationId,
    role: membership.role,
  });

  return { success: true };
}
