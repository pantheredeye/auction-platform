import type { AuctionStatus, LotStatus, SaleMode } from "./types";

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
  going_once: ["going_twice", "sold", "active", "passed", "withdrawn"],
  going_twice: ["sold", "active", "passed", "withdrawn"],
  sold: [],
  passed: [],
  withdrawn: [],
};

// live_sell and dutch skip going_once/going_twice
const CLAIM_MODE_LOT_TRANSITIONS: Record<LotStatus, LotStatus[]> = {
  pending: ["active"],
  active: ["sold", "passed", "withdrawn"],
  going_once: [],
  going_twice: [],
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

export function canTransitionLot(from: LotStatus, to: LotStatus, saleMode?: SaleMode): boolean {
  if (saleMode === "live_sell" || saleMode === "dutch") {
    return CLAIM_MODE_LOT_TRANSITIONS[from]?.includes(to) ?? false;
  }
  return LOT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidTransitions(status: LotStatus, saleMode: SaleMode): LotStatus[] {
  if (saleMode === "live_sell" || saleMode === "dutch") {
    return CLAIM_MODE_LOT_TRANSITIONS[status] ?? [];
  }
  return LOT_TRANSITIONS[status] ?? [];
}

export function assertAuctionTransition(
  from: AuctionStatus,
  to: AuctionStatus,
): void {
  if (!canTransitionAuction(from, to)) {
    throw new Error(`Invalid auction transition: ${from} → ${to}`);
  }
}

export function assertLotTransition(from: LotStatus, to: LotStatus, saleMode?: SaleMode): void {
  if (!canTransitionLot(from, to, saleMode)) {
    throw new Error(`Invalid lot transition: ${from} → ${to}`);
  }
}
