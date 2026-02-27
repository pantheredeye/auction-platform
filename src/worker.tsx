import { render, route, layout, prefix } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";
import { env } from "cloudflare:workers";

import { Document } from "@/app/Document";
import { setCommonHeaders } from "@/app/headers";
import { sessions } from "@/session/store";
import { db } from "@/db";
import type { Session } from "@/session/durableObject";
import type { User, Membership, Organization } from "@/db";

import { PublicLayout } from "@/layouts/PublicLayout";
import { AuthenticatedLayout } from "@/layouts/AuthenticatedLayout";
import { AdminLayout } from "@/layouts/AdminLayout";
import { PlatformLayout } from "@/layouts/PlatformLayout";
import { Landing } from "@/app/pages/Landing";
import { Dashboard } from "@/app/pages/Dashboard";
import { Placeholder } from "@/app/pages/Placeholder";
import { authRoutes } from "@/app/pages/auth/routes";
import {
  requireAuth,
  redirectIfAuth,
  requireAdmin,
  requireEmployee,
  requirePlatformAdmin,
} from "@/app/interruptors";

// Admin catalog pages
import { AdminCatalogPage } from "@/app/pages/admin/catalog/AdminCatalogPage";
import { AdminCategoriesPage } from "@/app/pages/admin/catalog/AdminCategoriesPage";
import { AdminProductFormPage } from "@/app/pages/admin/catalog/AdminProductFormPage";
import { AdminImportPage } from "@/app/pages/admin/catalog/AdminImportPage";

// Admin auction pages
import { AdminAuctionsPage } from "@/app/pages/admin/auctions/AdminAuctionsPage";
import { AdminAuctionFormPage } from "@/app/pages/admin/auctions/AdminAuctionFormPage";
import { AdminLotsPage } from "@/app/pages/admin/auctions/AdminLotsPage";
import { AuctioneerPage } from "@/app/pages/admin/auctions/AuctioneerPage";

// Auction pages (buyer-facing)
import { AuctionsListPage } from "@/app/pages/auctions/AuctionsListPage";
import { AuctionRoomPage } from "@/app/pages/auctions/AuctionRoomPage";

// Queue consumers
import { processShopifyImport } from "@/queue/shopify-import";
import { processBidEvent } from "@/queue/bid-events";

// R2 image serving
import { getImage } from "@/lib/r2";

// Export Durable Objects
export { SessionDurableObject } from "@/session/durableObject";
export { AuctionRoomDO } from "@/auction/durableObject";

export type UserWithMemberships = User & {
  memberships: Array<
    Membership & {
      org_id: string;
      org_name: string;
      org_slug: string;
      org_type: string;
    }
  >;
};

// Extend RWSDK's DefaultAppContext via module augmentation
declare module "rwsdk/worker" {
  interface DefaultAppContext {
    session: Session | null;
    user: UserWithMemberships | null;
    currentOrganization: {
      id: string;
      name: string;
      type: string;
      role: string;
      isApproved: boolean;
    } | null;
  }
}

const app = defineApp([
  setCommonHeaders(),

  // Serve R2 images at /images/*
  async ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/images/")) {
      const key = url.pathname.slice("/images/".length);
      const image = await getImage(key);
      if (!image) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(image.body, {
        headers: {
          "Content-Type": image.contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
  },

  // Load session and populate user/org context
  async ({ ctx, request }) => {
    const session = await sessions.load(request);
    ctx.session = session || null;

    if (ctx.session?.userId) {
      const user = await db
        .selectFrom("users")
        .selectAll()
        .where("id", "=", ctx.session.userId)
        .where("deletedAt", "is", null)
        .executeTakeFirst();

      if (user) {
        const memberships = await db
          .selectFrom("memberships")
          .innerJoin(
            "organizations",
            "organizations.id",
            "memberships.organizationId",
          )
          .selectAll("memberships")
          .select([
            "organizations.id as org_id",
            "organizations.name as org_name",
            "organizations.slug as org_slug",
            "organizations.type as org_type",
          ])
          .where("memberships.userId", "=", user.id)
          .execute();

        ctx.user = { ...user, memberships };

        if (ctx.session.currentOrganizationId) {
          const membership = memberships.find(
            (m) => m.organizationId === ctx.session!.currentOrganizationId,
          );
          if (membership) {
            ctx.currentOrganization = {
              id: membership.organizationId,
              name: membership.org_name,
              type: membership.org_type,
              role: membership.role,
              isApproved: membership.isApproved === 1,
            };
          }
        }
      }
    }
  },

  // WebSocket upgrade: /ws/auction/:id → AuctionRoomDO
  async ({ request, ctx }) => {
    const url = new URL(request.url);
    const wsMatch = url.pathname.match(/^\/ws\/auction\/([^/]+)$/);
    if (!wsMatch || request.headers.get("Upgrade") !== "websocket") {
      return; // fall through to render
    }

    if (!ctx.user) {
      return new Response("Unauthorized", { status: 401 });
    }

    const auctionId = wsMatch[1];
    const isAdmin =
      ctx.currentOrganization?.role === "super_admin" ||
      ctx.currentOrganization?.role === "admin" ||
      ctx.currentOrganization?.role === "auctioneer";

    const doId = env.AUCTION_ROOM.idFromName(auctionId);
    const stub = env.AUCTION_ROOM.get(doId);

    const doRequest = new Request(request.url, {
      method: request.method,
      headers: new Headers(request.headers),
    });
    doRequest.headers.set("X-User-Id", ctx.user.id);
    doRequest.headers.set("X-Username", ctx.user.displayName ?? ctx.user.name ?? ctx.user.username);
    doRequest.headers.set("X-Is-Admin", String(isAdmin));

    return stub.fetch(doRequest);
  },

  render(Document, [
    route("/", [redirectIfAuth, Landing]),
    ...prefix("/auth", layout(PublicLayout, authRoutes)),
    ...layout(AuthenticatedLayout, [
      route("/dashboard", [requireAuth, Dashboard]),
      route("/auctions", [requireAuth, AuctionsListPage]),
      route("/auctions/:slug/live", [requireAuth, AuctionRoomPage]),
      ...prefix("/my", [
        route("/bids", [requireAuth, Placeholder]),
        route("/invoices", [requireAuth, Placeholder]),
        route("/profile", [requireAuth, Placeholder]),
      ]),
    ]),
    ...prefix(
      "/admin",
      layout(AdminLayout, [
        route("/", [requireEmployee, Placeholder]),
        route("/catalog", [requireEmployee, AdminCatalogPage]),
        route("/catalog/categories", [requireEmployee, AdminCategoriesPage]),
        route("/catalog/import", [requireEmployee, AdminImportPage]),
        route("/catalog/products/new", [requireAdmin, AdminProductFormPage]),
        route("/catalog/products/:id", [requireAdmin, AdminProductFormPage]),
        route("/auctions", [requireEmployee, AdminAuctionsPage]),
        route("/auctions/new", [requireAdmin, AdminAuctionFormPage]),
        route("/auctions/:id/edit", [requireAdmin, AdminAuctionFormPage]),
        route("/auctions/:id/lots", [requireEmployee, AdminLotsPage]),
        route("/auctions/:id/auctioneer", [requireEmployee, AuctioneerPage]),
      ]),
    ),
    ...prefix(
      "/platform",
      layout(PlatformLayout, [route("/", [requirePlatformAdmin, Placeholder])]),
    ),
  ]),
]);

export type App = typeof app;

export default {
  fetch: app.fetch,
  async queue(
    batch: MessageBatch<unknown>,
    env: Cloudflare.Env,
    ctx: ExecutionContext,
  ) {
    for (const message of batch.messages) {
      try {
        if (batch.queue.startsWith("auction-bid-events")) {
          await processBidEvent(
            message.body as import("@/auction/types").BufferedBidEvent,
            env,
          );
        } else {
          const body = message.body as { type?: string };
          if (body?.type === "shopify-import") {
            await processShopifyImport(body as any, env);
          } else {
            console.log(
              `[queue:${batch.queue}] Unknown message type`,
              message.id,
            );
          }
        }
        message.ack();
      } catch (e) {
        console.error(`[queue:${batch.queue}] Error processing message`, e);
        message.retry({
          delaySeconds: batch.queue.startsWith("auction-bid-events")
            ? Math.pow(2, message.attempts) * 5
            : undefined,
        });
      }
    }
  },
  async scheduled(
    controller: ScheduledController,
    env: Cloudflare.Env,
    ctx: ExecutionContext,
  ) {
    console.log("[cron] Scheduled event", controller.cron);
  },
};
