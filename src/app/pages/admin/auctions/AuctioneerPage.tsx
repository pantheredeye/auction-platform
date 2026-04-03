import type { RequestInfo } from "rwsdk/worker";
import { getAuction } from "./server-functions/auctions";
import { listLots } from "./server-functions/lots";
import { AuctioneerConsole } from "./AuctioneerConsole";

export async function AuctioneerPage({ ctx, params }: RequestInfo) {
  const auctionId = params!.id as string;

  let auction;
  try {
    auction = await getAuction(auctionId);
  } catch {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Auction not found</p>
      </div>
    );
  }

  const lots = await listLots(auctionId);

  return <AuctioneerConsole auction={auction} initialLots={lots} />;
}
