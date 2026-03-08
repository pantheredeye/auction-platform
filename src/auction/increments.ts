import type { IncrementRule } from "./types";

/**
 * Resolve the bid increment for a given current bid.
 * Priority: lot override > tiered rules > auction default
 */
export function resolveIncrement(
  currentBidCents: number,
  lotOverride: number | null,
  auctionRules: IncrementRule[] | null,
  auctionDefault: number,
): number {
  if (lotOverride != null) {
    return lotOverride;
  }

  if (auctionRules && auctionRules.length > 0) {
    const sorted = [...auctionRules].sort((a, b) => a.upTo - b.upTo);
    for (const rule of sorted) {
      if (currentBidCents < rule.upTo) {
        return rule.increment;
      }
    }
    // If current bid exceeds all tiers, use the last tier's increment
    return sorted[sorted.length - 1].increment;
  }

  return auctionDefault;
}

/**
 * Validate that a bid amount meets the minimum increment.
 */
export function validateBidAmount(
  bidCents: number,
  currentHighCents: number,
  incrementCents: number,
): { valid: boolean; minimumBid: number } {
  if (bidCents <= 0) {
    return { valid: false, minimumBid: currentHighCents + incrementCents };
  }
  const minimumBid = currentHighCents + incrementCents;
  return {
    valid: bidCents >= minimumBid,
    minimumBid,
  };
}
