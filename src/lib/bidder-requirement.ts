export type BidderRequirement = "guest" | "registered" | "card_on_file";

const TIER_ORDER: Record<BidderRequirement, number> = {
  guest: 0,
  registered: 1,
  card_on_file: 2,
};

export function resolveRequirement(
  orgDefault: BidderRequirement,
  auctionOverride: BidderRequirement | null,
): BidderRequirement {
  return auctionOverride ?? orgDefault;
}

export function meetsRequirement(
  status: BidderRequirement,
  requirement: BidderRequirement,
): boolean {
  return TIER_ORDER[status] >= TIER_ORDER[requirement];
}
