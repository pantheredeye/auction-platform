"use client";

import type { CurrentLotData, StreamStatus } from "./hooks/useStreamStatus";

interface OverlayHeaderProps {
  currentLot: CurrentLotData | null;
  streamStatus: StreamStatus;
  viewerCount: number;
  auctionTitle: string;
  isTestMode?: boolean;
}

export function OverlayHeader({ currentLot, streamStatus, viewerCount, auctionTitle, isTestMode }: OverlayHeaderProps) {
  const hasActiveLot = currentLot && currentLot.status !== "pending";

  return (
    <div
      className={`fixed ${isTestMode ? "top-7" : "top-0"} left-0 right-0 z-20 flex items-center justify-between h-12 px-4 md:px-8 pt-[env(safe-area-inset-top)] bg-black/40 backdrop-blur-sm motion-safe:transition-opacity duration-300 ${hasActiveLot ? "opacity-100" : "opacity-0"}`}
    >
      <span className="text-lg font-semibold text-white truncate mr-4">
        {currentLot ? currentLot.id : auctionTitle}
      </span>
      <div className="flex items-center gap-3 shrink-0">
        {streamStatus === "live" && (
          <span className="inline-flex items-center gap-1.5 rounded bg-green-600 px-2.5 py-1 text-sm font-semibold text-white uppercase tracking-wide">
            <span className="inline-block h-2 w-2 rounded-full bg-white animate-pulse" aria-hidden="true" />
            Live
          </span>
        )}
        <span className="text-lg text-zinc-300">{viewerCount} watching</span>
      </div>
    </div>
  );
}
