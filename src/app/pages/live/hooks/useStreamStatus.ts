import { useState, useCallback } from "react";
import type { AuctionStatus, LotStatus } from "@/auction/types";

// ─── Types ──────────────────────────────────────────────────────────

export type StreamStatus = "connecting" | "live" | "waiting" | "ended" | "error";

export interface CurrentLotData {
  id: string;
  status: LotStatus;
  currentBidCents: number | null;
  currentBidderId: string | null;
  currentBidderName: string | null;
  bidCount: number;
}

// ─── Helpers ────────────────────────────────────────────────────────

export function auctionStatusToStreamStatus(status: AuctionStatus, hasActiveStream: boolean): StreamStatus {
  switch (status) {
    case "live":
    case "closing":
      return hasActiveStream ? "live" : "connecting";
    case "draft":
    case "scheduled":
    case "preview":
      return "waiting";
    case "closed":
    case "settled":
    case "archived":
      return "ended";
    default:
      return "waiting";
  }
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

// ─── Hook ───────────────────────────────────────────────────────────

export function useStreamStatus(initialAuctionStatus: AuctionStatus) {
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
  const [auctionStatus, setAuctionStatus] = useState<AuctionStatus>(initialAuctionStatus);
  const [viewerCount, setViewerCount] = useState(0);
  const [currentLot, setCurrentLot] = useState<CurrentLotData | null>(null);

  const handleAuctionUpdate = useCallback((status: AuctionStatus, whepConnected: boolean) => {
    setAuctionStatus(status);
    const derived = auctionStatusToStreamStatus(status, whepConnected);
    setStreamStatus((prev) => {
      if (prev === "error") return prev;
      if (prev === "live" && derived === "connecting") return "live";
      return derived;
    });
  }, []);

  const handleLotUpdate = useCallback((
    lotId: string,
    status: LotStatus,
    currentBidCents: number | null,
    currentBidderId: string | null,
    currentBidderName: string | null,
    bidCount: number,
    onLotCleared?: () => void,
  ) => {
    const isActive = status === "active" || status === "going_once" || status === "going_twice";
    if (isActive) {
      setCurrentLot({
        id: lotId,
        status,
        currentBidCents,
        currentBidderId,
        currentBidderName,
        bidCount,
      });
    } else {
      setCurrentLot((prev) => {
        if (prev?.id === lotId) {
          onLotCleared?.();
          return null;
        }
        return prev;
      });
    }
  }, []);

  const handleViewerCount = useCallback((count: number) => {
    setViewerCount(count);
  }, []);

  return {
    streamStatus,
    setStreamStatus,
    auctionStatus,
    viewerCount,
    currentLot,
    handleAuctionUpdate,
    handleLotUpdate,
    handleViewerCount,
  };
}
