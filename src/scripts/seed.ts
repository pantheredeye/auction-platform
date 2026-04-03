import { db } from "@/db";

export default async () => {
  console.log("Seeding M&M Auctions organization...");

  const orgId = crypto.randomUUID();
  await db
    .insertInto("organizations")
    .values({
      id: orgId,
      name: "M&M Auctions",
      slug: "mm-auctions",
      type: "auction_house",
      hammerFeePct: 300,
      bidderRequirement: "guest",
      stripeConnectAccountId: null,
      stripeChargesEnabled: 0,
      streamGracePeriodSec: 90,
      slateImageUrl: null,
      testMode: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .execute();

  console.log("Done: M&M Auctions org created");
};
