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
  | { type: "close_auction" };
