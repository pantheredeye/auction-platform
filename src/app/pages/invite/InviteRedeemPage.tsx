import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { redeemInvite } from "@/app/pages/admin/team/server-functions/team";

export async function InviteRedeemPage({ ctx, request, params }: RequestInfo) {
  const code = params.code as string;

  if (!ctx.user) {
    return new Response(null, {
      status: 302,
      headers: { Location: `/auth/login?returnTo=/invite/${code}` },
    });
  }

  try {
    const result = await redeemInvite(code);

    // Switch session to the new org via the session DO
    const cookieHeader = request.headers.get("Cookie") ?? "";
    const sessionCookie = cookieHeader
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("session_id="));

    if (sessionCookie) {
      const packedId = sessionCookie.split("=")[1];
      const unsignedSessionId = atob(packedId).split(":")[0];
      const doId = env.SESSION_DURABLE_OBJECT.idFromName(unsignedSessionId);
      const stub = env.SESSION_DURABLE_OBJECT.get(doId);

      await stub.saveSession({
        userId: ctx.user.id,
        challenge: null,
        currentOrganizationId: result.organizationId,
        role: result.role,
      });
    }

    return new Response(null, {
      status: 302,
      headers: { Location: "/admin" },
    });
  } catch (e: any) {
    const message = encodeURIComponent(e.message || "Invalid invite");
    return new Response(null, {
      status: 302,
      headers: { Location: `/auth/login?error=${message}` },
    });
  }
}
