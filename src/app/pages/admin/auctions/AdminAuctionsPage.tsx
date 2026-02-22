import type { RequestInfo } from "rwsdk/worker";
import { listAuctions } from "./server-functions/auctions";
import { AdminAuctionsClient } from "./AdminAuctionsClient";

export async function AdminAuctionsPage({ ctx }: RequestInfo) {
  const result = await listAuctions({});

  return (
    <AdminAuctionsClient
      initialAuctions={result.items}
      initialCursor={result.nextCursor}
      initialHasMore={result.hasMore}
    />
  );
}
