"use client";

import { useState, useRef } from "react";

// ─── Types ──────────────────────────────────────────────────────────

type StreamStatus = "connecting" | "live" | "waiting" | "ended" | "error";

export interface LiveAuctionData {
  id: string;
  title: string;
  slug: string;
  status: string;
  type: string;
  scheduledStartAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  streamUrl: string | null;
  defaultIncrementCents: number;
  buyerPremiumPct: number;
  extensionSeconds: number;
  organizationId: string;
  activeLot: {
    id: string;
    lotNumber: number;
    title: string;
    description: string | null;
    startingPriceCents: number;
    currentBidCents: number | null;
    currentBidderId: string | null;
    bidCount: number;
    status: string;
    incrementCents: number | null;
    closesAt: string | null;
    thumbnailUrl: string | null;
    imageUrls: string | null;
  } | null;
}

export interface GuestInfo {
  id: string;
  name: string | null;
}

interface LiveViewerClientProps {
  auction: LiveAuctionData;
  guest: GuestInfo | null;
}

// ─── Component ──────────────────────────────────────────────────────

export function LiveViewerClient({ auction, guest }: LiveViewerClientProps) {
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
  const [muted, setMuted] = useState(true);
  const [viewerCount, setViewerCount] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  return (
    <div className="flex flex-col min-h-dvh bg-black">
      {/* Video container */}
      <div className="relative flex-1 bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className="w-full h-full object-contain"
        />

        {/* Stream status overlays */}
        {streamStatus === "connecting" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-white/60 text-lg animate-pulse">
              Connecting to stream...
            </p>
          </div>
        )}
        {streamStatus === "waiting" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-white/50 text-lg animate-pulse">
              Waiting for stream to start...
            </p>
          </div>
        )}
        {streamStatus === "ended" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-white/50 text-lg">Stream has ended</p>
          </div>
        )}
        {streamStatus === "error" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-white/50 text-lg">
              Stream disconnected — reconnecting...
            </p>
          </div>
        )}
      </div>

      {/* Status area */}
      <div className="shrink-0 bg-zinc-900 px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-white truncate">
            {auction.title}
          </h1>
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <span>{viewerCount} watching</span>
          </div>
        </div>
      </div>
    </div>
  );
}
