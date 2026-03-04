"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Toaster } from "@/app/components/ui/sonner";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/app/components/ui/sheet";
import type { AuctionsTable, LotsTable } from "@/db";
import type {
  ServerMessage,
  ClientMessage,
  LotStatus,
  AuctionStatus,
  SaleMode,
} from "@/auction/types";
import { formatCents } from "@/lib/money";
import { imageUrl } from "@/lib/image-url";
import { Eye, MessageCircle, Volume2, VolumeX } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

interface ChatMsg {
  id: string;
  userId: string;
  username: string;
  content: string;
  createdAt: string;
}

interface LotDynamic {
  status: LotStatus;
  currentBidCents: number | null;
  currentBidderId: string | null;
  currentBidderName: string | null;
  bidCount: number;
  saleMode: SaleMode;
  quantity: number;
  quantityClaimed: number;
}

interface AuctionRoomClientProps {
  auction: AuctionsTable;
  initialActiveLot: LotsTable | null;
  initialUpcomingLots: LotsTable[];
  userId: string;
  username: string;
}

// ─── Component ──────────────────────────────────────────────────────

export function AuctionRoomClient({
  auction,
  initialActiveLot,
  initialUpcomingLots,
  userId,
  username,
}: AuctionRoomClientProps) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [auctionStatus, setAuctionStatus] = useState<AuctionStatus>(auction.status as AuctionStatus);
  const [currentLot, setCurrentLot] = useState<{ id: string; lotNumber: number; title: string; description: string; startingPriceCents: number; thumbnailUrl: string | null } | null>(
    initialActiveLot
      ? { id: initialActiveLot.id, lotNumber: initialActiveLot.lotNumber, title: initialActiveLot.title, description: initialActiveLot.description ?? "", startingPriceCents: initialActiveLot.startingPriceCents, thumbnailUrl: initialActiveLot.thumbnailUrl }
      : null,
  );
  const [currentLotState, setCurrentLotState] = useState<LotDynamic | null>(
    initialActiveLot
      ? { status: initialActiveLot.status as LotStatus, currentBidCents: initialActiveLot.currentBidCents, currentBidderId: initialActiveLot.currentBidderId, currentBidderName: null, bidCount: initialActiveLot.bidCount, saleMode: (initialActiveLot.saleMode ?? "english") as SaleMode, quantity: initialActiveLot.quantity ?? 1, quantityClaimed: initialActiveLot.quantityClaimed ?? 0 }
      : null,
  );
  const [upcomingLots, setUpcomingLots] = useState(initialUpcomingLots);
  const [viewerCount, setViewerCount] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [myLastBidLotId, setMyLastBidLotId] = useState<string | null>(null);
  const myLastBidLotIdRef = useRef<string | null>(null);
  const [bidInFlight, setBidInFlight] = useState(false);
  const [soldOverlay, setSoldOverlay] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  // Track all known lots for state updates
  const lotsRef = useRef<Map<string, LotDynamic>>(new Map());
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;
  myLastBidLotIdRef.current = myLastBidLotId;

  const sendMessage = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "lot_update": {
        const prev = lotsRef.current.get(msg.lotId);
        const dynamic: LotDynamic = {
          status: msg.status,
          currentBidCents: msg.currentBidCents,
          currentBidderId: msg.currentBidderId,
          currentBidderName: msg.currentBidderName,
          bidCount: msg.bidCount,
          saleMode: msg.saleMode ?? prev?.saleMode ?? "english",
          quantity: msg.quantity ?? prev?.quantity ?? 1,
          quantityClaimed: msg.quantityClaimed ?? prev?.quantityClaimed ?? 0,
        };
        lotsRef.current.set(msg.lotId, dynamic);

        // Outbid detection
        if (
          myLastBidLotIdRef.current === msg.lotId &&
          msg.currentBidderId !== null &&
          msg.currentBidderId !== userId
        ) {
          toast.warning("You've been outbid!");
          setMyLastBidLotId(null);
        }

        // Active lot tracking
        if (msg.status === "active" || msg.status === "going_once" || msg.status === "going_twice") {
          setCurrentLotState(dynamic);
          setSoldOverlay(false);
          // Update current lot if it's a new lot — pull from upcomingLots for full info
          setCurrentLot((prev) => {
            if (prev?.id === msg.lotId) return prev;
            return null; // will be resolved below
          });
          setUpcomingLots((prev) => {
            const found = prev.find((l) => l.id === msg.lotId);
            if (found) {
              setCurrentLot({ id: found.id, lotNumber: found.lotNumber, title: found.title, description: found.description ?? "", startingPriceCents: found.startingPriceCents, thumbnailUrl: found.thumbnailUrl });
            } else {
              setCurrentLot((cur) => cur ?? { id: msg.lotId, lotNumber: 0, title: "", description: "", startingPriceCents: 0, thumbnailUrl: null });
            }
            return prev;
          });
        } else if (msg.status === "sold") {
          // Show sold overlay for 3s before clearing
          setCurrentLotState(dynamic);
          setSoldOverlay(true);
          setTimeout(() => {
            setSoldOverlay(false);
            setCurrentLot((prev) => (prev?.id === msg.lotId ? null : prev));
            setCurrentLotState((prev) => {
              if (lotsRef.current.get(msg.lotId) === prev) return null;
              return prev;
            });
          }, 3000);
        } else if (msg.status === "passed" || msg.status === "withdrawn") {
          // Lot finished — clear if it was the current one
          setCurrentLot((prev) => (prev?.id === msg.lotId ? null : prev));
          setCurrentLotState((prev) => {
            if (lotsRef.current.get(msg.lotId) === prev) return null;
            return prev;
          });
        }

        // Remove from upcoming if status changed from pending
        if (msg.status !== "pending") {
          setUpcomingLots((prev) => prev.filter((l) => l.id !== msg.lotId));
        }
        break;
      }

      case "auction_update":
        setAuctionStatus(msg.status);
        break;

      case "bid_accepted":
        if (msg.userId === userId) {
          setBidInFlight(false);
          setMyLastBidLotId(msg.lotId);
          toast.success(`Bid placed: ${formatCents(msg.amountCents)}`);
        }
        break;

      case "bid_rejected":
        setBidInFlight(false);
        toast.error(`Bid rejected: ${msg.reason}`);
        break;

      case "claim_accepted":
        if (msg.userId === userId) {
          setBidInFlight(false);
          toast.success(`Claimed ${msg.quantity} at ${formatCents(msg.amountCents)}`);
        }
        break;

      case "claim_rejected":
        setBidInFlight(false);
        toast.error(`Claim rejected: ${msg.reason}`);
        break;

      case "chat_message":
        setChatMessages((prev) =>
          [...prev, { id: msg.id, userId: msg.userId, username: msg.username, content: msg.content, createdAt: msg.createdAt }].slice(-100),
        );
        // Increment unread on mobile when chat sheet is closed
        if (!chatOpenRef.current && typeof window !== "undefined" && window.innerWidth < 768) {
          setUnreadCount((c) => c + 1);
        }
        break;

      case "viewer_count":
        setViewerCount(msg.count);
        break;

      case "error":
        toast.error(msg.message);
        break;

      case "pong":
        break;
    }
  }, [userId]);

  // ─── WebSocket lifecycle ──────────────────────────────────────────

  useEffect(() => {
    isMounted.current = true;

    function connect() {
      if (!isMounted.current) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${location.host}/ws/auction/${auction.id}`;
      setConnectionStatus(reconnectAttempt.current > 0 ? "reconnecting" : "connecting");
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMounted.current) { ws.close(); return; }
        reconnectAttempt.current = 0;
        setConnectionStatus("connected");
      };

      ws.onmessage = (event) => {
        try {
          const msg: ServerMessage = JSON.parse(event.data);
          handleServerMessage(msg);
        } catch {
          // ignore malformed
        }
      };

      ws.onclose = () => {
        if (!isMounted.current) return;
        setConnectionStatus("disconnected");
        scheduleReconnect();
      };

      ws.onerror = () => {};
    }

    function scheduleReconnect() {
      if (!isMounted.current) return;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempt.current), 10000);
      reconnectAttempt.current++;
      setConnectionStatus("reconnecting");
      reconnectTimer.current = setTimeout(connect, delay);
    }

    const pingInterval = setInterval(() => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);

    connect();

    return () => {
      isMounted.current = false;
      clearInterval(pingInterval);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [auction.id, handleServerMessage]);

  // ─── Auto-scroll chat ────────────────────────────────────────────

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // ─── Bid handling ─────────────────────────────────────────────────

  const nextBidCents = currentLotState?.currentBidCents != null
    ? currentLotState.currentBidCents + auction.defaultIncrementCents
    : (currentLot?.startingPriceCents ?? 0);

  const handleBid = useCallback(() => {
    if (!currentLot || bidInFlight) return;
    setBidInFlight(true);
    sendMessage({
      type: "bid",
      lotId: currentLot.id,
      amountCents: nextBidCents,
      idempotencyKey: crypto.randomUUID(),
    });
  }, [currentLot, nextBidCents, sendMessage, bidInFlight]);

  const handleClaim = useCallback((qty: number = 1) => {
    if (!currentLot || bidInFlight) return;
    setBidInFlight(true);
    sendMessage({
      type: "claim",
      lotId: currentLot.id,
      quantity: qty,
      idempotencyKey: crypto.randomUUID(),
    });
  }, [currentLot, sendMessage, bidInFlight]);

  // ─── Derived state ────────────────────────────────────────────────

  const isLive = auctionStatus === "live";
  const isConnected = connectionStatus === "connected";
  const isLotActive = currentLotState && (currentLotState.status === "active" || currentLotState.status === "going_once" || currentLotState.status === "going_twice");
  const hasBids = (currentLotState?.bidCount ?? 0) > 0 && currentLotState?.currentBidCents != null;
  const isHighBidder = currentLotState?.currentBidderId === userId;

  const statusDot =
    connectionStatus === "connected"
      ? "bg-green-500"
      : connectionStatus === "reconnecting" || connectionStatus === "connecting"
        ? "bg-yellow-500"
        : "bg-red-500";

  const saleMode = currentLotState?.saleMode ?? "english";
  const isEnglish = saleMode === "english";
  const isCountdown = isEnglish && (currentLotState?.status === "going_once" || currentLotState?.status === "going_twice");

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <Toaster position="top-center" />

      {/* Header */}
      <header className="flex items-center justify-between border-b px-4 py-2 bg-background">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold truncate">{auction.title}</h1>
          {isLive && (
            <Badge variant="destructive" className="animate-pulse">LIVE</Badge>
          )}
          {!isLive && (
            <Badge variant="secondary">{auctionStatus}</Badge>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className={`inline-block h-2 w-2 rounded-full ${statusDot}`} />
            <span className="hidden sm:inline">{connectionStatus}</span>
          </div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Eye className="h-4 w-4" />
            <span>{viewerCount}</span>
          </div>
        </div>
      </header>

      {/* Going once / Going twice / Sold overlays (english only) */}
      {isEnglish && currentLotState?.status === "going_once" && (
        <AuctionOverlay variant="going_once" />
      )}
      {isEnglish && currentLotState?.status === "going_twice" && (
        <AuctionOverlay variant="going_twice" />
      )}
      {isEnglish && soldOverlay && (
        <AuctionOverlay variant="sold" />
      )}

      {/* Main content: mobile stack / desktop side-by-side */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">

        {/* Left: Stream + Lot + Bid (mobile: stacked, desktop: 60%) */}
        <div className="flex-1 md:w-3/5 flex flex-col overflow-y-auto">

          {/* Live stream video */}
          <WhepPlayer whepUrl={`/play/${auction.id}`} />

          {/* Current lot card */}
          <div className="p-4 space-y-3">
            {currentLot && currentLotState ? (
              <>
                <CurrentLotCard
                  lot={currentLot}
                  state={currentLotState}
                  isHighBidder={isHighBidder}
                />
                {isCountdown && (
                  <CountdownBar status={currentLotState.status as "going_once" | "going_twice"} />
                )}
              </>
            ) : (
              <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
                {isLive ? "Waiting for next lot..." : "Auction hasn't started yet"}
              </div>
            )}

            {/* Upcoming lots */}
            {upcomingLots.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Coming Up</h3>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {upcomingLots.slice(0, 5).map((lot) => (
                    <div key={lot.id} className="shrink-0 w-28 p-2 border rounded-lg text-center">
                      {lot.thumbnailUrl ? (
                        <img src={imageUrl(lot.thumbnailUrl)} alt={lot.title} className="w-full h-16 object-cover rounded mb-1" />
                      ) : (
                        <div className="w-full h-16 bg-muted rounded mb-1 flex items-center justify-center">
                          <span className="text-[10px] text-muted-foreground">No img</span>
                        </div>
                      )}
                      <p className="text-xs truncate">{lot.title}</p>
                      <p className="text-xs font-mono text-muted-foreground">{formatCents(lot.startingPriceCents)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Chat panel — always visible on desktop (md+) */}
        <aside className="hidden md:flex md:w-2/5 border-l flex-col overflow-hidden">
          <ChatPanel
            chatMessages={chatMessages}
            viewerCount={viewerCount}
            userId={userId}
            isConnected={isConnected}
            onSend={(content) => sendMessage({ type: "chat", content })}
            chatEndRef={chatEndRef}
          />
        </aside>

        {/* Mobile: Sheet-based chat drawer */}
        <Sheet open={chatOpen} onOpenChange={(open) => { setChatOpen(open); if (open) setUnreadCount(0); }}>
          <SheetContent side="right" showCloseButton={false} className="w-full sm:max-w-md p-0 flex flex-col md:hidden">
            <SheetHeader className="px-4 py-2 border-b">
              <SheetTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Chat</SheetTitle>
            </SheetHeader>
            <ChatPanel
              chatMessages={chatMessages}
              viewerCount={viewerCount}
              userId={userId}
              isConnected={isConnected}
              onSend={(content) => sendMessage({ type: "chat", content })}
              chatEndRef={chatEndRef}
            />
          </SheetContent>
        </Sheet>
      </div>

      {/* Mobile chat toggle button */}
      <Button
        variant="outline"
        size="icon"
        className="fixed bottom-20 right-4 z-40 h-12 w-12 rounded-full shadow-lg md:hidden"
        onClick={() => { setChatOpen(true); setUnreadCount(0); }}
      >
        <MessageCircle className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full h-5 min-w-5 flex items-center justify-center px-1">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      {/* Sticky bottom bid/claim bar — mode-aware */}
      <div className="border-t bg-background px-4 py-3 shrink-0">
        {isLotActive && currentLot && currentLotState ? (
          saleMode === "english" ? (
            <EnglishBidBar
              currentLotState={currentLotState}
              startingPriceCents={currentLot.startingPriceCents}
              nextBidCents={nextBidCents}
              isHighBidder={isHighBidder}
              isConnected={isConnected}
              bidInFlight={bidInFlight}
              onBid={handleBid}
            />
          ) : saleMode === "live_sell" ? (
            <LiveSellClaimBar
              currentLotState={currentLotState}
              isConnected={isConnected}
              bidInFlight={bidInFlight}
              onClaim={handleClaim}
            />
          ) : (
            <DutchBuyBar
              currentLotState={currentLotState}
              isConnected={isConnected}
              bidInFlight={bidInFlight}
              onClaim={handleClaim}
            />
          )
        ) : (
          <Button size="lg" disabled className="w-full font-bold text-base min-h-[3rem]">
            Waiting for next item
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function CurrentLotCard({
  lot,
  state,
  isHighBidder,
}: {
  lot: { id: string; lotNumber: number; title: string; description: string; startingPriceCents: number; thumbnailUrl: string | null };
  state: LotDynamic;
  isHighBidder: boolean;
}) {
  const hasBids = state.bidCount > 0 && state.currentBidCents != null;
  const isClaimMode = state.saleMode === "live_sell" || state.saleMode === "dutch";

  return (
    <Card className="py-3">
      <CardContent className="flex gap-4">
        <div className="w-24 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
          {lot.thumbnailUrl ? (
            <img src={imageUrl(lot.thumbnailUrl)} alt={lot.title} className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs text-muted-foreground">No image</span>
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {lot.lotNumber > 0 && <p className="text-xs text-muted-foreground">Lot #{lot.lotNumber}</p>}
              <h2 className="text-xl font-bold leading-tight truncate">{lot.title}</h2>
              {lot.description && (
                <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">{lot.description}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {state.saleMode !== "english" && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {state.saleMode === "live_sell" ? "Live Sell" : "Dutch"}
                </Badge>
              )}
              <LotStatusBadge status={state.status} />
            </div>
          </div>

          {isClaimMode ? (
            /* Claim mode display: fixed price + progress */
            <div className="flex items-baseline gap-4">
              <div>
                <p className="text-xs text-muted-foreground">{state.saleMode === "dutch" ? "Current price" : "Price"}</p>
                <p className="text-3xl font-bold tabular-nums">
                  {formatCents(state.currentBidCents ?? lot.startingPriceCents)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Claimed</p>
                <Badge variant="secondary" className="text-sm font-semibold">
                  {state.quantityClaimed} / {state.quantity}
                </Badge>
              </div>
            </div>
          ) : (
            /* English auction display */
            <>
              <div className="flex items-baseline gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">{hasBids ? "Current bid" : "Starting price"}</p>
                  <p className="text-3xl font-bold tabular-nums">
                    {hasBids ? formatCents(state.currentBidCents!) : formatCents(lot.startingPriceCents)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Bids</p>
                  <Badge variant="secondary" className="text-sm font-semibold">{state.bidCount}</Badge>
                </div>
              </div>
              {isHighBidder && (
                <p className="text-xs text-green-600 font-medium">You're winning!</p>
              )}
            </>
          )}

          {/* Claim progress bar */}
          {isClaimMode && state.quantity > 1 && (
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-green-500 transition-all duration-300"
                style={{ width: `${Math.min((state.quantityClaimed / state.quantity) * 100, 100)}%` }}
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Mode-specific bid/claim bars ────────────────────────────────

function EnglishBidBar({
  currentLotState,
  startingPriceCents,
  nextBidCents,
  isHighBidder,
  isConnected,
  bidInFlight,
  onBid,
}: {
  currentLotState: LotDynamic;
  startingPriceCents: number;
  nextBidCents: number;
  isHighBidder: boolean;
  isConnected: boolean;
  bidInFlight: boolean;
  onBid: () => void;
}) {
  const hasBids = currentLotState.bidCount > 0 && currentLotState.currentBidCents != null;
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{hasBids ? "Current bid" : "Starting at"}</p>
        <p className="text-lg font-bold tabular-nums">
          {hasBids ? formatCents(currentLotState.currentBidCents!) : formatCents(startingPriceCents)}
        </p>
      </div>
      {isHighBidder ? (
        <Button size="lg" disabled className="font-bold text-base px-8 w-full sm:w-auto">
          You are the highest bidder
        </Button>
      ) : (
        <Button
          size="lg"
          disabled={!isConnected || bidInFlight}
          onClick={onBid}
          className="font-bold text-base px-8 w-full sm:w-auto bg-green-600 hover:bg-green-700 min-h-[3rem]"
        >
          {bidInFlight ? "Placing bid..." : `Bid ${formatCents(nextBidCents)}`}
        </Button>
      )}
    </div>
  );
}

function LiveSellClaimBar({
  currentLotState,
  isConnected,
  bidInFlight,
  onClaim,
}: {
  currentLotState: LotDynamic;
  isConnected: boolean;
  bidInFlight: boolean;
  onClaim: (qty?: number) => void;
}) {
  const remaining = currentLotState.quantity - currentLotState.quantityClaimed;
  const price = currentLotState.currentBidCents ?? 0;
  const soldOut = remaining <= 0;

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">Price</p>
        <p className="text-lg font-bold tabular-nums">{formatCents(price)}</p>
        <p className="text-xs text-muted-foreground">
          {soldOut ? "Sold out" : `${remaining} of ${currentLotState.quantity} left`}
        </p>
      </div>
      <Button
        size="lg"
        disabled={!isConnected || bidInFlight || soldOut}
        onClick={() => onClaim(1)}
        className="font-bold text-base px-8 w-full sm:w-auto bg-blue-600 hover:bg-blue-700 min-h-[3rem]"
      >
        {bidInFlight ? "Claiming..." : soldOut ? "Sold Out" : `Claim — ${formatCents(price)}`}
      </Button>
    </div>
  );
}

function DutchBuyBar({
  currentLotState,
  isConnected,
  bidInFlight,
  onClaim,
}: {
  currentLotState: LotDynamic;
  isConnected: boolean;
  bidInFlight: boolean;
  onClaim: (qty?: number) => void;
}) {
  const price = currentLotState.currentBidCents ?? 0;
  const remaining = currentLotState.quantity - currentLotState.quantityClaimed;
  const soldOut = remaining <= 0;

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">Current price</p>
        <p className="text-lg font-bold tabular-nums">{formatCents(price)}</p>
      </div>
      <Button
        size="lg"
        disabled={!isConnected || bidInFlight || soldOut}
        onClick={() => onClaim(1)}
        className="font-bold text-base px-8 w-full sm:w-auto bg-amber-600 hover:bg-amber-700 min-h-[3rem]"
      >
        {bidInFlight ? "Buying..." : soldOut ? "Sold Out" : `Buy at ${formatCents(price)}`}
      </Button>
    </div>
  );
}

const LOT_STATUS_COLORS: Record<LotStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  active: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30",
  going_once: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
  going_twice: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30",
  sold: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  passed: "bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-500/30",
  withdrawn: "bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-500/30",
};

function LotStatusBadge({ status }: { status: LotStatus }) {
  return (
    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${LOT_STATUS_COLORS[status]}`}>
      {status.replace("_", " ")}
    </Badge>
  );
}

function CountdownBar({ status }: { status: "going_once" | "going_twice" }) {
  const label = status === "going_once" ? "Going once..." : "Going twice...";
  const barColor = status === "going_once" ? "bg-yellow-500" : "bg-orange-500";

  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold">{label}</p>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          key={status}
          className={`h-full rounded-full ${barColor}`}
          style={{ animation: "countdown-shrink 5s linear forwards" }}
        />
      </div>
      <style>{`
        @keyframes countdown-shrink {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
}

function AuctionOverlay({ variant }: { variant: "going_once" | "going_twice" | "sold" }) {
  const config = {
    going_once: { text: "Going Once!", bg: "bg-yellow-500/90", animation: "animate-pulse" },
    going_twice: { text: "Going Twice!", bg: "bg-orange-500/90", animation: "auction-fast-pulse" },
    sold: { text: "SOLD!", bg: "bg-green-600/90", animation: "auction-celebrate" },
  }[variant];

  return (
    <div className={`fixed inset-x-0 top-16 z-50 flex items-center justify-center pointer-events-none`}>
      <div className={`${config.bg} text-white font-black text-2xl sm:text-3xl py-3 px-8 rounded-b-xl shadow-lg ${config.animation}`}>
        {config.text}
      </div>
      <style>{`
        .auction-fast-pulse {
          animation: auction-pulse 0.5s ease-in-out infinite;
        }
        .auction-celebrate {
          animation: auction-pop 0.6s ease-out;
        }
        @keyframes auction-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.85; transform: scale(1.05); }
        }
        @keyframes auction-pop {
          0% { opacity: 0; transform: scale(0.5); }
          60% { transform: scale(1.15); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

function ChatPanel({
  chatMessages,
  viewerCount,
  userId,
  isConnected,
  onSend,
  chatEndRef,
}: {
  chatMessages: ChatMsg[];
  viewerCount: number;
  userId: string;
  isConnected: boolean;
  onSend: (content: string) => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <>
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide hidden md:block">Chat</h2>
        <span className="text-xs text-muted-foreground">{viewerCount} watching</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {chatMessages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No messages yet</p>
        )}
        {chatMessages.map((msg) => (
          <div key={msg.id} className="text-sm">
            <span className={`font-medium text-xs ${msg.userId === userId ? "text-primary" : ""}`}>
              {msg.username}
            </span>
            <p className="text-xs text-muted-foreground">{msg.content}</p>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>
      <ChatInput isConnected={isConnected} onSend={onSend} />
    </>
  );
}

function ChatInput({
  isConnected,
  onSend,
}: {
  isConnected: boolean;
  onSend: (content: string) => void;
}) {
  const [message, setMessage] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setMessage("");
  };

  return (
    <form onSubmit={handleSubmit} className="border-t p-3 flex gap-2">
      <Input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Say something..."
        className="h-8 text-sm"
        disabled={!isConnected}
      />
      <Button type="submit" size="sm" disabled={!isConnected || !message.trim()} className="h-8">
        Send
      </Button>
    </form>
  );
}

type StreamStatus = "connecting" | "live" | "waiting" | "error";

function WhepPlayer({ whepUrl }: { whepUrl: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const [muted, setMuted] = useState(true);
  const [status, setStatus] = useState<StreamStatus>("connecting");

  const cleanup = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
  }, []);

  const connect = useCallback(async (url: string) => {
    if (!mountedRef.current) return;
    cleanup();
    setStatus("connecting");

    try {
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });

      pc.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
        }
      };

      pc.onconnectionstatechange = () => {
        if (!mountedRef.current) return;
        const state = pc.connectionState;
        if (state === "connected") {
          setStatus("live");
        } else if (state === "failed" || state === "disconnected" || state === "closed") {
          setStatus("error");
          scheduleReconnect(url);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp,
      });

      if (resp.status === 404) {
        // Stream not started yet — show waiting, retry
        if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
        setStatus("waiting");
        scheduleReconnect(url);
        return;
      }

      if (!resp.ok) {
        throw new Error(`WHEP ${resp.status}`);
      }

      const answerSdp = await resp.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch {
      if (!mountedRef.current) return;
      setStatus("error");
      scheduleReconnect(url);
    }
  }, [cleanup]);

  const scheduleReconnect = useCallback((url: string) => {
    if (!mountedRef.current) return;
    reconnectTimer.current = setTimeout(() => {
      if (mountedRef.current) connect(url);
    }, 5000);
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    connect(whepUrl);
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [whepUrl, connect, cleanup]);

  const toggleMute = () => {
    setMuted((m) => !m);
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
    }
  };

  return (
    <div className="relative h-[40vh] md:h-[45vh] bg-black shrink-0">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="w-full h-full object-contain"
      />

      {/* Status overlays */}
      {status === "connecting" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-white/60 text-sm animate-pulse">Connecting to stream...</p>
        </div>
      )}
      {status === "waiting" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-white/50 text-sm animate-pulse">Waiting for stream...</p>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-white/50 text-sm">Stream disconnected — reconnecting...</p>
        </div>
      )}

      {/* Mute/unmute control */}
      {status === "live" && (
        <button
          onClick={toggleMute}
          className="absolute bottom-3 right-3 bg-black/60 hover:bg-black/80 text-white rounded-full p-2 transition-colors"
        >
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
      )}

      {/* Tap to unmute overlay (only shown when muted and live) */}
      {status === "live" && muted && (
        <button
          onClick={toggleMute}
          className="absolute inset-0 flex items-end justify-center pb-14 cursor-pointer"
        >
          <span className="bg-black/70 text-white text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5">
            <VolumeX className="h-3.5 w-3.5" /> Tap to unmute
          </span>
        </button>
      )}
    </div>
  );
}
