import type { RequestInfo } from "rwsdk/worker";
import { getAuctionBySlug, getGuestRegistrationStatus } from "./server-functions/live";
import { resolveRequirement, type BidderRequirement } from "@/lib/bidder-requirement";
import { LiveViewerSwitch } from "./LiveViewerSwitch";

export async function LivePage({ ctx, params, request }: RequestInfo) {
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

  // Authenticated users get a synthetic guest identity from their user record
  const guest = ctx.guest ?? (ctx.user ? { id: ctx.user.id, name: ctx.user.name } : null);
  const existingRegistration = ctx.user
    ? { registered: true, hasCard: true, userId: ctx.user.id, userName: ctx.user.name, userEmail: ctx.user.email }
    : guest
      ? await getGuestRegistrationStatus(guest.id)
      : null;
  const bidderRequirement = resolveRequirement(
    auction.orgBidderRequirement as BidderRequirement,
    (auction.auctionBidderRequirement as BidderRequirement) ?? null,
  );

  const viewMode = new URL(request.url).searchParams.get("view");

  return (
    <LiveViewerSwitch
      viewMode={viewMode}
      auction={auction}
      guest={guest}
      bidderRequirement={bidderRequirement}
      existingRegistration={existingRegistration}
      isTestMode={!!auction.isTestMode}
    />
  );
}
