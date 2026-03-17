import type { BidderRequirement } from "@/lib/bidder-requirement";

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

export type SaleMode = "english" | "live_sell" | "dutch";

export type BidEventType =
  | "bid"
  | "auto_bid"
  | "retract"
  | "system_extend"
  | "floor_bid"
  | "claim";

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

export interface ClaimEntry {
  userId: string;
  username: string;
  quantity: number;
  amountCents: number;
  claimedAt: string;
}

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
  saleMode: SaleMode;
  quantity: number;
  quantityClaimed: number;
  maxClaimsPerUser: number | null;
  claimants: ClaimEntry[];
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
  bidderRequirement: BidderRequirement;
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

export interface BufferedChatEvent {
  id: string;
  auctionId: string;
  userId: string;
  username: string;
  content: string;
  createdAt: string;
}

// ─── WebSocket messages ─────────────────────────────────────────────

export interface ChatMessage {
  type: "chat_message";
  id: string;
  userId: string;
  username: string;
  content: string;
  createdAt: string;
  messageType?: "chat" | "bid";
}

export interface ChatHistoryMessage {
  type: "chat_history";
  messages: ChatMessage[];
}

export type ClientMessage =
  | { type: "bid"; lotId: string; amountCents: number; idempotencyKey: string }
  | { type: "claim"; lotId: string; quantity: number; idempotencyKey: string }
  | { type: "chat"; content: string }
  | { type: "stream_heartbeat" }
  | { type: "ping" };

export type ServerMessage =
  | { type: "bid_accepted"; lotId: string; amountCents: number; userId: string; bidCount: number }
  | { type: "bid_rejected"; lotId: string; reason: string }
  | { type: "claim_accepted"; lotId: string; quantity: number; amountCents: number; userId: string; quantityClaimed: number }
  | { type: "claim_rejected"; lotId: string; reason: string }
  | { type: "lot_update"; lotId: string; status: LotStatus; currentBidCents: number | null; currentBidderId: string | null; currentBidderName: string | null; bidCount: number; saleMode?: SaleMode; quantity?: number; quantityClaimed?: number }
  | { type: "auction_update"; status: AuctionStatus; activeLotNumber: number | null }
  | { type: "chat_message"; id: string; userId: string; username: string; content: string; createdAt: string }
  | { type: "viewer_count"; count: number }
  | { type: "pong" }
  | { type: "chat_history"; messages: ChatMessage[] }
  | { type: "stream_ended" }
  | { type: "stream_paused"; reason: string }
  | { type: "error"; message: string }
  | { type: "registration_required"; requirement: string };

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
  | { type: "quick_add_lot"; title: string; startingPriceCents: number; saleMode?: SaleMode; quantity?: number; maxClaimsPerUser?: number | null }
  | { type: "set_price"; lotId: string; priceCents: number }
  | { type: "close_lot"; lotId: string };
