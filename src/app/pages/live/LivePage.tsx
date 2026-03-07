import type { RequestInfo } from "rwsdk/worker";
import { getAuctionBySlug } from "./server-functions/live";
import { LiveViewerClient } from "./LiveViewerClient";

export async function LivePage({ ctx, params }: RequestInfo) {
  const slug = params!.slug as string;
  const auction = await getAuctionBySlug(slug);

  if (!auction) {
    return (
      <div className="flex items-center justify-center min-h-dvh">
        <p className="text-lg font-medium text-zinc-200">Auction not found</p>
      </div>
    );
  }

  const isLive = auction.status === "live" || auction.status === "closing";
  const isScheduled =
    auction.status === "scheduled" || auction.status === "preview";

  if (!isLive && !isScheduled) {
    return (
      <div className="flex items-center justify-center min-h-dvh">
        <p className="text-lg font-medium text-zinc-200">
          This auction has ended
        </p>
      </div>
    );
  }

  if (isScheduled) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh gap-3">
        <h1 className="text-2xl font-bold text-white">{auction.title}</h1>
        <p className="text-lg font-medium text-zinc-200">Starting soon</p>
        {auction.scheduledStartAt && (
          <p className="text-lg font-medium text-zinc-300">
            Starts{" "}
            {new Date(auction.scheduledStartAt).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        )}
      </div>
    );
  }

  const guest = ctx.guest;

  return <LiveViewerClient auction={auction} guest={guest} />;
}
