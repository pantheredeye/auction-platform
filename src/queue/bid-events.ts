import { Kysely, sql } from "kysely";
import { D1Dialect } from "kysely-d1";
import type { AppDatabase } from "@/db";
import type { BufferedBidEvent } from "@/auction/types";

export async function processBidEvent(
  event: BufferedBidEvent,
  env: Cloudflare.Env,
) {
  const db = new Kysely<AppDatabase>({
    dialect: new D1Dialect({ database: env.DB }),
  });

  // Look up organizationId from lot
  const lot = await db
    .selectFrom("lots")
    .select("organizationId")
    .where("id", "=", event.lotId)
    .executeTakeFirst();

  if (!lot) {
    throw new Error(`Lot not found: ${event.lotId}`);
  }

  // Insert bid event (INSERT OR IGNORE for idempotency via unique idempotencyKey)
  const result = await db
    .insertInto("bid_events")
    .values({
      id: crypto.randomUUID(),
      organizationId: lot.organizationId,
      auctionId: event.auctionId,
      lotId: event.lotId,
      userId: event.userId,
      type: event.type,
      amountCents: event.amountCents,
      previousHighCents: event.previousHighCents,
      previousHighUserId: event.previousHighUserId,
      onBehalfOfName: event.onBehalfOfName,
      placedByUserId: event.placedByUserId,
      idempotencyKey: event.idempotencyKey,
      sequence: event.sequence,
      metadata: null,
      createdAt: event.createdAt,
    })
    .onConflict((oc) => oc.column("idempotencyKey").doNothing())
    .executeTakeFirst();

  // If insert was a no-op (duplicate idempotencyKey), skip updates
  if (result.numInsertedOrUpdatedRows === 0n) {
    return;
  }

  const now = new Date().toISOString();

  // Update lot denormalized fields
  if (event.type === "claim") {
    // Claim: increment quantityClaimed + bidCount, don't touch currentBidCents/currentBidderId
    await db
      .updateTable("lots")
      .set({
        quantityClaimed: sql`quantityClaimed + 1`,
        bidCount: sql`bidCount + 1`,
        version: sql`version + 1`,
        updatedAt: now,
      })
      .where("id", "=", event.lotId)
      .execute();
  } else {
    // Bid/floor_bid: only update if this bid is higher than current
    await db
      .updateTable("lots")
      .set({
        currentBidCents: event.amountCents,
        currentBidderId: event.userId,
        bidCount: sql`bidCount + 1`,
        version: sql`version + 1`,
        updatedAt: now,
      })
      .where("id", "=", event.lotId)
      .where((eb) =>
        eb.or([
          eb("currentBidCents", "is", null),
          eb("currentBidCents", "<", event.amountCents),
        ]),
      )
      .execute();
  }

  // Increment totalBids in auction_summaries
  await db
    .updateTable("auction_summaries")
    .set({
      totalBids: sql`totalBids + 1`,
      updatedAt: now,
    })
    .where("auctionId", "=", event.auctionId)
    .execute();
}
