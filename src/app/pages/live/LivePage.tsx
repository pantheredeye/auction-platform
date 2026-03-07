import type { RequestInfo } from "rwsdk/worker";
import { getAuctionBySlug } from "./server-functions/live";

export async function LivePage({ ctx, params }: RequestInfo) {
  const slug = params!.slug as string;
  const auction = await getAuctionBySlug(slug);

  if (!auction) {
    return (
      <div className="flex items-center justify-center min-h-dvh">
        <p className="text-lg text-zinc-400">Auction not found</p>
      </div>
    );
  }

  const isLive = auction.status === "live" || auction.status === "closing";
  const isScheduled =
    auction.status === "scheduled" || auction.status === "preview";

  if (!isLive && !isScheduled) {
    return (
      <div className="flex items-center justify-center min-h-dvh">
        <p className="text-lg text-zinc-400">This auction has ended</p>
      </div>
    );
  }

  if (isScheduled) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh gap-3">
        <h1 className="text-2xl font-bold">{auction.title}</h1>
        <p className="text-lg text-zinc-400">Coming soon</p>
        {auction.scheduledStartAt && (
          <p className="text-sm text-zinc-500">
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

  return (
    <div data-live-auction data-slug={slug}>
      {/* LiveViewerClient will replace this once implemented */}
      <div className="flex items-center justify-center min-h-dvh">
        <p className="text-lg text-zinc-400">
          Live auction: {auction.title}
        </p>
      </div>
    </div>
  );
}
