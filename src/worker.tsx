import { render, route, layout, prefix } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";

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

  render(Document, [
    route("/", [redirectIfAuth, Landing]),
    ...prefix("/auth", layout(PublicLayout, authRoutes)),
    ...layout(AuthenticatedLayout, [
      route("/dashboard", [requireAuth, Dashboard]),
      route("/auctions", [requireAuth, Placeholder]),
      ...prefix("/my", [
        route("/bids", [requireAuth, Placeholder]),
        route("/invoices", [requireAuth, Placeholder]),
        route("/profile", [requireAuth, Placeholder]),
      ]),
    ]),
    ...prefix(
      "/admin",
      layout(AdminLayout, [route("/", [requireEmployee, Placeholder])]),
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
      console.log(`[queue:${batch.queue}] Processing message`, message.id);
      message.ack();
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
