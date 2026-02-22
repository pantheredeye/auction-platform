import type { RequestInfo } from "rwsdk/worker";
import { getAuction } from "./server-functions/auctions";
import { listLots } from "./server-functions/lots";
import { AdminLotsClient } from "./AdminLotsClient";

export async function AdminLotsPage({ ctx, params }: RequestInfo) {
  const auctionId = params!.id as string;
  const [auction, lots] = await Promise.all([
    getAuction(auctionId),
    listLots(auctionId),
  ]);

  return (
    <AdminLotsClient
      auction={auction}
      initialLots={lots}
    />
  );
}
