import type { RequestInfo } from "rwsdk/worker";
import { getAuction, getChatMessages } from "./server-functions/auctions";
import { RecordingClient } from "./RecordingClient";
import { RecordingRetry } from "./RecordingRetry";

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

  if (auction.recording_status === "failed") {
    return <RecordingRetry auctionId={auctionId} auctionTitle={auction.title} />;
  }

  if (auction.recording_status !== "ready") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">No recording available</p>
      </div>
    );
  }

  const recordingUrl = `/images/recordings/${auctionId}`;
  const chatMessages = await getChatMessages(auctionId);

  return (
    <RecordingClient
      recordingUrl={recordingUrl}
      auction={auction}
      chatMessages={chatMessages}
    />
  );
}
