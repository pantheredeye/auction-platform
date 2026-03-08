"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
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
  SaleMode,
} from "@/auction/types";
import { formatCents } from "@/lib/money";
import { imageUrl } from "@/lib/image-url";
import { transitionAuctionStatus } from "./server-functions/auctions";
import { Volume2, VolumeX, ChevronDown, ChevronUp, MessageSquare, List, Share2 } from "lucide-react";

// ─── Audio cue via Web Audio API ─────────────────────────────────

let audioCtx: AudioContext | null = null;
let audioMutedGlobal = false;

function playDing() {
  if (audioMutedGlobal) return;
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.15);
  } catch {
    // audio not available
  }
}

// ─── Types ──────────────────────────────────────────────────────────

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";
type StreamStatus = "idle" | "previewing" | "connecting" | "live" | "error";

interface BidFeedEntry {
  lotId: string;
  amountCents: number;
  userId: string;
  username: string;
  isFloor: boolean;
  isClaim: boolean;
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
  saleMode?: SaleMode;
}

interface LotDynamicState {
  status: LotStatus;
  currentBidCents: number | null;
  currentBidderId: string | null;
  currentBidderName: string | null;
  bidCount: number;
  saleMode: SaleMode;
  quantity: number;
  quantityClaimed: number;
}

interface AuctioneerConsoleProps {
  auction: AuctionsTable;
  initialLots: LotWithItems[];
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["scheduled", "preview", "live"],
  scheduled: ["preview", "live", "draft"],
  preview: ["live", "draft"],
  live: ["closing", "closed"],
  closing: ["closed"],
  closed: ["settled"],
  settled: ["archived"],
};

// ─── Component ──────────────────────────────────────────────────────

export function AuctioneerConsole({ auction, initialLots }: AuctioneerConsoleProps) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [currentLot, setCurrentLot] = useState<string | null>(null);
  const [lots, setLots] = useState<Map<string, LotDynamicState>>(
    () => new Map(initialLots.map((l) => [l.id, { status: l.status as LotStatus, currentBidCents: l.currentBidCents, currentBidderId: l.currentBidderId, currentBidderName: null, bidCount: l.bidCount, saleMode: (l.saleMode ?? "english") as SaleMode, quantity: l.quantity ?? 1, quantityClaimed: l.quantityClaimed ?? 0 }])),
  );
  const [audioMuted, setAudioMuted] = useState(false);
  const [auctionStatus, setAuctionStatus] = useState<AuctionStatus>(auction.status as AuctionStatus);
  const [bidFeed, setBidFeed] = useState<BidFeedEntry[]>([]);
  const [viewerCount, setViewerCount] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);

  const [dynamicLots, setDynamicLots] = useState<DynamicLot[]>([]);
  const pendingAdds = useRef<{ title: string; startingPriceCents: number; saleMode?: SaleMode }[]>([]);

  // Stream state
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

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

  const handleAuctionTransition = useCallback(async (toStatus: string) => {
    try {
      if (toStatus === "live") {
        sendMessage({ type: "start_auction" });
      } else if (toStatus === "closed") {
        sendMessage({ type: "close_auction" });
        // Stop recorder + stream + clean up tracks
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current = null;
        }
        if (pcRef.current) {
          pcRef.current.close();
          pcRef.current = null;
          setStreamStatus("previewing");
        }
        fetch(`/ingest/${auction.id}`, { method: "DELETE" }).catch(() => {});
      } else {
        await transitionAuctionStatus(auction.id, toStatus, undefined, auction.version);
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to transition auction");
    }
  }, [auction.id, auction.version, sendMessage]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setStreamStatus("previewing");
    } catch (err: any) {
      console.error("Camera access denied:", err);
      const msg = err?.name === "NotAllowedError"
        ? "Camera access denied. Please allow camera and microphone permissions in your browser settings."
        : err?.name === "NotFoundError"
          ? "No camera or microphone found. Please connect a device and try again."
          : "Could not access camera. Please check your device and permissions.";
      setCameraError(msg);
      setStreamStatus("error");
    }
  }, []);

  const stopCamera = useCallback(() => {
    // Close peer connection if active
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    // Stop all tracks
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStreamStatus("idle");
  }, []);

  const startMediaRecorder = useCallback(() => {
    if (!mediaStreamRef.current) return;
    recordedChunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ? "video/webm;codecs=vp8,opus"
        : "video/webm";
    try {
      const recorder = new MediaRecorder(mediaStreamRef.current, {
        mimeType,
        videoBitsPerSecond: 2_500_000,
      });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.start(5000); // 5s timeslice chunks
      mediaRecorderRef.current = recorder;
    } catch (err) {
      console.error("MediaRecorder start failed:", err);
      // Non-fatal: stream still works without recording
    }
  }, []);

  const stopMediaRecorder = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
  }, []);

  const startStream = useCallback(async () => {
    if (!mediaStreamRef.current) return;
    setStreamStatus("connecting");

    try {
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      for (const track of mediaStreamRef.current.getTracks()) {
        pc.addTrack(track, mediaStreamRef.current);
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const resp = await fetch(`/ingest/${auction.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp,
      });

      if (!resp.ok) {
        throw new Error(`WHIP negotiation failed: ${resp.status}`);
      }

      const answerSdp = await resp.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      // Start MediaRecorder reusing same getUserMedia stream
      startMediaRecorder();

      // Transition auction status to live
      handleAuctionTransition("live");

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setStreamStatus("live");
        } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          setStreamStatus("error");
        }
      };

      if (pc.connectionState === "connected") {
        setStreamStatus("live");
      }
    } catch (err) {
      console.error("Stream start failed:", err);
      toast.error("Failed to start stream");
      stopMediaRecorder();
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      setStreamStatus("previewing");
    }
  }, [auction.id, startMediaRecorder, stopMediaRecorder, handleAuctionTransition]);

  const stopStream = useCallback(() => {
    stopMediaRecorder();
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    // Clean up tracks in LiveStore DO
    fetch(`/ingest/${auction.id}`, { method: "DELETE" }).catch(() => {});
    setStreamStatus("previewing");
  }, [auction.id, stopMediaRecorder]);

  // Auto-start camera preview on mount
  useEffect(() => {
    startCamera();
  }, [startCamera]);

  // Cleanup camera/stream/recorder on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (pcRef.current) {
        pcRef.current.close();
        // Best-effort cleanup of tracks in DO on unmount
        fetch(`/ingest/${auction.id}`, { method: "DELETE" }).catch(() => {});
      }
      if (mediaStreamRef.current) {
        for (const track of mediaStreamRef.current.getTracks()) track.stop();
      }
    };
  }, []);

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "lot_update":
        setLots((prev) => {
          const prevState = prev.get(msg.lotId);
          // Detect new bid/claim: bidCount increased
          if (prevState && msg.bidCount > prevState.bidCount) {
            const isFloor = msg.currentBidderName?.includes("(floor)") ?? false;
            const displayName = isFloor
              ? (msg.currentBidderName?.replace(" (floor)", "") ?? msg.currentBidderId ?? "Unknown")
              : (msg.currentBidderName ?? msg.currentBidderId ?? "Unknown");
            const lotSaleMode = msg.saleMode ?? prevState?.saleMode ?? "english";
            const isClaim = lotSaleMode === "live_sell" || lotSaleMode === "dutch";
            setBidFeed((feed) => [
              ...feed,
              { lotId: msg.lotId, amountCents: msg.currentBidCents ?? 0, userId: msg.currentBidderId ?? "", username: displayName, isFloor, isClaim, bidCount: msg.bidCount, timestamp: Date.now() },
            ].slice(-50));
            // Audio cue
            playDing();
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
                  saleMode: msg.saleMode,
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
            saleMode: msg.saleMode ?? prevState?.saleMode ?? "english",
            quantity: msg.quantity ?? prevState?.quantity ?? 1,
            quantityClaimed: msg.quantityClaimed ?? prevState?.quantityClaimed ?? 0,
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
      case "claim_accepted":
        break;

      case "bid_rejected":
        toast.error(`Bid rejected: ${msg.reason}`);
        break;

      case "claim_rejected":
        toast.error(`Claim rejected: ${msg.reason}`);
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
  const allLots: { id: string; lotNumber: number; title: string; startingPriceCents: number; thumbnailUrl?: string | null; items?: LotWithItems["items"]; saleMode?: string }[] = [
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

  // ─── Collapsible panels for small screens ─────────────────────
  const [lotsOpen, setLotsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [liveControlsOpen, setLiveControlsOpen] = useState(false);

  // ─── Render ─────────────────────────────────────────────────────

  const lotQueue = (
    <>
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
                {(state?.saleMode ?? (lot as { saleMode?: string }).saleMode ?? "english") !== "english" && (
                  <span className="text-[9px] px-1 py-0 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400">
                    {(state?.saleMode ?? (lot as { saleMode?: string }).saleMode) === "live_sell" ? "LS" : "DU"}
                  </span>
                )}
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
    </>
  );

  const chatPanel = (
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
  );

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 bg-background">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-lg font-semibold truncate">{auction.title}</h1>
          {isLive && (
            <Badge variant="destructive" className="animate-pulse shrink-0">
              LIVE
            </Badge>
          )}
          {!isLive && (
            <Badge variant="secondary" className="shrink-0">{auctionStatus}</Badge>
          )}
          {(VALID_TRANSITIONS[auctionStatus] || []).map((t) => (
            <button
              key={t}
              onClick={() => handleAuctionTransition(t)}
              className="inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              → {t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className={`inline-block h-2 w-2 rounded-full ${statusDot}`} />
            <span className="hidden sm:inline">{connectionStatus}</span>
          </div>
          <div className="text-sm text-muted-foreground">
            {viewerCount} <span className="hidden sm:inline">viewer{viewerCount !== 1 ? "s" : ""}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => { setAudioMuted((m) => { audioMutedGlobal = !m; return !m; }); }}
          >
            {audioMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {/* Main grid — responsive. When live: 2-col (no lot sidebar), otherwise 3-col */}
      <div className={`flex-1 grid gap-0 overflow-hidden ${isLive ? "grid-cols-1 md:grid-cols-[1fr_240px]" : "grid-cols-1 md:grid-cols-[1fr_240px] lg:grid-cols-[240px_1fr_240px]"}`}>
        {/* Left: Lot queue — visible lg+ when not live, hidden when live (collapsed into main area) */}
        {!isLive && (
          <aside className="hidden lg:block border-r overflow-y-auto p-3 space-y-1">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Lots</h2>
            {lotQueue}
          </aside>
        )}

        {/* Center: Stream + current lot + bid feed */}
        <main className="overflow-y-auto p-4 flex flex-col gap-4">
          {/* Collapsible lots on small/medium screens (hidden when live — lots collapse below) */}
          {!isLive && (
            <div className="lg:hidden">
              <button
                onClick={() => setLotsOpen(!lotsOpen)}
                className="flex items-center gap-2 w-full text-left text-sm font-medium text-muted-foreground hover:text-foreground py-1"
              >
                <List className="h-4 w-4" />
                Lots ({allLots.length})
                {lotsOpen ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
              </button>
              {lotsOpen && (
                <div className="border rounded-lg p-2 mt-1 max-h-48 overflow-y-auto space-y-1">
                  {lotQueue}
                </div>
              )}
            </div>
          )}

          {isLive ? (
            <>
              {/* Expanded video when live — no card wrapper, fills main area */}
              <div className="relative flex-shrink-0">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full rounded-lg bg-black aspect-video"
                />
                {/* Live indicator overlay */}
                <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-white text-xs font-semibold">LIVE</span>
                </div>
              </div>

              {/* Minimal control strip */}
              <div className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-2">
                <div className="flex items-center gap-3 text-sm">
                  <span className="font-medium">{viewerCount} viewer{viewerCount !== 1 ? "s" : ""}</span>
                  {currentLotData && currentLotState && (
                    <span className="text-muted-foreground">
                      Lot #{currentLotData.lotNumber} · <span className="font-mono font-semibold">{formatCents(currentLotState.currentBidCents ?? currentLotData.startingPriceCents)}</span>
                    </span>
                  )}
                </div>
                <Button size="sm" variant="destructive" onClick={stopStream}>
                  Stop Stream
                </Button>
              </div>

              {/* Current lot — always visible */}
              {currentLotData && currentLotState ? (
                <CurrentLotCard lot={currentLotData} state={currentLotState} />
              ) : (
                <div className="flex items-center justify-center h-20 text-muted-foreground text-sm">
                  No active lot
                </div>
              )}

              {/* Auction controls — always visible when lot active */}
              {currentLot && currentLotState && (
                <AuctionControlsPanel
                  lotId={currentLot}
                  lotStatus={currentLotState.status}
                  saleMode={currentLotState.saleMode}
                  hasBids={currentLotState.bidCount > 0 && currentLotState.currentBidCents != null}
                  hasClaims={currentLotState.quantityClaimed > 0}
                  quantity={currentLotState.quantity}
                  quantityClaimed={currentLotState.quantityClaimed}
                  hasPendingLots={hasPendingLots}
                  isConnected={isConnected}
                  onSend={sendMessage}
                />
              )}

              {isLotActive && currentLot && currentLotState?.saleMode === "english" && (
                <FloorBidForm
                  lotId={currentLot}
                  nextBidCents={nextBidCents}
                  isConnected={isConnected}
                  onSend={sendMessage}
                />
              )}

              {/* Lot management — collapsed by default when live */}
              <div>
                <button
                  onClick={() => setLiveControlsOpen(!liveControlsOpen)}
                  className="flex items-center gap-2 w-full text-left text-sm font-medium text-muted-foreground hover:text-foreground py-1"
                >
                  <List className="h-4 w-4" />
                  Lot Queue & Quick Add ({allLots.length} lots)
                  {liveControlsOpen ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
                </button>
                {liveControlsOpen && (
                  <div className="border rounded-lg p-3 mt-1 space-y-3">
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {lotQueue}
                    </div>
                    <QuickAddLotForm
                      isConnected={isConnected}
                      onSend={(msg) => {
                        pendingAdds.current.push({ title: msg.title, startingPriceCents: msg.startingPriceCents, saleMode: msg.saleMode });
                        sendMessage(msg);
                      }}
                    />
                  </div>
                )}
              </div>

              <BidFeedPanel entries={bidFeed} />
            </>
          ) : (
            <>
              <StreamPanel
                streamStatus={streamStatus}
                cameraError={cameraError}
                videoRef={videoRef}
                onStartCamera={startCamera}
                onStopCamera={stopCamera}
                onStartStream={startStream}
                onStopStream={stopStream}
              />

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
                  saleMode={currentLotState.saleMode}
                  hasBids={currentLotState.bidCount > 0 && currentLotState.currentBidCents != null}
                  hasClaims={currentLotState.quantityClaimed > 0}
                  quantity={currentLotState.quantity}
                  quantityClaimed={currentLotState.quantityClaimed}
                  hasPendingLots={hasPendingLots}
                  isConnected={isConnected}
                  onSend={sendMessage}
                />
              )}

              {isLotActive && currentLot && currentLotState?.saleMode === "english" && (
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
                  pendingAdds.current.push({ title: msg.title, startingPriceCents: msg.startingPriceCents, saleMode: msg.saleMode });
                  sendMessage(msg);
                }}
              />

              <BidFeedPanel entries={bidFeed} />
            </>
          )}

          {/* Share section */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Share</h2>
            <p className="text-sm font-mono break-all select-all">{`${typeof window !== "undefined" ? window.location.origin : ""}/live/${auction.slug}`}</p>
            <div className="flex justify-center py-2">
              <QRCodeSVG
                value={`${typeof window !== "undefined" ? window.location.origin : ""}/live/${auction.slug}`}
                size={160}
                level="M"
                bgColor="#ffffff"
                fgColor="#000000"
                className="rounded"
              />
            </div>
            <Button
              variant="outline"
              className="w-full min-h-[48px] text-sm font-medium"
              onClick={async () => {
                const url = `${window.location.origin}/live/${auction.slug}`;
                if (navigator.share) {
                  try {
                    await navigator.share({ title: auction.title, url });
                  } catch {
                    // user cancelled
                  }
                } else {
                  await navigator.clipboard.writeText(url);
                  toast.success("Link copied to clipboard");
                }
              }}
            >
              <Share2 className="h-4 w-4" />
              Share
            </Button>
          </div>

          {/* Collapsible chat on small screens */}
          <div className="md:hidden">
            <button
              onClick={() => setChatOpen(!chatOpen)}
              className="flex items-center gap-2 w-full text-left text-sm font-medium text-muted-foreground hover:text-foreground py-1"
            >
              <MessageSquare className="h-4 w-4" />
              Chat ({chatMessages.length})
              {chatOpen ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
            </button>
            {chatOpen && (
              <div className="border rounded-lg p-2 mt-1 max-h-48 overflow-y-auto">
                {chatPanel}
              </div>
            )}
          </div>
        </main>

        {/* Right: Chat — visible md+, collapsible on small */}
        <aside className="hidden md:block border-l overflow-y-auto p-3">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Chat</h2>
          {chatPanel}
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
  state: LotDynamicState;
}) {
  const thumbnail = lot.thumbnailUrl ?? lot.items?.[0]?.thumbnailUrl;
  const hasBids = state.bidCount > 0 && state.currentBidCents != null;
  const bidderDisplay = state.currentBidderName?.replace(" (floor)", "") ?? state.currentBidderId;
  const isClaimMode = state.saleMode === "live_sell" || state.saleMode === "dutch";

  return (
    <Card className="py-4">
      <CardContent className="flex gap-4">
        <div className="w-28 h-28 flex-shrink-0 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
          {thumbnail ? (
            <img src={imageUrl(thumbnail)} alt={lot.title} className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs text-muted-foreground">No image</span>
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground">Lot #{lot.lotNumber}</p>
              <h2 className="text-xl font-bold leading-tight truncate">{lot.title}</h2>
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

          {/* Huge price display — readable from 6+ feet */}
          <div className="flex items-baseline gap-6">
            <div>
              <p className="text-xs text-muted-foreground">
                {isClaimMode ? (state.saleMode === "dutch" ? "Current price" : "Price") : (hasBids ? "Current bid" : "Starting price")}
              </p>
              <p className="text-6xl font-black tabular-nums leading-none">
                {hasBids || isClaimMode ? formatCents(state.currentBidCents ?? lot.startingPriceCents) : formatCents(lot.startingPriceCents)}
              </p>
            </div>
            {isClaimMode ? (
              <div>
                <p className="text-xs text-muted-foreground">Claimed</p>
                <Badge variant="secondary" className="text-lg font-semibold">
                  {state.quantityClaimed} / {state.quantity}
                </Badge>
              </div>
            ) : (
              <div>
                <p className="text-xs text-muted-foreground">Bids</p>
                <Badge variant="secondary" className="text-sm font-semibold">{state.bidCount}</Badge>
              </div>
            )}
          </div>

          {/* Claim progress bar */}
          {isClaimMode && state.quantity > 1 && (
            <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-green-500 transition-all duration-300"
                style={{ width: `${Math.min((state.quantityClaimed / state.quantity) * 100, 100)}%` }}
              />
            </div>
          )}

          {!isClaimMode && hasBids && bidderDisplay && (
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
  saleMode,
  hasBids,
  hasClaims,
  quantity,
  quantityClaimed,
  hasPendingLots,
  isConnected,
  onSend,
}: {
  lotId: string;
  lotStatus: LotStatus;
  saleMode: SaleMode;
  hasBids: boolean;
  hasClaims: boolean;
  quantity: number;
  quantityClaimed: number;
  hasPendingLots: boolean;
  isConnected: boolean;
  onSend: (msg: AdminMessage) => void;
}) {
  const disabled = !isConnected;
  const isEnglish = saleMode === "english";
  const isClaimMode = saleMode === "live_sell" || saleMode === "dutch";
  const isActive = lotStatus === "active" || lotStatus === "going_once" || lotStatus === "going_twice";
  const showNextItem = hasPendingLots;

  if (isClaimMode) {
    // live_sell / dutch controls
    return (
      <div className="space-y-3">
        {/* Set price input */}
        {lotStatus === "active" && (
          <SetPriceForm lotId={lotId} isConnected={isConnected} onSend={onSend} />
        )}

        <div className="flex flex-wrap items-center gap-2">
          {lotStatus === "active" && (
            <Button
              disabled={disabled}
              size="lg"
              onClick={() => onSend({ type: "close_lot", lotId })}
              className={hasClaims ? "bg-green-600 text-white hover:bg-green-700 font-bold text-base" : ""}
              variant={hasClaims ? "default" : "secondary"}
            >
              {hasClaims ? `Close Lot (${quantityClaimed}/${quantity} claimed)` : "Close Lot (no claims)"}
            </Button>
          )}
          {isActive && (
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

  // English auction controls
  const showGoingOnce = lotStatus === "active" && hasBids;
  const showGoingTwice = lotStatus === "going_once";
  const showSold = (lotStatus === "going_once" || lotStatus === "going_twice" || (lotStatus === "active" && hasBids));
  const showPass = lotStatus === "active" || lotStatus === "going_once" || lotStatus === "going_twice";
  const showWithdraw = isActive;
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

function SetPriceForm({
  lotId,
  isConnected,
  onSend,
}: {
  lotId: string;
  isConnected: boolean;
  onSend: (msg: AdminMessage) => void;
}) {
  const [price, setPrice] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const dollars = parseFloat(price);
    if (isNaN(dollars) || dollars <= 0) return;
    onSend({ type: "set_price", lotId, priceCents: Math.round(dollars * 100) });
    setPrice("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <div className="w-32">
        <label className="text-xs text-muted-foreground">Set Price ($)</label>
        <Input
          type="number"
          min="0.01"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="New price"
          className="h-8 text-sm"
        />
      </div>
      <Button type="submit" size="sm" disabled={!isConnected || !price} className="h-8">
        Update Price
      </Button>
    </form>
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
  onSend: (msg: AdminMessage & { type: "quick_add_lot" }) => void;
}) {
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [saleMode, setSaleMode] = useState<SaleMode>("live_sell");
  const [quantity, setQuantity] = useState("1");
  const [maxClaims, setMaxClaims] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle || !price) return;
    const dollars = parseFloat(price);
    if (isNaN(dollars) || dollars <= 0) return;
    const qty = parseInt(quantity) || 1;
    const maxClaimsPerUser = maxClaims ? parseInt(maxClaims) || null : null;
    onSend({ type: "quick_add_lot", title: trimmedTitle, startingPriceCents: Math.round(dollars * 100), saleMode, quantity: qty, maxClaimsPerUser });
    setTitle("");
    setPrice("");
    setQuantity("1");
    setMaxClaims("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2 flex-wrap">
      <div className="flex-1 min-w-[120px]">
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
      <div className="w-24">
        <label className="text-xs text-muted-foreground">Mode</label>
        <select
          value={saleMode}
          onChange={(e) => setSaleMode(e.target.value as SaleMode)}
          className="h-8 text-sm w-full rounded-md border bg-background px-2"
        >
          <option value="live_sell">Live Sell</option>
          <option value="english">English</option>
          <option value="dutch">Dutch</option>
        </select>
      </div>
      {saleMode !== "english" && (
        <>
          <div className="w-16">
            <label className="text-xs text-muted-foreground" title="Units available to claim">Avail</label>
            <Input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="w-20">
            <label className="text-xs text-muted-foreground">Max/user</label>
            <Input
              type="number"
              min="1"
              value={maxClaims}
              onChange={(e) => setMaxClaims(e.target.value)}
              placeholder="∞"
              className="h-8 text-sm"
            />
          </div>
        </>
      )}
      <Button type="submit" size="sm" disabled={!isConnected || !title.trim() || !price} className="h-8">
        Add
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

const STREAM_STATUS_LABELS: Record<StreamStatus, { label: string; color: string }> = {
  idle: { label: "Camera Off", color: "bg-gray-500" },
  previewing: { label: "Preview", color: "bg-blue-500" },
  connecting: { label: "Connecting...", color: "bg-yellow-500 animate-pulse" },
  live: { label: "Live", color: "bg-red-500 animate-pulse" },
  error: { label: "Error", color: "bg-red-500" },
};

function StreamPanel({
  streamStatus,
  cameraError,
  videoRef,
  onStartCamera,
  onStopCamera,
  onStartStream,
  onStopStream,
}: {
  streamStatus: StreamStatus;
  cameraError: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onStartCamera: () => void;
  onStopCamera: () => void;
  onStartStream: () => void;
  onStopStream: () => void;
}) {
  const { label, color } = STREAM_STATUS_LABELS[streamStatus];
  const showVideo = streamStatus === "previewing" || streamStatus === "connecting" || streamStatus === "live";

  // Idle state: camera is starting up automatically
  if (streamStatus === "idle") {
    return (
      <Card className="py-3">
        <CardContent className="space-y-3">
          <div className="flex items-center justify-center aspect-video bg-black rounded-lg">
            <p className="text-zinc-400 text-lg">Starting camera...</p>
          </div>
          <video ref={videoRef} autoPlay muted playsInline className="hidden" />
        </CardContent>
      </Card>
    );
  }

  // Error state: permission denied or no device
  if (streamStatus === "error") {
    return (
      <Card className="py-3">
        <CardContent className="space-y-3">
          <div className="flex flex-col items-center justify-center aspect-video bg-black rounded-lg p-6 text-center gap-4">
            <p className="text-red-400 text-lg font-medium">
              {cameraError ?? "Camera error"}
            </p>
            <Button size="lg" variant="secondary" onClick={onStartCamera} className="h-12 text-lg">
              Retry Camera
            </Button>
          </div>
          <video ref={videoRef} autoPlay muted playsInline className="hidden" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="py-3">
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
            <span className="text-sm font-medium">{label}</span>
          </div>
          <div className="flex items-center gap-2">
            {streamStatus === "previewing" && (
              <Button size="sm" variant="ghost" onClick={onStopCamera}>
                Stop Camera
              </Button>
            )}
            {streamStatus === "connecting" && (
              <Button size="sm" variant="ghost" disabled>
                Connecting...
              </Button>
            )}
            {streamStatus === "live" && (
              <Button size="sm" variant="destructive" onClick={onStopStream}>
                Stop Stream
              </Button>
            )}
          </div>
        </div>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`w-full rounded-lg bg-black ${showVideo ? "aspect-video" : "hidden"}`}
        />
        {streamStatus === "previewing" && (
          <button
            onClick={onStartStream}
            className="w-full bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xl font-bold h-16 rounded-xl transition-colors cursor-pointer"
          >
            GO LIVE
          </button>
        )}
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
              {bid.isClaim ? (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400 shrink-0">Claimed</span>
              ) : (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-500/15 text-green-600 dark:text-green-400 shrink-0">Bid</span>
              )}
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
