import type { AuctionStatus, LotStatus } from "./types";

const AUCTION_TRANSITIONS: Record<AuctionStatus, AuctionStatus[]> = {
  draft: ["scheduled", "preview", "live"],
  scheduled: ["preview", "live", "draft"],
  preview: ["live", "draft"],
  live: ["closing", "closed"],
  closing: ["closed"],
  closed: ["settled"],
  settled: ["archived"],
  archived: [],
};

const LOT_TRANSITIONS: Record<LotStatus, LotStatus[]> = {
  pending: ["active"],
  active: ["going_once", "sold", "passed", "withdrawn"],
  going_once: ["going_twice", "active", "passed", "withdrawn"],
  going_twice: ["sold", "active", "passed", "withdrawn"],
  sold: [],
  passed: [],
  withdrawn: [],
};

export function canTransitionAuction(
  from: AuctionStatus,
  to: AuctionStatus,
): boolean {
  return AUCTION_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionLot(from: LotStatus, to: LotStatus): boolean {
  return LOT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertAuctionTransition(
  from: AuctionStatus,
  to: AuctionStatus,
): void {
  if (!canTransitionAuction(from, to)) {
    throw new Error(`Invalid auction transition: ${from} → ${to}`);
  }
}

export function assertLotTransition(from: LotStatus, to: LotStatus): void {
  if (!canTransitionLot(from, to)) {
    throw new Error(`Invalid lot transition: ${from} → ${to}`);
  }
}
