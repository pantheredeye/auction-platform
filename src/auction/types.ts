// ─── Enums as string unions ─────────────────────────────────────────

export type AuctionStatus =
  | "draft"
  | "scheduled"
  | "preview"
  | "live"
  | "closing"
  | "closed"
  | "settled"
  | "archived";

export type LotStatus =
  | "pending"
  | "active"
  | "going_once"
  | "going_twice"
  | "sold"
  | "passed"
  | "withdrawn";

export type AuctionType = "live_consumer" | "dealer_bulk" | "buy_now";

export type BidEventType =
  | "bid"
  | "auto_bid"
  | "retract"
  | "system_extend"
  | "floor_bid";

export type MembershipRole =
  | "super_admin"
  | "admin"
  | "auctioneer"
  | "catalog_manager"
  | "customer_service"
  | "shipping"
  | "dealer"
  | "consumer";

export interface IncrementRule {
  upTo: number;
  increment: number;
}

// ─── DO state ───────────────────────────────────────────────────────

export interface LotState {
  id: string;
  lotNumber: number;
  title: string;
  description: string;
  imageUrl: string;
  startingPriceCents: number;
  currentBidCents: number;
  currentBidderId: string | null;
  currentBidderName: string | null;
  bidCount: number;
  incrementCents: number | null;
  status: LotStatus;
  sequence: number;
}

export interface AuctionRoomState {
  auctionId: string;
  organizationId: string;
  status: AuctionStatus;
  lots: Map<string, LotState>;
  currentLotId: string | null;
  viewerCount: number;
  connectedUsers: Set<string>;
  defaultIncrementCents: number;
  incrementRules: IncrementRule[];
}

export interface BufferedBidEvent {
  auctionId: string;
  lotId: string;
  userId: string;
  type: BidEventType;
  amountCents: number;
  previousHighCents: number;
  previousHighUserId: string | null;
  onBehalfOfName: string | null;
  placedByUserId: string | null;
  idempotencyKey: string;
  sequence: number;
  createdAt: string;
}

// ─── WebSocket messages ─────────────────────────────────────────────

export type ClientMessage =
  | { type: "bid"; lotId: string; amountCents: number; idempotencyKey: string }
  | { type: "chat"; content: string }
  | { type: "ping" };

export type ServerMessage =
  | { type: "bid_accepted"; lotId: string; amountCents: number; userId: string; bidCount: number }
  | { type: "bid_rejected"; lotId: string; reason: string }
  | { type: "lot_update"; lotId: string; status: LotStatus; currentBidCents: number | null; currentBidderId: string | null; bidCount: number }
  | { type: "auction_update"; status: AuctionStatus; activeLotNumber: number | null }
  | { type: "chat_message"; id: string; userId: string; username: string; content: string; createdAt: string }
  | { type: "viewer_count"; count: number }
  | { type: "pong" }
  | { type: "error"; message: string };

export type AdminMessage =
  | { type: "advance_lot" }
  | { type: "going_once"; lotId: string }
  | { type: "going_twice"; lotId: string }
  | { type: "sold"; lotId: string }
  | { type: "pass"; lotId: string }
  | { type: "withdraw"; lotId: string }
  | { type: "floor_bid"; lotId: string; amountCents: number; onBehalfOfName: string }
  | { type: "start_auction" }
  | { type: "close_auction" }
  | { type: "quick_add_lot"; title: string; startingPriceCents: number };
