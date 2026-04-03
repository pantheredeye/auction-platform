import type { RequestInfo } from "rwsdk/worker";
import { getAuctionBySlug } from "./server-functions/browsing";
import { AuctionRoomClient } from "./AuctionRoomClient";

export async function AuctionRoomPage({ ctx, params }: RequestInfo) {
  const slug = params!.slug as string;
  const result = await getAuctionBySlug(slug);

  if (!result) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Auction not found</p>
      </div>
    );
  }

  const { auction, activeLot, upcomingLots } = result;

  return (
    <AuctionRoomClient
      auction={auction}
      initialActiveLot={activeLot}
      initialUpcomingLots={upcomingLots}
      userId={ctx.user!.id}
      username={ctx.user!.displayName ?? ctx.user!.name ?? ctx.user!.username}
    />
  );
}
