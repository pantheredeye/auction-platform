"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Badge } from "@/app/components/ui/badge";
import { Card, CardContent } from "@/app/components/ui/card";
import type { AuctionsTable, LotsTable } from "@/db";
import type {
  ServerMessage,
  AdminMessage,
  LotStatus,
  AuctionStatus,
} from "@/auction/types";
import { formatCents } from "@/lib/money";
import { imageUrl } from "@/lib/image-url";

// ─── Types ──────────────────────────────────────────────────────────

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

interface BidFeedEntry {
  lotId: string;
  amountCents: number;
  userId: string;
  username: string;
  isFloor: boolean;
  bidCount: number;
  timestamp: number;
}

interface ChatMsg {
  id: string;
  userId: string;
  username: string;
  content: string;
  createdAt: string;
}

interface LotWithItems extends LotsTable {
  items: {
    id: string;
    productId: string;
    quantity: number;
    title: string;
    sku: string | null;
    thumbnailUrl: string | null;
  }[];
}

interface AuctioneerConsoleProps {
  auction: AuctionsTable;
  initialLots: LotWithItems[];
}

// ─── Component ──────────────────────────────────────────────────────

export function AuctioneerConsole({ auction, initialLots }: AuctioneerConsoleProps) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [currentLot, setCurrentLot] = useState<string | null>(null);
  const [lots, setLots] = useState<Map<string, { status: LotStatus; currentBidCents: number | null; currentBidderId: string | null; currentBidderName: string | null; bidCount: number }>>(
    () => new Map(initialLots.map((l) => [l.id, { status: l.status as LotStatus, currentBidCents: l.currentBidCents, currentBidderId: l.currentBidderId, currentBidderName: null, bidCount: l.bidCount }])),
  );
  const [auctionStatus, setAuctionStatus] = useState<AuctionStatus>(auction.status as AuctionStatus);
  const [bidFeed, setBidFeed] = useState<BidFeedEntry[]>([]);
  const [viewerCount, setViewerCount] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  const sendMessage = useCallback((msg: AdminMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "lot_update":
        setLots((prev) => {
          const prevState = prev.get(msg.lotId);
          // Detect new bid: bidCount increased
          if (prevState && msg.bidCount > prevState.bidCount && msg.currentBidCents != null) {
            const isFloor = msg.currentBidderName?.includes("(floor)") ?? false;
            const displayName = isFloor
              ? (msg.currentBidderName?.replace(" (floor)", "") ?? msg.currentBidderId ?? "Unknown")
              : (msg.currentBidderName ?? msg.currentBidderId ?? "Unknown");
            setBidFeed((feed) => [
              ...feed,
              { lotId: msg.lotId, amountCents: msg.currentBidCents!, userId: msg.currentBidderId ?? "", username: displayName, isFloor, bidCount: msg.bidCount, timestamp: Date.now() },
            ].slice(-50));
          }
          const next = new Map(prev);
          next.set(msg.lotId, {
            status: msg.status,
            currentBidCents: msg.currentBidCents,
            currentBidderId: msg.currentBidderId,
            currentBidderName: msg.currentBidderName,
            bidCount: msg.bidCount,
          });
          return next;
        });
        if (msg.status === "active" || msg.status === "going_once" || msg.status === "going_twice") {
          setCurrentLot(msg.lotId);
        }
        break;

      case "auction_update":
        setAuctionStatus(msg.status);
        break;

      case "bid_accepted":
        // bid_accepted only comes to the bidder's own socket; bid feed is built from lot_update
        break;

      case "bid_rejected":
        toast.error(`Bid rejected: ${msg.reason}`);
        break;

      case "chat_message":
        setChatMessages((prev) => [
          ...prev,
          { id: msg.id, userId: msg.userId, username: msg.username, content: msg.content, createdAt: msg.createdAt },
        ].slice(-100));
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
  }, []);

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
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!isMounted.current) return;
        setConnectionStatus("disconnected");
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire after onerror, which handles reconnect
      };
    }

    function scheduleReconnect() {
      if (!isMounted.current) return;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempt.current), 10000);
      reconnectAttempt.current++;
      setConnectionStatus("reconnecting");
      reconnectTimer.current = setTimeout(connect, delay);
    }

    // Ping keepalive
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

  // ─── Derived state ──────────────────────────────────────────────

  const currentLotData = currentLot
    ? initialLots.find((l) => l.id === currentLot)
    : null;
  const currentLotState = currentLot ? lots.get(currentLot) : null;

  const statusDot =
    connectionStatus === "connected"
      ? "bg-green-500"
      : connectionStatus === "reconnecting" || connectionStatus === "connecting"
        ? "bg-yellow-500"
        : "bg-red-500";

  const isLive = auctionStatus === "live";

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <header className="flex items-center justify-between border-b px-4 py-2 bg-background">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold truncate">{auction.title}</h1>
          {isLive && (
            <Badge variant="destructive" className="animate-pulse">
              LIVE
            </Badge>
          )}
          {!isLive && (
            <Badge variant="secondary">{auctionStatus}</Badge>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className={`inline-block h-2 w-2 rounded-full ${statusDot}`} />
            <span>{connectionStatus}</span>
          </div>
          <div className="text-sm text-muted-foreground">
            {viewerCount} viewer{viewerCount !== 1 ? "s" : ""}
          </div>
        </div>
      </header>

      {/* Main grid */}
      <div className="flex-1 grid grid-cols-[280px_1fr_280px] gap-0 overflow-hidden">
        {/* Left: Lot queue */}
        <aside className="border-r overflow-y-auto p-3 space-y-1">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Lots</h2>
          {initialLots.map((lot) => {
            const state = lots.get(lot.id);
            const isActive = lot.id === currentLot;
            return (
              <div
                key={lot.id}
                className={`p-2 rounded text-sm cursor-default ${isActive ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/50"}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">#{lot.lotNumber}</span>
                  <LotStatusBadge status={state?.status ?? (lot.status as LotStatus)} />
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{lot.title}</p>
                {state?.currentBidCents != null && (
                  <p className="text-xs font-mono mt-0.5">${(state.currentBidCents / 100).toFixed(2)}</p>
                )}
              </div>
            );
          })}
        </aside>

        {/* Center: Current lot + bid feed */}
        <main className="overflow-y-auto p-4 flex flex-col gap-4">
          {currentLotData && currentLotState ? (
            <CurrentLotCard lot={currentLotData} state={currentLotState} />
          ) : (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              No active lot
            </div>
          )}

          <BidFeedPanel entries={bidFeed} />
        </main>

        {/* Right: Chat */}
        <aside className="border-l overflow-y-auto p-3">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Chat</h2>
          <div className="space-y-2">
            {chatMessages.length === 0 && (
              <p className="text-xs text-muted-foreground">No messages yet</p>
            )}
            {chatMessages.map((msg) => (
              <div key={msg.id} className="text-sm">
                <span className="font-medium text-xs">{msg.username}</span>
                <p className="text-xs text-muted-foreground">{msg.content}</p>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

// ─── Sub-components ─────────────────────────────────────────────────

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

function CurrentLotCard({
  lot,
  state,
}: {
  lot: LotWithItems;
  state: { status: LotStatus; currentBidCents: number | null; currentBidderId: string | null; currentBidderName: string | null; bidCount: number };
}) {
  const thumbnail = lot.thumbnailUrl ?? lot.items[0]?.thumbnailUrl;
  const hasBids = state.bidCount > 0 && state.currentBidCents != null;
  const bidderDisplay = state.currentBidderName?.replace(" (floor)", "") ?? state.currentBidderId;

  return (
    <Card className="py-4">
      <CardContent className="flex gap-4">
        {/* Lot image */}
        <div className="w-28 h-28 flex-shrink-0 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
          {thumbnail ? (
            <img src={imageUrl(thumbnail)} alt={lot.title} className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs text-muted-foreground">No image</span>
          )}
        </div>

        {/* Lot info */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground">Lot #{lot.lotNumber}</p>
              <h2 className="text-xl font-bold leading-tight truncate">{lot.title}</h2>
            </div>
            <LotStatusBadge status={state.status} />
          </div>

          <div className="flex items-baseline gap-6">
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

          {hasBids && bidderDisplay && (
            <p className="text-sm text-muted-foreground truncate">
              High bidder: <span className="font-medium text-foreground">{bidderDisplay}</span>
              {state.currentBidderName?.includes("(floor)") && (
                <span className="ml-1 text-amber-600 dark:text-amber-400 text-xs font-medium">(floor)</span>
              )}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function BidFeedPanel({ entries }: { entries: BidFeedEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Bid Feed</h3>
      <div className="flex-1 overflow-y-auto border rounded-lg p-2 space-y-0.5 min-h-[120px]">
        {entries.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No bids yet</p>
        )}
        {entries.map((bid, i) => (
          <div key={`${bid.lotId}-${bid.timestamp}-${i}`} className="flex items-center justify-between text-sm py-1.5 px-2 rounded hover:bg-muted/50">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono font-semibold">{formatCents(bid.amountCents)}</span>
              <span className="text-muted-foreground truncate max-w-[140px]">{bid.username}</span>
              {bid.isFloor && (
                <span className="text-amber-600 dark:text-amber-400 text-xs font-medium shrink-0">(floor)</span>
              )}
            </div>
            <span className="text-xs text-muted-foreground shrink-0 ml-2">{timeAgo(bid.timestamp)}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
