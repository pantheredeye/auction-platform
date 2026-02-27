import { DurableObject } from "cloudflare:workers";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import type { AppDatabase } from "@/db";
import type {
  AuctionRoomState,
  BufferedBidEvent,
  ClientMessage,
  LotState,
  ServerMessage,
  IncrementRule,
} from "./types";
import { resolveIncrement, validateBidAmount } from "./increments";

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

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.state = emptyState();
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        "ping",
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

    this.broadcast({
      type: "lot_update",
      lotId: lotData.id,
      status: lotData.status,
      currentBidCents: lotData.currentBidCents,
      currentBidderId: lotData.currentBidderId,
      bidCount: lotData.bidCount,
    });

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

    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(
        typeof message === "string" ? message : new TextDecoder().decode(message),
      ) as ClientMessage;
    } catch {
      this.sendToSocket(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    if (parsed.type === "bid") {
      this.handleBid(ws, parsed);
    }
    // Other message types (chat, etc.) handled by future epics
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
      bidCount: lot.bidCount,
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────

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
        bidCount: lot.bidCount,
      });
    }

    this.sendToSocket(ws, {
      type: "viewer_count",
      count: this.state.viewerCount,
    });
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
