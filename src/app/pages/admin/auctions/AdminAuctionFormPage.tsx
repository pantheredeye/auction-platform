import type { RequestInfo } from "rwsdk/worker";
import { getAuction, listAuctioneers } from "./server-functions/auctions";
import { AdminAuctionFormClient } from "./AdminAuctionFormClient";

export async function AdminAuctionFormPage({ ctx, params }: RequestInfo) {
  const auctionId = params?.id as string | undefined;
  const auctioneers = await listAuctioneers();

  let auction = null;
  if (auctionId) {
    auction = await getAuction(auctionId);
  }

  return (
    <AdminAuctionFormClient auction={auction} auctioneers={auctioneers} />
  );
}
