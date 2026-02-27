"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Badge } from "@/app/components/ui/badge";
import type { AuctionsTable, LotsTable } from "@/db";
import type {
  ServerMessage,
  AdminMessage,
  LotStatus,
  AuctionStatus,
} from "@/auction/types";

// ─── Types ──────────────────────────────────────────────────────────

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

interface BidFeedEntry {
  lotId: string;
  amountCents: number;
  userId: string;
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
  const [lots, setLots] = useState<Map<string, { status: LotStatus; currentBidCents: number | null; currentBidderId: string | null; bidCount: number }>>(
    () => new Map(initialLots.map((l) => [l.id, { status: l.status as LotStatus, currentBidCents: l.currentBidCents, currentBidderId: l.currentBidderId, bidCount: l.bidCount }])),
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
          const next = new Map(prev);
          next.set(msg.lotId, {
            status: msg.status,
            currentBidCents: msg.currentBidCents,
            currentBidderId: msg.currentBidderId,
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
        setBidFeed((prev) => [
          { lotId: msg.lotId, amountCents: msg.amountCents, userId: msg.userId, bidCount: msg.bidCount, timestamp: Date.now() },
          ...prev,
        ].slice(0, 50));
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
        <main className="overflow-y-auto p-4 space-y-4">
          {currentLotData && currentLotState ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">
                  Lot #{currentLotData.lotNumber}: {currentLotData.title}
                </h2>
                <LotStatusBadge status={currentLotState.status} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Stat label="Current bid" value={currentLotState.currentBidCents != null ? `$${(currentLotState.currentBidCents / 100).toFixed(2)}` : "No bids"} />
                <Stat label="Starting" value={`$${(currentLotData.startingPriceCents / 100).toFixed(2)}`} />
                <Stat label="Bids" value={String(currentLotState.bidCount)} />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              No active lot
            </div>
          )}

          {/* Bid feed */}
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Bid Feed</h3>
            <div className="space-y-1">
              {bidFeed.length === 0 && (
                <p className="text-xs text-muted-foreground">No bids yet</p>
              )}
              {bidFeed.map((bid, i) => (
                <div key={`${bid.lotId}-${bid.timestamp}-${i}`} className="flex items-center justify-between text-sm py-1 border-b border-border/50">
                  <span className="font-mono">${(bid.amountCents / 100).toFixed(2)}</span>
                  <span className="text-xs text-muted-foreground truncate max-w-[120px]">{bid.userId}</span>
                </div>
              ))}
            </div>
          </div>
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

// ─── Sub-components ─────────────────────────────────────────────────

function LotStatusBadge({ status }: { status: LotStatus }) {
  const variants: Record<LotStatus, "default" | "secondary" | "destructive" | "outline"> = {
    pending: "secondary",
    active: "default",
    going_once: "destructive",
    going_twice: "destructive",
    sold: "outline",
    passed: "outline",
    withdrawn: "outline",
  };
  return <Badge variant={variants[status]} className="text-[10px] px-1.5 py-0">{status.replace("_", " ")}</Badge>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
