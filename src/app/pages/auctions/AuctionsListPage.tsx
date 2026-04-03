import { listLiveAuctions } from "./server-functions/browsing";
import { AuctionsListClient } from "./AuctionsListClient";

export async function AuctionsListPage() {
  const auctions = await listLiveAuctions();
  return <AuctionsListClient auctions={auctions} />;
}
