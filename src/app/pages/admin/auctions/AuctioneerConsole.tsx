"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
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

interface DynamicLot {
  id: string;
  lotNumber: number;
  title: string;
  startingPriceCents: number;
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

  const [dynamicLots, setDynamicLots] = useState<DynamicLot[]>([]);
  const pendingAdds = useRef<{ title: string; startingPriceCents: number }[]>([]);

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

          // Track new lots from quick-add
          if (!prevState) {
            const pending = pendingAdds.current.shift();
            setDynamicLots((dl) => {
              if (dl.some((d) => d.id === msg.lotId)) return dl;
              const maxNum = dl.reduce((m, d) => Math.max(m, d.lotNumber), 0);
              const maxInitial = initialLots.reduce((m, l) => Math.max(m, l.lotNumber), 0);
              return [
                ...dl,
                {
                  id: msg.lotId,
                  lotNumber: Math.max(maxNum, maxInitial) + 1,
                  title: pending?.title ?? "Lot",
                  startingPriceCents: pending?.startingPriceCents ?? (msg.currentBidCents ?? 0),
                },
              ];
            });
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
  }, [initialLots]);

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

  // Combine initial + dynamically-added lots, sorted by lotNumber
  const allLots: { id: string; lotNumber: number; title: string; startingPriceCents: number; thumbnailUrl?: string | null; items?: LotWithItems["items"] }[] = [
    ...initialLots,
    ...dynamicLots.filter((d) => !initialLots.some((l) => l.id === d.id)),
  ].sort((a, b) => a.lotNumber - b.lotNumber);

  const currentLotData = currentLot
    ? allLots.find((l) => l.id === currentLot)
    : null;
  const currentLotState = currentLot ? lots.get(currentLot) : null;

  const statusDot =
    connectionStatus === "connected"
      ? "bg-green-500"
      : connectionStatus === "reconnecting" || connectionStatus === "connecting"
        ? "bg-yellow-500"
        : "bg-red-500";

  const isLive = auctionStatus === "live";
  const isConnected = connectionStatus === "connected";
  const isLotActive = currentLotState && (currentLotState.status === "active" || currentLotState.status === "going_once" || currentLotState.status === "going_twice");
  const hasPendingLots = allLots.some((l) => lots.get(l.id)?.status === "pending");

  // Pre-fill floor bid: current bid + default increment
  const nextBidCents = currentLotState?.currentBidCents != null
    ? currentLotState.currentBidCents + auction.defaultIncrementCents
    : (currentLotData?.startingPriceCents ?? 0);

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
          {allLots.map((lot) => {
            const state = lots.get(lot.id);
            const status = state?.status ?? "pending";
            const isActive = lot.id === currentLot;
            const isSold = status === "sold";
            return (
              <div
                key={lot.id}
                className={`p-2 rounded text-sm cursor-default ${isActive ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/50"}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <LotStatusIndicator status={status} />
                    <span className="font-medium">#{lot.lotNumber}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{lot.title}</p>
                <p className="text-xs font-mono mt-0.5">
                  {isSold && state?.currentBidCents != null
                    ? formatCents(state.currentBidCents)
                    : formatCents(lot.startingPriceCents)}
                </p>
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

          {currentLot && currentLotState && (
            <AuctionControlsPanel
              lotId={currentLot}
              lotStatus={currentLotState.status}
              hasBids={currentLotState.bidCount > 0 && currentLotState.currentBidCents != null}
              hasPendingLots={hasPendingLots}
              isConnected={isConnected}
              onSend={sendMessage}
            />
          )}

          {isLotActive && currentLot && (
            <FloorBidForm
              lotId={currentLot}
              nextBidCents={nextBidCents}
              isConnected={isConnected}
              onSend={sendMessage}
            />
          )}

          <QuickAddLotForm
            isConnected={isConnected}
            onSend={(msg) => {
              pendingAdds.current.push({ title: msg.title, startingPriceCents: msg.startingPriceCents });
              sendMessage(msg);
            }}
          />

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
  lot: { id: string; lotNumber: number; title: string; startingPriceCents: number; thumbnailUrl?: string | null; items?: LotWithItems["items"] };
  state: { status: LotStatus; currentBidCents: number | null; currentBidderId: string | null; currentBidderName: string | null; bidCount: number };
}) {
  const thumbnail = lot.thumbnailUrl ?? lot.items?.[0]?.thumbnailUrl;
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

function AuctionControlsPanel({
  lotId,
  lotStatus,
  hasBids,
  hasPendingLots,
  isConnected,
  onSend,
}: {
  lotId: string;
  lotStatus: LotStatus;
  hasBids: boolean;
  hasPendingLots: boolean;
  isConnected: boolean;
  onSend: (msg: AdminMessage) => void;
}) {
  const disabled = !isConnected;

  const showGoingOnce = lotStatus === "active" && hasBids;
  const showGoingTwice = lotStatus === "going_once";
  const showSold = (lotStatus === "going_once" || lotStatus === "going_twice" || (lotStatus === "active" && hasBids));
  const showPass = lotStatus === "active" || lotStatus === "going_once" || lotStatus === "going_twice";
  const showWithdraw = lotStatus === "active" || lotStatus === "going_once" || lotStatus === "going_twice";
  const showNextItem = hasPendingLots;

  const isCountdown = lotStatus === "going_once" || lotStatus === "going_twice";

  return (
    <div className="space-y-3">
      {isCountdown && (
        <CountdownBar status={lotStatus} />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {showGoingOnce && (
          <Button
            disabled={disabled}
            onClick={() => onSend({ type: "going_once", lotId })}
            className="bg-yellow-500 text-white hover:bg-yellow-600"
          >
            Going Once
          </Button>
        )}
        {showGoingTwice && (
          <Button
            disabled={disabled}
            onClick={() => onSend({ type: "going_twice", lotId })}
            className="bg-orange-500 text-white hover:bg-orange-600"
          >
            Going Twice
          </Button>
        )}
        {showSold && (
          <Button
            disabled={disabled}
            size="lg"
            onClick={() => onSend({ type: "sold", lotId })}
            className="bg-green-600 text-white hover:bg-green-700 font-bold text-base"
          >
            Sold!
          </Button>
        )}
        {showPass && (
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() => onSend({ type: "pass", lotId })}
          >
            Pass
          </Button>
        )}
        {showWithdraw && (
          <Button
            variant="destructive"
            size="sm"
            disabled={disabled}
            onClick={() => onSend({ type: "withdraw", lotId })}
          >
            Withdraw
          </Button>
        )}

        {showNextItem && (
          <Button
            disabled={disabled}
            onClick={() => onSend({ type: "advance_lot" })}
            className="ml-auto"
          >
            Next Item
          </Button>
        )}
      </div>
    </div>
  );
}

function CountdownBar({ status }: { status: "going_once" | "going_twice" }) {
  const label = status === "going_once" ? "Going once..." : "Going twice...";
  const barColor = status === "going_once"
    ? "bg-yellow-500"
    : "bg-orange-500";

  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold">{label}</p>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          key={status}
          className={`h-full rounded-full ${barColor}`}
          style={{
            animation: "countdown-shrink 5s linear forwards",
          }}
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

function LotStatusIndicator({ status }: { status: LotStatus }) {
  switch (status) {
    case "pending":
      return <span className="inline-block h-2 w-2 rounded-full bg-gray-400" />;
    case "active":
    case "going_once":
    case "going_twice":
      return <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" />;
    case "sold":
      return <span className="text-green-600 dark:text-green-400 text-xs font-bold leading-none">✓</span>;
    case "passed":
      return <span className="text-gray-500 text-xs font-bold leading-none">✕</span>;
    case "withdrawn":
      return <span className="text-gray-500 text-xs font-bold leading-none">–</span>;
  }
}

function QuickAddLotForm({
  isConnected,
  onSend,
}: {
  isConnected: boolean;
  onSend: (msg: { type: "quick_add_lot"; title: string; startingPriceCents: number }) => void;
}) {
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle || !price) return;
    const dollars = parseFloat(price);
    if (isNaN(dollars) || dollars <= 0) return;
    onSend({ type: "quick_add_lot", title: trimmedTitle, startingPriceCents: Math.round(dollars * 100) });
    setTitle("");
    setPrice("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <div className="flex-1 min-w-0">
        <label className="text-xs text-muted-foreground">Title</label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Lot title"
          className="h-8 text-sm"
        />
      </div>
      <div className="w-24">
        <label className="text-xs text-muted-foreground">Price ($)</label>
        <Input
          type="number"
          min="0.01"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="0.00"
          className="h-8 text-sm"
        />
      </div>
      <Button type="submit" size="sm" disabled={!isConnected || !title.trim() || !price} className="h-8">
        Add &amp; Activate
      </Button>
    </form>
  );
}

function FloorBidForm({
  lotId,
  nextBidCents,
  isConnected,
  onSend,
}: {
  lotId: string;
  nextBidCents: number;
  isConnected: boolean;
  onSend: (msg: AdminMessage) => void;
}) {
  const [amount, setAmount] = useState((nextBidCents / 100).toFixed(2));
  const [bidderName, setBidderName] = useState("");

  // Update pre-fill when nextBidCents changes
  useEffect(() => {
    setAmount((nextBidCents / 100).toFixed(2));
  }, [nextBidCents]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = bidderName.trim();
    if (!trimmedName || !amount) return;
    const dollars = parseFloat(amount);
    if (isNaN(dollars) || dollars <= 0) return;
    onSend({ type: "floor_bid", lotId, amountCents: Math.round(dollars * 100), onBehalfOfName: trimmedName });
    setBidderName("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <div className="w-28">
        <label className="text-xs text-muted-foreground">Bid ($)</label>
        <Input
          type="number"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="h-8 text-sm"
        />
      </div>
      <div className="flex-1 min-w-0">
        <label className="text-xs text-muted-foreground">Bidder name</label>
        <Input
          value={bidderName}
          onChange={(e) => setBidderName(e.target.value)}
          placeholder="Floor bidder"
          className="h-8 text-sm"
        />
      </div>
      <Button type="submit" size="sm" variant="secondary" disabled={!isConnected || !bidderName.trim() || !amount} className="h-8">
        Place Floor Bid
      </Button>
    </form>
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
