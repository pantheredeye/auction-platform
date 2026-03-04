import { DurableObject } from "cloudflare:workers";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import type { AppDatabase } from "@/db";
import type {
  AdminMessage,
  AuctionRoomState,
  BufferedBidEvent,
  ClientMessage,
  LotState,
  ServerMessage,
  IncrementRule,
  SaleMode,
} from "./types";
import { resolveIncrement, validateBidAmount } from "./increments";
import { canTransitionLot, canTransitionAuction } from "./state-machine";

const ADMIN_MESSAGE_TYPES = new Set([
  "advance_lot", "going_once", "going_twice", "sold",
  "pass", "withdraw", "floor_bid", "start_auction",
  "close_auction", "quick_add_lot", "set_price", "close_lot",
]);

// ─── Socket attachment ──────────────────────────────────────────────

export interface SocketAttachment {
  userId: string;
  username: string;
  isAdmin: boolean;
}

// ─── Serializable state for ctx.storage ─────────────────────────────

interface StoredState {
  auctionId: string;
  organizationId: string;
  status: string;
  lots: [string, LotState][];
  currentLotId: string | null;
  defaultIncrementCents: number;
  incrementRules: IncrementRule[];
}

// ─── Durable Object ─────────────────────────────────────────────────

export class AuctionRoomDO extends DurableObject<Cloudflare.Env> {
  private state: AuctionRoomState;
  private stateLoaded = false;
  private idempotencyKeys = new Set<string>();
  private bidBuffer: BufferedBidEvent[] = [];
  private chatRateLimits = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.state = emptyState();
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ type: "ping" }),
        JSON.stringify({ type: "pong" }),
      ),
    );
  }

  // ─── Fetch routing ──────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    await this.ensureState();

    const url = new URL(request.url);
    const method = request.method;

    if (method === "POST" && url.pathname === "/init") {
      return this.handleInit(request);
    }
    if (method === "POST" && url.pathname === "/add-lot") {
      return this.handleAddLot(request);
    }
    if (method === "GET" && request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(request);
    }

    return new Response("Not found", { status: 404 });
  }

  // ─── POST /init ─────────────────────────────────────────────────

  private async handleInit(request: Request): Promise<Response> {
    const { auctionId } = (await request.json()) as { auctionId: string };

    const db = new Kysely<AppDatabase>({
      dialect: new D1Dialect({ database: this.env.DB }),
    });

    const auction = await db
      .selectFrom("auctions")
      .selectAll()
      .where("id", "=", auctionId)
      .executeTakeFirst();

    if (!auction) {
      return new Response("Auction not found", { status: 404 });
    }

    const lots = await db
      .selectFrom("lots")
      .selectAll()
      .where("auctionId", "=", auctionId)
      .orderBy("lotNumber", "asc")
      .execute();

    const lotsMap = new Map<string, LotState>();
    for (const lot of lots) {
      lotsMap.set(lot.id, {
        id: lot.id,
        lotNumber: lot.lotNumber,
        title: lot.title,
        description: lot.description ?? "",
        imageUrl: lot.thumbnailUrl ?? "",
        startingPriceCents: lot.startingPriceCents,
        currentBidCents: lot.currentBidCents ?? lot.startingPriceCents,
        currentBidderId: lot.currentBidderId ?? null,
        currentBidderName: null,
        bidCount: lot.bidCount,
        incrementCents: lot.incrementCents ?? null,
        status: lot.status as LotState["status"],
        sequence: 0,
        saleMode: (lot.saleMode ?? "english") as SaleMode,
        quantity: lot.quantity ?? 1,
        quantityClaimed: lot.quantityClaimed ?? 0,
        maxClaimsPerUser: lot.maxClaimsPerUser ?? null,
        claimants: [],
      });
    }

    let incrementRules: IncrementRule[] = [];
    if (auction.incrementRules) {
      try {
        incrementRules = JSON.parse(auction.incrementRules);
      } catch {
        // malformed JSON, use empty rules
      }
    }

    this.state = {
      auctionId: auction.id,
      organizationId: auction.organizationId,
      status: auction.status as AuctionRoomState["status"],
      lots: lotsMap,
      currentLotId: null,
      viewerCount: this.ctx.getWebSockets().length,
      connectedUsers: new Set(),
      defaultIncrementCents: auction.defaultIncrementCents,
      incrementRules,
    };

    await this.persistState();
    return new Response("OK", { status: 200 });
  }

  // ─── POST /add-lot ──────────────────────────────────────────────

  private async handleAddLot(request: Request): Promise<Response> {
    const lotData = (await request.json()) as LotState;
    this.state.lots.set(lotData.id, lotData);
    await this.persistState();
    this.broadcastLotUpdate(lotData);
    return new Response("OK", { status: 200 });
  }

  // ─── WebSocket upgrade ──────────────────────────────────────────

  private handleWebSocketUpgrade(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const userId = request.headers.get("X-User-Id") ?? "anonymous";
    const username = request.headers.get("X-Username") ?? "Anonymous";
    const isAdmin = request.headers.get("X-Is-Admin") === "true";

    const tags = [userId];
    if (isAdmin) tags.push("admin");

    this.ctx.acceptWebSocket(server, tags);
    server.serializeAttachment({
      userId,
      username,
      isAdmin,
    } satisfies SocketAttachment);

    this.state.connectedUsers.add(userId);
    this.state.viewerCount = this.ctx.getWebSockets().length;

    this.broadcast({ type: "viewer_count", count: this.state.viewerCount });
    this.sendStateSnapshot(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── Alarm handler (lot countdown) ────────────────────────────

  async alarm() {
    await this.ensureState();

    const lot = this.state.currentLotId
      ? this.state.lots.get(this.state.currentLotId)
      : null;

    // Race guard: lot was reset to active (anti-snipe) before alarm fired
    if (!lot || (lot.status !== "going_once" && lot.status !== "going_twice")) {
      return;
    }

    if (lot.status === "going_once") {
      lot.status = "going_twice";
      lot.sequence++;
      await this.persistState();
      this.broadcast({
        type: "lot_update",
        lotId: lot.id,
        status: lot.status,
        currentBidCents: lot.currentBidCents,
        currentBidderId: lot.currentBidderId,
        currentBidderName: lot.currentBidderName,
        bidCount: lot.bidCount,
      });
      // Set alarm for sold/passed transition
      await this.ctx.storage.setAlarm(Date.now() + 5000);
      return;
    }

    if (lot.status === "going_twice") {
      // Determine sold vs passed
      if (lot.bidCount > 0 && lot.currentBidderId) {
        lot.status = "sold";
      } else {
        lot.status = "passed";
      }
      lot.sequence++;
      await this.persistState();
      await this.flushBidBuffer();
      this.broadcast({
        type: "lot_update",
        lotId: lot.id,
        status: lot.status,
        currentBidCents: lot.currentBidCents,
        currentBidderId: lot.currentBidderId,
        currentBidderName: lot.currentBidderName,
        bidCount: lot.bidCount,
      });
    }
  }

  // ─── Hibernation handlers ──────────────────────────────────────

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason);
    await this.ensureState();

    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (attachment) {
      this.state.connectedUsers.delete(attachment.userId);
    }
    this.state.viewerCount = this.ctx.getWebSockets().length;
    this.broadcast({ type: "viewer_count", count: this.state.viewerCount });
  }

  async webSocketError(ws: WebSocket) {
    await this.ensureState();

    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (attachment) {
      this.state.connectedUsers.delete(attachment.userId);
    }
    this.state.viewerCount = this.ctx.getWebSockets().length;
    this.broadcast({ type: "viewer_count", count: this.state.viewerCount });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    await this.ensureState();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(
        typeof message === "string" ? message : new TextDecoder().decode(message),
      ) as Record<string, unknown>;
    } catch {
      this.sendToSocket(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    const { type } = parsed;

    if (type === "bid") {
      this.handleBid(ws, parsed as unknown as ClientMessage & { type: "bid" });
    } else if (type === "claim") {
      this.handleClaim(ws, parsed as unknown as ClientMessage & { type: "claim" });
    } else if (type === "chat") {
      this.handleChat(ws, parsed as unknown as ClientMessage & { type: "chat" });
    } else if (ADMIN_MESSAGE_TYPES.has(type as string)) {
      await this.handleAdminMessage(ws, parsed as unknown as AdminMessage);
    }
  }

  // ─── Bid handling ─────────────────────────────────────────────

  private handleBid(
    ws: WebSocket,
    msg: { type: "bid"; lotId: string; amountCents: number; idempotencyKey: string },
  ) {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) {
      this.sendToSocket(ws, { type: "error", message: "No attachment" });
      return;
    }

    const { userId, username } = attachment;
    const { lotId, amountCents, idempotencyKey } = msg;

    // Find the lot
    const lot = this.state.lots.get(lotId);
    if (!lot) {
      this.sendToSocket(ws, { type: "bid_rejected", lotId, reason: "Lot not found" });
      return;
    }

    // Mode guard: bids only for english auctions
    if (lot.saleMode !== "english") {
      this.sendToSocket(ws, { type: "bid_rejected", lotId, reason: "Use claim for this sale mode" });
      return;
    }

    // Validate lot status allows bidding
    const biddableStatuses = new Set(["active", "going_once", "going_twice"]);
    if (!biddableStatuses.has(lot.status)) {
      this.sendToSocket(ws, {
        type: "bid_rejected",
        lotId,
        reason: `Lot is ${lot.status}, not accepting bids`,
      });
      return;
    }

    // Check idempotency
    if (this.idempotencyKeys.has(idempotencyKey)) {
      this.sendToSocket(ws, { type: "bid_rejected", lotId, reason: "Duplicate bid" });
      return;
    }

    // Resolve increment and validate amount
    const increment = resolveIncrement(
      lot.currentBidCents,
      lot.incrementCents,
      this.state.incrementRules,
      this.state.defaultIncrementCents,
    );
    const { valid, minimumBid } = validateBidAmount(
      amountCents,
      lot.currentBidCents,
      increment,
    );
    if (!valid) {
      this.sendToSocket(ws, {
        type: "bid_rejected",
        lotId,
        reason: `Bid too low, minimum is ${minimumBid}`,
      });
      return;
    }

    // Capture previous state for event
    const previousHighCents = lot.currentBidCents;
    const previousHighUserId = lot.currentBidderId;

    // Anti-snipe: reset going_once/going_twice to active, cancel alarm
    if (lot.status === "going_once" || lot.status === "going_twice") {
      lot.status = "active";
      this.ctx.storage.deleteAlarm();
    }

    // Update lot state
    lot.currentBidCents = amountCents;
    lot.currentBidderId = userId;
    lot.currentBidderName = username;
    lot.bidCount++;
    lot.sequence++;

    // Track idempotency
    this.idempotencyKeys.add(idempotencyKey);

    // Buffer bid event for queue
    this.bidBuffer.push({
      auctionId: this.state.auctionId,
      lotId,
      userId,
      type: "bid",
      amountCents,
      previousHighCents,
      previousHighUserId,
      onBehalfOfName: null,
      placedByUserId: null,
      idempotencyKey,
      sequence: lot.sequence,
      createdAt: new Date().toISOString(),
    });

    // Flush buffer if it reaches 10 events
    if (this.bidBuffer.length >= 10) {
      this.flushBidBuffer();
    }

    // Persist updated state
    this.persistState();

    // Send bid_accepted to bidder only
    this.sendToSocket(ws, {
      type: "bid_accepted",
      lotId,
      amountCents,
      userId,
      bidCount: lot.bidCount,
    });

    // Broadcast lot_update to all
    this.broadcast({
      type: "lot_update",
      lotId,
      status: lot.status,
      currentBidCents: lot.currentBidCents,
      currentBidderId: lot.currentBidderId,
      currentBidderName: lot.currentBidderName,
      bidCount: lot.bidCount,
    });
  }

  // ─── Claim handling (live_sell / dutch) ─────────────────────────

  private handleClaim(
    ws: WebSocket,
    msg: { type: "claim"; lotId: string; quantity: number; idempotencyKey: string },
  ) {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) {
      this.sendToSocket(ws, { type: "error", message: "No attachment" });
      return;
    }

    const { userId, username } = attachment;
    const { lotId, quantity, idempotencyKey } = msg;

    const lot = this.state.lots.get(lotId);
    if (!lot) {
      this.sendToSocket(ws, { type: "claim_rejected", lotId, reason: "Lot not found" });
      return;
    }

    // Mode guard
    if (lot.saleMode !== "live_sell" && lot.saleMode !== "dutch") {
      this.sendToSocket(ws, { type: "claim_rejected", lotId, reason: "Use bid for english auctions" });
      return;
    }

    if (lot.status !== "active") {
      this.sendToSocket(ws, { type: "claim_rejected", lotId, reason: `Lot is ${lot.status}, not accepting claims` });
      return;
    }

    // Check remaining quantity
    const remaining = lot.quantity - lot.quantityClaimed;
    if (remaining <= 0) {
      this.sendToSocket(ws, { type: "claim_rejected", lotId, reason: "Sold out" });
      return;
    }

    const claimQty = Math.min(quantity, remaining);

    // Enforce maxClaimsPerUser
    if (lot.maxClaimsPerUser !== null) {
      const userClaimed = lot.claimants
        .filter((c) => c.userId === userId)
        .reduce((sum, c) => sum + c.quantity, 0);
      if (userClaimed + claimQty > lot.maxClaimsPerUser) {
        this.sendToSocket(ws, { type: "claim_rejected", lotId, reason: `Max ${lot.maxClaimsPerUser} claims per user` });
        return;
      }
    }

    // Idempotency
    if (this.idempotencyKeys.has(idempotencyKey)) {
      this.sendToSocket(ws, { type: "claim_rejected", lotId, reason: "Duplicate claim" });
      return;
    }
    this.idempotencyKeys.add(idempotencyKey);

    // Accept claim
    const amountCents = lot.currentBidCents;
    lot.quantityClaimed += claimQty;
    lot.bidCount++;
    lot.sequence++;
    lot.claimants.push({
      userId,
      username,
      quantity: claimQty,
      amountCents,
      claimedAt: new Date().toISOString(),
    });

    // Buffer claim event
    this.bidBuffer.push({
      auctionId: this.state.auctionId,
      lotId,
      userId,
      type: "claim",
      amountCents,
      previousHighCents: amountCents,
      previousHighUserId: null,
      onBehalfOfName: null,
      placedByUserId: null,
      idempotencyKey,
      sequence: lot.sequence,
      createdAt: new Date().toISOString(),
    });

    if (this.bidBuffer.length >= 10) {
      this.flushBidBuffer();
    }

    // Auto-sell if fully claimed
    if (lot.quantityClaimed >= lot.quantity) {
      lot.status = "sold";
      lot.sequence++;
      this.flushBidBuffer();
    }

    this.persistState();

    // Confirm to claimer
    this.sendToSocket(ws, {
      type: "claim_accepted",
      lotId,
      quantity: claimQty,
      amountCents,
      userId,
      quantityClaimed: lot.quantityClaimed,
    });

    // Broadcast update
    this.broadcastLotUpdate(lot);
  }

  // ─── Chat handling ──────────────────────────────────────────────

  private handleChat(ws: WebSocket, msg: { type: "chat"; content: string }) {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) {
      this.sendToSocket(ws, { type: "error", message: "No attachment" });
      return;
    }

    const { userId, username } = attachment;
    const now = Date.now();

    // Rate limit: 1 chat per 2 seconds per user
    const lastChat = this.chatRateLimits.get(userId);
    if (lastChat && now - lastChat < 2000) {
      this.sendToSocket(ws, { type: "error", message: "Rate limit: wait 2s between messages" });
      return;
    }
    this.chatRateLimits.set(userId, now);

    // Truncate content to 500 chars
    const content = msg.content.slice(0, 500);

    this.broadcast({
      type: "chat_message",
      id: crypto.randomUUID(),
      userId,
      username,
      content,
      createdAt: new Date().toISOString(),
    });
  }

  // ─── Admin message handling ──────────────────────────────────────

  private async handleAdminMessage(ws: WebSocket, msg: AdminMessage) {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment?.isAdmin) {
      this.sendToSocket(ws, { type: "error", message: "Admin access required" });
      return;
    }

    switch (msg.type) {
      case "going_once":
        await this.handleGoingOnce(ws, msg.lotId);
        break;
      case "going_twice":
        await this.handleGoingTwice(ws, msg.lotId);
        break;
      case "sold":
        await this.handleSold(ws, msg.lotId);
        break;
      case "pass":
        await this.handlePass(ws, msg.lotId);
        break;
      case "withdraw":
        await this.handleWithdraw(ws, msg.lotId);
        break;
      case "advance_lot":
        await this.handleAdvanceLot(ws);
        break;
      case "start_auction":
        await this.handleStartAuction(ws);
        break;
      case "close_auction":
        await this.handleCloseAuction(ws);
        break;
      case "floor_bid":
        await this.handleFloorBid(ws, attachment, msg);
        break;
      case "quick_add_lot":
        await this.handleQuickAddLot(ws, msg);
        break;
      case "set_price":
        await this.handleSetPrice(ws, msg);
        break;
      case "close_lot":
        await this.handleCloseLot(ws, msg.lotId);
        break;
      default:
        this.sendToSocket(ws, { type: "error", message: "Unknown admin command" });
    }
  }

  private async handleGoingOnce(ws: WebSocket, lotId: string) {
    const lot = this.state.lots.get(lotId);
    if (!lot) {
      this.sendToSocket(ws, { type: "error", message: "Lot not found" });
      return;
    }
    if (lot.saleMode !== "english") {
      this.sendToSocket(ws, { type: "error", message: "Going once/twice only for english auctions" });
      return;
    }
    if (!canTransitionLot(lot.status, "going_once", lot.saleMode)) {
      this.sendToSocket(ws, { type: "error", message: `Cannot go going_once from ${lot.status}` });
      return;
    }
    lot.status = "going_once";
    lot.sequence++;
    await this.persistState();
    await this.ctx.storage.setAlarm(Date.now() + 5000);
    this.broadcastLotUpdate(lot);
  }

  private async handleGoingTwice(ws: WebSocket, lotId: string) {
    const lot = this.state.lots.get(lotId);
    if (!lot) {
      this.sendToSocket(ws, { type: "error", message: "Lot not found" });
      return;
    }
    if (lot.saleMode !== "english") {
      this.sendToSocket(ws, { type: "error", message: "Going once/twice only for english auctions" });
      return;
    }
    if (!canTransitionLot(lot.status, "going_twice", lot.saleMode)) {
      this.sendToSocket(ws, { type: "error", message: `Cannot go going_twice from ${lot.status}` });
      return;
    }
    lot.status = "going_twice";
    lot.sequence++;
    await this.persistState();
    await this.ctx.storage.setAlarm(Date.now() + 5000);
    this.broadcastLotUpdate(lot);
  }

  private async handleSold(ws: WebSocket, lotId: string) {
    const lot = this.state.lots.get(lotId);
    if (!lot) {
      this.sendToSocket(ws, { type: "error", message: "Lot not found" });
      return;
    }
    if (!canTransitionLot(lot.status, "sold", lot.saleMode)) {
      this.sendToSocket(ws, { type: "error", message: `Cannot mark sold from ${lot.status}` });
      return;
    }
    lot.status = "sold";
    lot.sequence++;
    this.ctx.storage.deleteAlarm();

    // Record winner in D1
    if (lot.currentBidderId) {
      const db = new Kysely<AppDatabase>({
        dialect: new D1Dialect({ database: this.env.DB }),
      });
      await db
        .updateTable("lots")
        .set({
          status: "sold",
          currentBidCents: lot.currentBidCents,
          currentBidderId: lot.currentBidderId,
          winnerUserId: lot.currentBidderId,
          winnerAmountCents: lot.currentBidCents,
          bidCount: lot.bidCount,
          updatedAt: new Date().toISOString(),
        })
        .where("id", "=", lotId)
        .execute();
    }

    await this.persistState();
    await this.flushBidBuffer();
    this.broadcastLotUpdate(lot);
  }

  private async handlePass(ws: WebSocket, lotId: string) {
    const lot = this.state.lots.get(lotId);
    if (!lot) {
      this.sendToSocket(ws, { type: "error", message: "Lot not found" });
      return;
    }
    if (!canTransitionLot(lot.status, "passed", lot.saleMode)) {
      this.sendToSocket(ws, { type: "error", message: `Cannot pass from ${lot.status}` });
      return;
    }
    lot.status = "passed";
    lot.sequence++;
    this.ctx.storage.deleteAlarm();
    await this.persistState();
    await this.flushBidBuffer();
    this.broadcastLotUpdate(lot);
  }

  private async handleWithdraw(ws: WebSocket, lotId: string) {
    const lot = this.state.lots.get(lotId);
    if (!lot) {
      this.sendToSocket(ws, { type: "error", message: "Lot not found" });
      return;
    }
    if (!canTransitionLot(lot.status, "withdrawn", lot.saleMode)) {
      this.sendToSocket(ws, { type: "error", message: `Cannot withdraw from ${lot.status}` });
      return;
    }
    lot.status = "withdrawn";
    lot.sequence++;
    this.ctx.storage.deleteAlarm();
    await this.persistState();
    await this.flushBidBuffer();
    this.broadcastLotUpdate(lot);
  }

  private async handleAdvanceLot(ws: WebSocket) {
    // Find next pending lot by lotNumber order
    const pendingLots = [...this.state.lots.values()]
      .filter((l) => l.status === "pending")
      .sort((a, b) => a.lotNumber - b.lotNumber);

    if (pendingLots.length === 0) {
      this.sendToSocket(ws, { type: "error", message: "No pending lots" });
      return;
    }

    const nextLot = pendingLots[0];
    nextLot.status = "active";
    nextLot.sequence++;
    this.state.currentLotId = nextLot.id;

    await this.persistState();
    this.broadcastLotUpdate(nextLot);
    this.broadcast({
      type: "auction_update",
      status: this.state.status,
      activeLotNumber: nextLot.lotNumber,
    });
  }

  private async handleStartAuction(ws: WebSocket) {
    if (!canTransitionAuction(this.state.status, "live")) {
      this.sendToSocket(ws, {
        type: "error",
        message: `Cannot start auction from ${this.state.status}`,
      });
      return;
    }

    const db = new Kysely<AppDatabase>({
      dialect: new D1Dialect({ database: this.env.DB }),
    });
    await db
      .updateTable("auctions")
      .set({
        status: "live",
        actualStartAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where("id", "=", this.state.auctionId)
      .execute();

    this.state.status = "live";
    await this.persistState();

    const currentLot = this.state.currentLotId
      ? this.state.lots.get(this.state.currentLotId)
      : null;
    this.broadcast({
      type: "auction_update",
      status: this.state.status,
      activeLotNumber: currentLot?.lotNumber ?? null,
    });
  }

  private async handleCloseAuction(ws: WebSocket) {
    if (!canTransitionAuction(this.state.status, "closed")) {
      this.sendToSocket(ws, {
        type: "error",
        message: `Cannot close auction from ${this.state.status}`,
      });
      return;
    }

    const db = new Kysely<AppDatabase>({
      dialect: new D1Dialect({ database: this.env.DB }),
    });
    await db
      .updateTable("auctions")
      .set({
        status: "closed",
        actualEndAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where("id", "=", this.state.auctionId)
      .execute();

    this.state.status = "closed";
    await this.persistState();
    this.broadcast({
      type: "auction_update",
      status: this.state.status,
      activeLotNumber: null,
    });
  }

  // ─── Floor bid ──────────────────────────────────────────────────

  private async handleFloorBid(
    ws: WebSocket,
    attachment: SocketAttachment,
    msg: { type: "floor_bid"; lotId: string; amountCents: number; onBehalfOfName: string },
  ) {
    const lot = this.state.lots.get(msg.lotId);
    if (!lot) {
      this.sendToSocket(ws, { type: "error", message: "Lot not found" });
      return;
    }

    // Mode guard: floor bids only for english auctions
    if (lot.saleMode !== "english") {
      this.sendToSocket(ws, { type: "error", message: "Floor bids only for english auctions" });
      return;
    }

    const biddableStatuses = new Set(["active", "going_once", "going_twice"]);
    if (!biddableStatuses.has(lot.status)) {
      this.sendToSocket(ws, {
        type: "error",
        message: `Lot is ${lot.status}, not accepting bids`,
      });
      return;
    }

    // Validate bid amount using same increment rules as regular bids
    const increment = resolveIncrement(
      lot.currentBidCents,
      lot.incrementCents,
      this.state.incrementRules,
      this.state.defaultIncrementCents,
    );
    const { valid, minimumBid } = validateBidAmount(
      msg.amountCents,
      lot.currentBidCents,
      increment,
    );
    if (!valid) {
      this.sendToSocket(ws, {
        type: "error",
        message: `Bid too low, minimum is ${minimumBid}`,
      });
      return;
    }

    const previousHighCents = lot.currentBidCents;
    const previousHighUserId = lot.currentBidderId;

    // Anti-snipe: reset countdown to active
    if (lot.status === "going_once" || lot.status === "going_twice") {
      lot.status = "active";
      this.ctx.storage.deleteAlarm();
    }

    lot.currentBidCents = msg.amountCents;
    lot.currentBidderId = attachment.userId;
    lot.currentBidderName = msg.onBehalfOfName + " (floor)";
    lot.bidCount++;
    lot.sequence++;

    const idempotencyKey = crypto.randomUUID();
    this.bidBuffer.push({
      auctionId: this.state.auctionId,
      lotId: msg.lotId,
      userId: attachment.userId,
      type: "floor_bid",
      amountCents: msg.amountCents,
      previousHighCents,
      previousHighUserId,
      onBehalfOfName: msg.onBehalfOfName,
      placedByUserId: attachment.userId,
      idempotencyKey,
      sequence: lot.sequence,
      createdAt: new Date().toISOString(),
    });

    if (this.bidBuffer.length >= 10) {
      this.flushBidBuffer();
    }

    await this.persistState();
    this.broadcastLotUpdate(lot);
  }

  // ─── Set price (live_sell / dutch) ──────────────────────────────

  private async handleSetPrice(
    ws: WebSocket,
    msg: { type: "set_price"; lotId: string; priceCents: number },
  ) {
    const lot = this.state.lots.get(msg.lotId);
    if (!lot) {
      this.sendToSocket(ws, { type: "error", message: "Lot not found" });
      return;
    }
    if (lot.status !== "active") {
      this.sendToSocket(ws, { type: "error", message: `Lot is ${lot.status}, cannot set price` });
      return;
    }
    if (msg.priceCents <= 0) {
      this.sendToSocket(ws, { type: "error", message: "Price must be positive" });
      return;
    }

    lot.currentBidCents = msg.priceCents;
    lot.sequence++;
    await this.persistState();
    this.broadcastLotUpdate(lot);
  }

  // ─── Close lot (live_sell / dutch) ────────────────────────────

  private async handleCloseLot(ws: WebSocket, lotId: string) {
    const lot = this.state.lots.get(lotId);
    if (!lot) {
      this.sendToSocket(ws, { type: "error", message: "Lot not found" });
      return;
    }
    if (lot.status !== "active") {
      this.sendToSocket(ws, { type: "error", message: `Lot is ${lot.status}, cannot close` });
      return;
    }

    // Determine sold vs passed based on claims
    lot.status = lot.quantityClaimed > 0 ? "sold" : "passed";
    lot.sequence++;

    // Record in D1
    const db = new Kysely<AppDatabase>({
      dialect: new D1Dialect({ database: this.env.DB }),
    });
    await db
      .updateTable("lots")
      .set({
        status: lot.status,
        quantityClaimed: lot.quantityClaimed,
        bidCount: lot.bidCount,
        updatedAt: new Date().toISOString(),
      })
      .where("id", "=", lotId)
      .execute();

    await this.persistState();
    await this.flushBidBuffer();
    this.broadcastLotUpdate(lot);
  }

  // ─── Quick-add lot ──────────────────────────────────────────────

  private async handleQuickAddLot(
    ws: WebSocket,
    msg: { type: "quick_add_lot"; title: string; startingPriceCents: number; saleMode?: SaleMode; quantity?: number; maxClaimsPerUser?: number | null },
  ) {
    const lotId = crypto.randomUUID();
    const saleMode: SaleMode = msg.saleMode ?? "english";
    const quantity = msg.quantity ?? 1;
    const maxClaimsPerUser = msg.maxClaimsPerUser ?? null;

    // Determine next lot number
    const lotNumbers = [...this.state.lots.values()].map((l) => l.lotNumber);
    const nextLotNumber = lotNumbers.length > 0 ? Math.max(...lotNumbers) + 1 : 1;

    const now = new Date().toISOString();

    // Insert into D1
    const db = new Kysely<AppDatabase>({
      dialect: new D1Dialect({ database: this.env.DB }),
    });
    await db
      .insertInto("lots")
      .values({
        id: lotId,
        organizationId: this.state.organizationId,
        auctionId: this.state.auctionId,
        lotNumber: nextLotNumber,
        title: msg.title,
        startingPriceCents: msg.startingPriceCents,
        status: "pending",
        currentBidCents: null,
        bidCount: 0,
        quantity,
        saleMode,
        quantityClaimed: 0,
        maxClaimsPerUser,
        version: 1,
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    // Create LotState and add to in-memory state
    const lotState: LotState = {
      id: lotId,
      lotNumber: nextLotNumber,
      title: msg.title,
      description: "",
      imageUrl: "",
      startingPriceCents: msg.startingPriceCents,
      currentBidCents: msg.startingPriceCents,
      currentBidderId: null,
      currentBidderName: null,
      bidCount: 0,
      incrementCents: null,
      status: "pending",
      sequence: 0,
      saleMode,
      quantity,
      quantityClaimed: 0,
      maxClaimsPerUser,
      claimants: [],
    };
    this.state.lots.set(lotId, lotState);

    // Auto-activate if no current active lot and auction is live
    if (!this.state.currentLotId && this.state.status === "live") {
      lotState.status = "active";
      lotState.sequence++;
      this.state.currentLotId = lotId;

      // Also update D1
      await db
        .updateTable("lots")
        .set({ status: "active", updatedAt: new Date().toISOString() })
        .where("id", "=", lotId)
        .execute();
    }

    await this.persistState();
    this.broadcastLotUpdate(lotState);
    this.broadcast({
      type: "auction_update",
      status: this.state.status,
      activeLotNumber: this.state.currentLotId
        ? this.state.lots.get(this.state.currentLotId)?.lotNumber ?? null
        : null,
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private broadcastLotUpdate(lot: LotState) {
    this.broadcast({
      type: "lot_update",
      lotId: lot.id,
      status: lot.status,
      currentBidCents: lot.currentBidCents,
      currentBidderId: lot.currentBidderId,
      currentBidderName: lot.currentBidderName,
      bidCount: lot.bidCount,
      saleMode: lot.saleMode,
      quantity: lot.quantity,
      quantityClaimed: lot.quantityClaimed,
    });
  }

  broadcast(msg: ServerMessage, tag?: string) {
    const data = JSON.stringify(msg);
    const sockets = tag
      ? this.ctx.getWebSockets(tag)
      : this.ctx.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.send(data);
      } catch {
        // socket likely closed
      }
    }
  }

  private sendToSocket(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      try {
        ws.close(1011, "Send failed");
      } catch {
        // already closed
      }
    }
  }

  private sendStateSnapshot(ws: WebSocket) {
    const currentLot = this.state.currentLotId
      ? this.state.lots.get(this.state.currentLotId)
      : null;

    this.sendToSocket(ws, {
      type: "auction_update",
      status: this.state.status,
      activeLotNumber: currentLot?.lotNumber ?? null,
    });

    for (const lot of this.state.lots.values()) {
      this.sendToSocket(ws, {
        type: "lot_update",
        lotId: lot.id,
        status: lot.status,
        currentBidCents: lot.currentBidCents,
        currentBidderId: lot.currentBidderId,
        currentBidderName: lot.currentBidderName,
        bidCount: lot.bidCount,
        saleMode: lot.saleMode,
        quantity: lot.quantity,
        quantityClaimed: lot.quantityClaimed,
      });
    }

    this.sendToSocket(ws, {
      type: "viewer_count",
      count: this.state.viewerCount,
    });
  }

  // ─── Buffer flush ─────────────────────────────────────────────

  private async flushBidBuffer() {
    if (this.bidBuffer.length === 0) return;
    try {
      await this.env.BID_EVENTS_QUEUE.sendBatch(
        this.bidBuffer.map((event) => ({ body: event })),
      );
      this.bidBuffer = [];
    } catch {
      // Keep events in buffer for retry on next flush
    }
  }

  // ─── State persistence & recovery ──────────────────────────────

  private async persistState() {
    const stored: StoredState = {
      auctionId: this.state.auctionId,
      organizationId: this.state.organizationId,
      status: this.state.status,
      lots: [...this.state.lots.entries()],
      currentLotId: this.state.currentLotId,
      defaultIncrementCents: this.state.defaultIncrementCents,
      incrementRules: this.state.incrementRules,
    };
    await this.ctx.storage.put("state", stored);
  }

  private async ensureState() {
    if (this.stateLoaded) return;
    await this.recoverState();
    this.stateLoaded = true;
  }

  private async recoverState() {
    const stored = await this.ctx.storage.get<StoredState>("state");
    if (stored) {
      this.state = {
        auctionId: stored.auctionId,
        organizationId: stored.organizationId,
        status: stored.status as AuctionRoomState["status"],
        lots: new Map(stored.lots),
        currentLotId: stored.currentLotId,
        viewerCount: this.ctx.getWebSockets().length,
        connectedUsers: new Set(),
        defaultIncrementCents: stored.defaultIncrementCents,
        incrementRules: stored.incrementRules,
      };
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function emptyState(): AuctionRoomState {
  return {
    auctionId: "",
    organizationId: "",
    status: "draft",
    lots: new Map(),
    currentLotId: null,
    viewerCount: 0,
    connectedUsers: new Set(),
    defaultIncrementCents: 100,
    incrementRules: [],
  };
}
