import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import type { AppDatabase } from "@/db";
import type { BufferedChatEvent } from "@/auction/types";

export async function processChatEvent(
  event: BufferedChatEvent,
  env: Cloudflare.Env,
) {
  const db = new Kysely<AppDatabase>({
    dialect: new D1Dialect({ database: env.DB }),
  });

  // Look up organizationId from auction
  const auction = await db
    .selectFrom("auctions")
    .select("organizationId")
    .where("id", "=", event.auctionId)
    .executeTakeFirst();

  if (!auction) {
    throw new Error(`Auction not found: ${event.auctionId}`);
  }

  // Insert chat message (INSERT OR IGNORE for idempotency via unique id)
  await db
    .insertInto("chat_messages")
    .values({
      id: event.id,
      organizationId: auction.organizationId,
      auctionId: event.auctionId,
      userId: event.userId,
      type: "message",
      content: event.content,
      isModerated: 0,
      moderatedByUserId: null,
      moderatedAt: null,
      createdAt: event.createdAt,
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();
}
