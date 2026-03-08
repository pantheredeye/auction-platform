import type { RequestInfo } from "rwsdk/worker";
import { getAuction } from "./server-functions/auctions";
import { RecordingClient } from "./RecordingClient";

export async function RecordingPage({ ctx, params }: RequestInfo) {
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

  if (auction.recording_status !== "ready") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">No recording available</p>
      </div>
    );
  }

  const recordingUrl = `/images/recordings/${auctionId}`;

  return <RecordingClient recordingUrl={recordingUrl} auction={auction} />;
}
