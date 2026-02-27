"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Toaster } from "@/app/components/ui/sonner";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import type { AuctionsTable, LotsTable } from "@/db";
import type {
  ServerMessage,
  ClientMessage,
  LotStatus,
  AuctionStatus,
} from "@/auction/types";
import { formatCents } from "@/lib/money";
import { imageUrl } from "@/lib/image-url";

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
      ? { status: initialActiveLot.status as LotStatus, currentBidCents: initialActiveLot.currentBidCents, currentBidderId: initialActiveLot.currentBidderId, currentBidderName: null, bidCount: initialActiveLot.bidCount }
      : null,
  );
  const [upcomingLots, setUpcomingLots] = useState(initialUpcomingLots);
  const [viewerCount, setViewerCount] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [myLastBidLotId, setMyLastBidLotId] = useState<string | null>(null);
  const [bidInFlight, setBidInFlight] = useState(false);
  const [soldOverlay, setSoldOverlay] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  // Track all known lots for state updates
  const lotsRef = useRef<Map<string, LotDynamic>>(new Map());

  const sendMessage = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "lot_update": {
        const dynamic: LotDynamic = {
          status: msg.status,
          currentBidCents: msg.currentBidCents,
          currentBidderId: msg.currentBidderId,
          currentBidderName: msg.currentBidderName,
          bidCount: msg.bidCount,
        };
        lotsRef.current.set(msg.lotId, dynamic);

        // Outbid detection
        if (
          myLastBidLotId === msg.lotId &&
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

      case "chat_message":
        setChatMessages((prev) =>
          [...prev, { id: msg.id, userId: msg.userId, username: msg.username, content: msg.content, createdAt: msg.createdAt }].slice(-100),
        );
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
  }, [userId, myLastBidLotId]);

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

  const isCountdown = currentLotState?.status === "going_once" || currentLotState?.status === "going_twice";

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
          <div className="text-sm text-muted-foreground">
            {viewerCount} viewer{viewerCount !== 1 ? "s" : ""}
          </div>
        </div>
      </header>

      {/* Going once / Going twice / Sold overlays */}
      {currentLotState?.status === "going_once" && (
        <AuctionOverlay variant="going_once" />
      )}
      {currentLotState?.status === "going_twice" && (
        <AuctionOverlay variant="going_twice" />
      )}
      {soldOverlay && (
        <AuctionOverlay variant="sold" />
      )}

      {/* Main content: mobile stack / desktop side-by-side */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">

        {/* Left: Stream + Lot + Bid (mobile: stacked, desktop: 60%) */}
        <div className="flex-1 md:w-3/5 flex flex-col overflow-y-auto">

          {/* Stream placeholder */}
          <div className="h-[40vh] md:h-[45vh] bg-black flex items-center justify-center shrink-0">
            <p className="text-white/50 text-sm">Live stream</p>
          </div>

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
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Up next</h3>
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

        {/* Right: Chat panel (desktop: 40%, mobile: below) */}
        <aside className="md:w-2/5 border-t md:border-t-0 md:border-l flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Chat</h2>
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
          </div>
          <ChatInput isConnected={isConnected} onSend={(content) => sendMessage({ type: "chat", content })} />
        </aside>
      </div>

      {/* Sticky bottom bid bar — always visible */}
      <div className="border-t bg-background px-4 py-3 shrink-0">
        {isLotActive && currentLot ? (
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">
                {hasBids ? "Current bid" : "Starting at"}
              </p>
              <p className="text-lg font-bold tabular-nums">
                {hasBids ? formatCents(currentLotState!.currentBidCents!) : formatCents(currentLot.startingPriceCents)}
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
                onClick={handleBid}
                className="font-bold text-base px-8 w-full sm:w-auto bg-green-600 hover:bg-green-700 min-h-[3rem]"
              >
                {bidInFlight ? "Placing bid..." : `Bid ${formatCents(nextBidCents)}`}
              </Button>
            )}
          </div>
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
            <LotStatusBadge status={state.status} />
          </div>
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
        </div>
      </CardContent>
    </Card>
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
