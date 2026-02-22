import type { RequestInfo } from "rwsdk/worker";
import { getPostLoginRedirect } from "@/auth/redirect";

export async function requireAuth({ ctx }: RequestInfo) {
  if (!ctx.user) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/auth/login" },
    });
  }
}

export async function redirectIfAuth({ ctx }: RequestInfo) {
  if (ctx.user) {
    const redirectTo = getPostLoginRedirect(
      ctx.user.isPlatformAdmin,
      ctx.currentOrganization?.role,
    );
    return new Response(null, {
      status: 302,
      headers: { Location: redirectTo },
    });
  }
}

export async function requirePlatformAdmin({ ctx }: RequestInfo) {
  if (!ctx.user) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/auth/login" },
    });
  }
  if (ctx.user.isPlatformAdmin !== 1) {
    return new Response("Forbidden", { status: 403 });
  }
}

export async function requireAdmin({ ctx }: RequestInfo) {
  if (!ctx.user) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/auth/login" },
    });
  }
  const role = ctx.currentOrganization?.role;
  if (role !== "super_admin" && role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }
}

export async function requireEmployee({ ctx }: RequestInfo) {
  if (!ctx.user) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/auth/login" },
    });
  }
  const employeeRoles = [
    "super_admin",
    "admin",
    "auctioneer",
    "catalog_manager",
    "customer_service",
    "shipping",
  ];
  if (!employeeRoles.includes(ctx.currentOrganization?.role ?? "")) {
    return new Response("Forbidden", { status: 403 });
  }
}

export async function requireDealer({ ctx }: RequestInfo) {
  if (!ctx.user) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/auth/login" },
    });
  }
  if (
    ctx.currentOrganization?.role !== "dealer" ||
    !ctx.currentOrganization?.isApproved
  ) {
    return new Response("Forbidden", { status: 403 });
  }
}
