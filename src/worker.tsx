import { render, route, layout, prefix } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";
import { env } from "cloudflare:workers";

import { Document } from "@/app/Document";
import { setCommonHeaders, setLiveCSP } from "@/app/headers";
import { sessions } from "@/session/store";
import { db } from "@/db";
import { getOrCreateGuestId } from "@/app/lib/guest";
import { resolveRequirement } from "@/lib/bidder-requirement";
import { handleStripeWebhook } from "@/stripe/webhook";
import type { BidderRequirement } from "@/lib/bidder-requirement";
import type { Session } from "@/session/durableObject";
import type { User, Membership, Organization } from "@/db";

import { PublicLayout } from "@/layouts/PublicLayout";
import { AuthenticatedLayout } from "@/layouts/AuthenticatedLayout";
import { AdminLayout } from "@/layouts/AdminLayout";
import { PlatformLayout } from "@/layouts/PlatformLayout";
import { LiveLayout } from "@/layouts/LiveLayout";
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

// Admin settings page
import { AdminSettingsPage } from "@/app/pages/admin/settings/AdminSettingsPage";

// Admin auction pages
import { AdminAuctionsPage } from "@/app/pages/admin/auctions/AdminAuctionsPage";
import { AdminAuctionFormPage } from "@/app/pages/admin/auctions/AdminAuctionFormPage";
import { AdminLotsPage } from "@/app/pages/admin/auctions/AdminLotsPage";
import { AuctioneerPage } from "@/app/pages/admin/auctions/AuctioneerPage";
import { RecordingPage } from "@/app/pages/admin/auctions/RecordingPage";

// Auction pages (buyer-facing)
import { AuctionsListPage } from "@/app/pages/auctions/AuctionsListPage";
import { AuctionRoomPage } from "@/app/pages/auctions/AuctionRoomPage";

// Live pages (viewer-facing)
import { LivePage } from "@/app/pages/live/LivePage";

// Terms page
import { TermsPage } from "@/app/pages/terms/TermsPage";

// Queue consumers
import { processShopifyImport } from "@/queue/shopify-import";
import { processBidEvent } from "@/queue/bid-events";
import { processChatEvent } from "@/queue/chat-events";

// R2 image serving
import { getImage } from "@/lib/r2";

// Export Durable Objects
export { SessionDurableObject } from "@/session/durableObject";
export { AuctionRoomDO } from "@/auction/durableObject";
export { LiveStore } from "@/lib/stream/live-store";

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
    guest: { id: string; name: string | null } | null;
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

  // Stripe webhook endpoint
  async ({ request }) => {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/stripe/webhook") {
      return handleStripeWebhook(request);
    }
  },

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
  async ({ ctx, request, response }) => {
    const session = await sessions.load(request);
    ctx.session = session || null;
    ctx.guest = null;

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

    // Populate guest identity for /live/* routes when not authenticated
    if (!ctx.user) {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/live/") || url.pathname.startsWith("/ws/auction/")) {
        const guest = getOrCreateGuestId(request);
        ctx.guest = { id: guest.guestId, name: guest.guestName };
        if (guest.setCookieHeader) {
          response.headers.append("Set-Cookie", guest.setCookieHeader);
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

    if (!ctx.user && !ctx.guest) {
      return new Response("Unauthorized", { status: 401 });
    }

    const auctionId = wsMatch[1];

    const doId = env.AUCTION_ROOM.idFromName(auctionId);
    const stub = env.AUCTION_ROOM.get(doId);

    const doRequest = new Request(request.url, {
      method: request.method,
      headers: new Headers(request.headers),
    });

    // Determine bidder status
    let bidderStatus: BidderRequirement = "guest";

    if (ctx.user) {
      const isAdmin =
        ctx.currentOrganization?.role === "super_admin" ||
        ctx.currentOrganization?.role === "admin" ||
        ctx.currentOrganization?.role === "auctioneer";
      doRequest.headers.set("X-User-Id", ctx.user.id);
      doRequest.headers.set("X-Username", ctx.user.displayName ?? ctx.user.name ?? ctx.user.username);
      doRequest.headers.set("X-Is-Admin", String(isAdmin));

      // Check payment method for authenticated users
      const paymentMethod = await db
        .selectFrom("payment_methods")
        .select("id")
        .where("userId", "=", ctx.user.id)
        .where("status", "=", "active")
        .executeTakeFirst();
      bidderStatus = paymentMethod ? "card_on_file" : "registered";
    } else {
      doRequest.headers.set("X-User-Id", ctx.guest!.id);
      doRequest.headers.set("X-Username", ctx.guest!.name || "Guest");
      doRequest.headers.set("X-Is-Admin", "false");
      doRequest.headers.set("X-Is-Guest", "true");

      // Check bidder registration for guests
      const registration = await db
        .selectFrom("bidder_registrations")
        .select(["userId"])
        .where("guestId", "=", ctx.guest!.id)
        .executeTakeFirst();

      if (registration) {
        const paymentMethod = await db
          .selectFrom("payment_methods")
          .select("id")
          .where("userId", "=", registration.userId)
          .where("status", "=", "active")
          .executeTakeFirst();
        bidderStatus = paymentMethod ? "card_on_file" : "registered";
      }
    }

    doRequest.headers.set("X-Bidder-Status", bidderStatus);

    // Determine effective bidder requirement
    const auction = await db
      .selectFrom("auctions")
      .select(["bidderRequirement", "organizationId"])
      .where("id", "=", auctionId)
      .executeTakeFirst();

    if (auction) {
      const org = await db
        .selectFrom("organizations")
        .select("bidderRequirement")
        .where("id", "=", auction.organizationId)
        .executeTakeFirst();

      const effectiveRequirement = resolveRequirement(
        (org?.bidderRequirement ?? "guest") as BidderRequirement,
        (auction.bidderRequirement as BidderRequirement) ?? null,
      );
      doRequest.headers.set("X-Bidder-Requirement", effectiveRequirement);
    } else {
      doRequest.headers.set("X-Bidder-Requirement", "guest");
    }

    return stub.fetch(doRequest);
  },

  // WHIP/WHEP signaling for Cloudflare Realtime SFU
  async ({ request }) => {
    const url = new URL(request.url);
    const method = request.method;

    // CORS preflight
    if (method === "OPTIONS" && (url.pathname.startsWith("/ingest/") || url.pathname.startsWith("/play/"))) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
    };

    const callsApi = `${env.CALLS_API}/v1/apps/${env.CALLS_APP_ID}`;
    const callsAuth = { Authorization: `Bearer ${env.CALLS_APP_SECRET}` };

    // POST /ingest/:auctionId — WHIP push (auctioneer)
    const ingestMatch = url.pathname.match(/^\/ingest\/([^/]+)$/);
    if (ingestMatch && method === "POST") {
      const auctionId = ingestMatch[1];
      const offerSdp = await request.text();

      // Create Calls session
      const sessionRes = await fetch(`${callsApi}/sessions/new`, {
        method: "POST",
        headers: callsAuth,
      });
      if (!sessionRes.ok) {
        return new Response(`Calls session error: ${sessionRes.status}`, { status: 502, headers: corsHeaders });
      }
      const session = (await sessionRes.json()) as { sessionId: string };

      // Push tracks with offer SDP
      const tracksRes = await fetch(`${callsApi}/sessions/${session.sessionId}/tracks/new`, {
        method: "POST",
        headers: { ...callsAuth, "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionDescription: { type: "offer", sdp: offerSdp },
          autoDiscover: true,
        }),
      });
      if (!tracksRes.ok) {
        return new Response(`Calls tracks error: ${tracksRes.status}`, { status: 502, headers: corsHeaders });
      }
      const tracksData = (await tracksRes.json()) as {
        sessionDescription: { type: string; sdp: string };
        tracks: Array<{ trackName: string; mid: string }>;
      };

      // Store track locators in LiveStore DO
      const doId = env.LIVE_STORE.idFromName(auctionId);
      const store = env.LIVE_STORE.get(doId);
      await store.setTracks(
        tracksData.tracks.map((t) => ({
          location: "local" as const,
          sessionId: session.sessionId,
          trackName: t.trackName,
        })),
      );

      return new Response(tracksData.sessionDescription.sdp, {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/sdp", "X-Session-Id": session.sessionId },
      });
    }

    // DELETE /ingest/:auctionId — cleanup
    const ingestDeleteMatch = url.pathname.match(/^\/ingest\/([^/]+)$/);
    if (ingestDeleteMatch && method === "DELETE") {
      const auctionId = ingestDeleteMatch[1];
      const doId = env.LIVE_STORE.idFromName(auctionId);
      const store = env.LIVE_STORE.get(doId);
      // Close Calls sessions before deleting track references
      const tracks = await store.getTracks();
      const sessionIds = [...new Set(tracks.map((t) => t.sessionId))];
      await Promise.allSettled(
        sessionIds.map((sid) =>
          fetch(`${callsApi}/sessions/${sid}/close`, {
            method: "PUT",
            headers: callsAuth,
          }),
        ),
      );
      await store.deleteTracks();
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // POST /play/:auctionId — WHEP pull (viewer)
    const playMatch = url.pathname.match(/^\/play\/([^/]+)$/);
    if (playMatch && method === "POST") {
      const auctionId = playMatch[1];

      // Read track locators
      const doId = env.LIVE_STORE.idFromName(auctionId);
      const store = env.LIVE_STORE.get(doId);
      const tracks = await store.getTracks();
      if (!tracks.length) {
        return new Response("Stream not started", { status: 404, headers: corsHeaders });
      }

      const offerSdp = await request.text();

      // Create viewer session
      const sessionRes = await fetch(`${callsApi}/sessions/new`, {
        method: "POST",
        headers: callsAuth,
      });
      if (!sessionRes.ok) {
        return new Response(`Calls session error: ${sessionRes.status}`, { status: 502, headers: corsHeaders });
      }
      const session = (await sessionRes.json()) as { sessionId: string };

      // Pull remote tracks
      const tracksRes = await fetch(`${callsApi}/sessions/${session.sessionId}/tracks/new`, {
        method: "POST",
        headers: { ...callsAuth, "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionDescription: { type: "offer", sdp: offerSdp },
          tracks: tracks.map((t) => ({
            location: "remote",
            sessionId: t.sessionId,
            trackName: t.trackName,
          })),
        }),
      });
      if (!tracksRes.ok) {
        const errBody = await tracksRes.text();
        return new Response(`Calls tracks error: ${tracksRes.status} ${errBody}`, { status: 502, headers: corsHeaders });
      }
      const tracksData = (await tracksRes.json()) as {
        sessionDescription: { type: string; sdp: string };
      };

      return new Response(tracksData.sessionDescription.sdp, {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/sdp", "X-Session-Id": session.sessionId },
      });
    }

    // PATCH /play/:auctionId/:sessionId — renegotiate (WHEP spec)
    const renegMatch = url.pathname.match(/^\/play\/([^/]+)\/([^/]+)$/);
    if (renegMatch && method === "PATCH") {
      const sessionId = renegMatch[2];
      const offerSdp = await request.text();

      const res = await fetch(`${callsApi}/sessions/${sessionId}/renegotiate`, {
        method: "PUT",
        headers: { ...callsAuth, "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionDescription: { type: "offer", sdp: offerSdp },
        }),
      });
      if (!res.ok) {
        return new Response(`Renegotiate error: ${res.status}`, { status: 502, headers: corsHeaders });
      }
      const data = (await res.json()) as { sessionDescription: { sdp: string } };
      return new Response(data.sessionDescription.sdp, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/sdp" },
      });
    }
  },

  // POST /api/recordings/:auctionId/chunk — upload recording chunk to R2
  async ({ request, ctx }) => {
    const url = new URL(request.url);
    const chunkMatch = url.pathname.match(/^\/api\/recordings\/([^/]+)\/chunk$/);
    if (!chunkMatch || request.method !== "POST") return;

    // Require employee auth (return JSON errors, not redirects)
    if (!ctx.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const employeeRoles = ["super_admin", "admin", "auctioneer", "catalog_manager", "customer_service", "shipping"];
    if (!employeeRoles.includes(ctx.currentOrganization?.role ?? "")) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const auctionId = chunkMatch[1];
    const chunkIndex = url.searchParams.get("chunkIndex") ?? "0";
    const timestamp = Date.now();
    const r2Key = `recordings/${auctionId}/${timestamp}-${chunkIndex}`;

    try {
      const body = await request.arrayBuffer();
      const contentType = request.headers.get("Content-Type") || "video/webm";
      await env.IMAGES.put(r2Key, body, {
        httpMetadata: { contentType },
      });
      return Response.json({ ok: true, key: r2Key });
    } catch (err) {
      console.error("Recording chunk upload failed:", err);
      return Response.json({ error: "Upload failed" }, { status: 500 });
    }
  },

  // POST /api/recordings/:auctionId/status — update recording status (used by sendBeacon on tab close)
  async ({ request, ctx }) => {
    const url = new URL(request.url);
    const statusMatch = url.pathname.match(/^\/api\/recordings\/([^/]+)\/status$/);
    if (!statusMatch || request.method !== "POST") return;

    if (!ctx.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const employeeRoles = ["super_admin", "admin", "auctioneer", "catalog_manager", "customer_service", "shipping"];
    if (!employeeRoles.includes(ctx.currentOrganization?.role ?? "")) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const auctionId = statusMatch[1];
    const body = await request.json() as { status?: string };
    const validStatuses = ["recording", "uploading", "ready", "failed"];
    if (!body.status || !validStatuses.includes(body.status)) {
      return Response.json({ error: "Invalid status" }, { status: 400 });
    }

    try {
      const orgId = ctx.currentOrganization!.id;
      await db
        .updateTable("auctions")
        .set({ recording_status: body.status, updatedAt: new Date().toISOString() })
        .where("id", "=", auctionId)
        .where("organizationId", "=", orgId)
        .execute();
      return Response.json({ ok: true });
    } catch (err) {
      console.error("Recording status update failed:", err);
      return Response.json({ error: "Update failed" }, { status: 500 });
    }
  },

  render(Document, [
    route("/", [redirectIfAuth, Landing]),
    route("/terms", TermsPage),
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
        route("/auctions/:id/recording", [requireEmployee, RecordingPage]),
        route("/settings", [requireAdmin, AdminSettingsPage]),
      ]),
    ),
    ...prefix(
      "/platform",
      layout(PlatformLayout, [route("/", [requirePlatformAdmin, Placeholder])]),
    ),
    ...prefix("/live", layout(LiveLayout, [route("/:slug", [setLiveCSP(), LivePage])])),
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
        } else if (batch.queue.startsWith("auction-chat-events")) {
          await processChatEvent(
            message.body as import("@/auction/types").BufferedChatEvent,
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
          delaySeconds:
            batch.queue.startsWith("auction-bid-events") ||
            batch.queue.startsWith("auction-chat-events")
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
