"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/app/components/ui/alert-dialog";
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
  ConnectedUserInfo,
} from "@/auction/types";
import { formatCents } from "@/lib/money";
import { imageUrl } from "@/lib/image-url";
import { transitionAuctionStatus, updateRecordingStatus } from "./server-functions/auctions";
import { Volume2, VolumeX, ChevronDown, ChevronUp, MessageSquare, List, Share2, Loader2 } from "lucide-react";
import { startRecording, type RecordingHandle } from "@/lib/stream/recording";

// ─── useAudioLevel hook ──────────────────────────────────────────

function useAudioLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream) { setLevel(0); return; }
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) { setLevel(0); return; }
    let ctx: AudioContext;
    try { ctx = new AudioContext(); } catch { return; }
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let rafId: number;
    function tick() {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      setLevel(Math.sqrt(sum / data.length) / 255);
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      source.disconnect();
      ctx.close().catch(() => {});
    };
  }, [stream]);
  return level;
}

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
type StreamStatus = "idle" | "previewing" | "connecting" | "live" | "error" | "ended";

type RecordingResult = { success: true } | { success: false; failedCount: number };

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
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);
  const videoElRef = useRef<HTMLVideoElement>(null);
  // Callback ref: whenever a <video> mounts/swaps, sync srcObject from mediaStreamRef
  const videoRef = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el;
    if (el && mediaStreamRef.current) {
      el.srcObject = mediaStreamRef.current;
    }
  }, []);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const recordingRef = useRef<RecordingHandle | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [recordingResult, setRecordingResult] = useState<RecordingResult | null>(null);
  const streamStartedAtRef = useRef<number | null>(null);
  const [streamDurationSecs, setStreamDurationSecs] = useState<number>(0);

  const [connectedUsers, setConnectedUsers] = useState<ConnectedUserInfo[]>([]);
  const [usersExpanded, setUsersExpanded] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);
  const handleServerMessageRef = useRef<(msg: ServerMessage) => void>(() => {});
  const streamStatusRef = useRef<StreamStatus>(streamStatus);

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
        // Stop recording, stream, clean up
        if (recordingRef.current) {
          const handle = recordingRef.current;
          recordingRef.current = null;
          setIsRecording(false);
          try {
            await handle.stop();
            const failed = handle.failedChunks();
            if (failed.length > 0) {
              toast.error(`Recording saved with ${failed.length} failed chunk(s)`);
            } else {
              toast.success("Recording saved");
            }
          } catch {
            toast.error("Recording failed");
          }
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
      setActiveStream(stream);
      if (videoElRef.current) {
        videoElRef.current.srcObject = stream;
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
      setActiveStream(null);
    }
    if (videoElRef.current) {
      videoElRef.current.srcObject = null;
    }
    setStreamStatus("idle");
  }, []);

  const startRecordingForStream = useCallback(() => {
    if (!mediaStreamRef.current) return;
    try {
      const handle = startRecording(mediaStreamRef.current, auction.id);
      recordingRef.current = handle;
      setIsRecording(true);
      updateRecordingStatus(auction.id, "recording").catch(console.error);
    } catch (err) {
      console.error("Recording start failed:", err);
      // Non-fatal: stream still works without recording
    }
  }, [auction.id]);

  const stopRecordingForStream = useCallback(async (): Promise<RecordingResult> => {
    if (!recordingRef.current) return { success: true };
    const handle = recordingRef.current;
    recordingRef.current = null;
    setIsRecording(false);
    try {
      await handle.stop();
      const failed = handle.failedChunks();
      if (failed.length > 0) {
        return { success: false, failedCount: failed.length };
      }
      return { success: true };
    } catch {
      return { success: false, failedCount: -1 };
    }
  }, []);

  const startStream = useCallback(async () => {
    if (!mediaStreamRef.current) return;
    if (auctionStatus === "closed" || auctionStatus === "settled" || auctionStatus === "archived") {
      toast.error("Auction already ended — cannot go live again");
      return;
    }
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

      // Start recording reusing same getUserMedia stream
      startRecordingForStream();

      // Transition auction status to live (skip if already live, e.g. from quickGoLive)
      if (auctionStatus !== "live") {
        handleAuctionTransition("live");
      }

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          streamStartedAtRef.current = Date.now();
          setStreamStatus("live");
        } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          setStreamStatus("error");
        }
      };

      if (pc.connectionState === "connected") {
        streamStartedAtRef.current = Date.now();
        setStreamStatus("live");
      }
    } catch (err) {
      console.error("Stream start failed:", err);
      toast.error("Failed to start stream");
      // Clean up recording if it was started
      if (recordingRef.current) {
        recordingRef.current.stop().catch(() => {});
        recordingRef.current = null;
        setIsRecording(false);
        updateRecordingStatus(auction.id, "failed").catch(() => {});
      }
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      setStreamStatus("previewing");
    }
  }, [auction.id, auctionStatus, startRecordingForStream, handleAuctionTransition]);

  const stopStream = useCallback(async () => {
    setIsSaving(true);
    try {
      // Capture duration before cleanup
      const duration = streamStartedAtRef.current
        ? Math.round((Date.now() - streamStartedAtRef.current) / 1000)
        : 0;
      streamStartedAtRef.current = null;
      setStreamDurationSecs(duration);

      // 1. Stop WHIP stream first
      await fetch(`/ingest/${auction.id}`, { method: "DELETE" }).catch(() => {});
      // 2. Close peer connection
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      // 3. Finalize recording (waits for all chunk uploads, then merges chunks in R2)
      const result = await stopRecordingForStream();
      setRecordingResult(result);
      await updateRecordingStatus(auction.id, result.success ? "ready" : "failed");

      // 4. Release camera/mic tracks (turns off LED)
      if (mediaStreamRef.current) {
        for (const track of mediaStreamRef.current.getTracks()) track.stop();
        mediaStreamRef.current = null;
        setActiveStream(null);
      }
      if (videoElRef.current) videoElRef.current.srcObject = null;

      if (result.success) {
        toast.success("Stream ended. Recording saved.");
      } else {
        toast.error(
          result.failedCount === -1
            ? "Recording failed"
            : `Recording saved with ${result.failedCount} failed chunk(s)`,
        );
      }
    } finally {
      setIsSaving(false);
      setEndDialogOpen(false);
      setStreamStatus("ended");
    }
  }, [auction.id, stopRecordingForStream]);

  // Cleanup camera/stream/recorder on unmount
  useEffect(() => {
    return () => {
      if (recordingRef.current) {
        recordingRef.current.stop().catch(() => {});
        recordingRef.current = null;
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

      case "chat_history":
        setChatMessages(msg.messages);
        break;

      case "chat_message":
        setChatMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [
            ...prev,
            { id: msg.id, userId: msg.userId, username: msg.username, content: msg.content, createdAt: msg.createdAt },
          ].slice(-100);
        });
        break;

      case "viewer_count":
        setViewerCount(msg.count);
        break;

      case "error":
        toast.error(msg.message);
        break;

      case "user_list":
        setConnectedUsers(msg.users);
        break;

      case "user_joined":
        setConnectedUsers((prev) =>
          prev.some((u) => u.userId === msg.user.userId) ? prev : [...prev, msg.user]
        );
        break;

      case "user_left":
        setConnectedUsers((prev) => prev.filter((u) => u.userId !== msg.userId));
        break;

      case "pong":
        break;
    }
  }, [initialLots]);

  // Keep refs in sync each render
  handleServerMessageRef.current = handleServerMessage;
  streamStatusRef.current = streamStatus;

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
          handleServerMessageRef.current(msg);
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

    // Stream heartbeat (15s)
    const heartbeatInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN && streamStatusRef.current === "live") {
        wsRef.current.send(JSON.stringify({ type: "stream_heartbeat" }));
      }
    }, 15000);

    connect();

    return () => {
      isMounted.current = false;
      clearInterval(pingInterval);
      clearInterval(heartbeatInterval);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [auction.id]);

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

  const audioLevel = useAudioLevel(activeStream);
  const hasAudioTrack = (activeStream?.getAudioTracks().length ?? 0) > 0;
  const isStreamingLive = isLive && (streamStatus === "live" || streamStatus === "connecting");

  // Pre-fill floor bid: current bid + default increment
  const nextBidCents = currentLotState?.currentBidCents != null
    ? currentLotState.currentBidCents + auction.defaultIncrementCents
    : (currentLotData?.startingPriceCents ?? 0);

  // ─── Collapsible panels for small screens ─────────────────────
  const [lotsOpen, setLotsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(true);
  const [liveControlsOpen, setLiveControlsOpen] = useState(false);

  useEffect(() => {
    if (isStreamingLive) setShareOpen(false);
  }, [isStreamingLive]);

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
          <ConnectedUsersList
            connectedUsers={connectedUsers}
            viewerCount={viewerCount}
            expanded={usersExpanded}
            onToggle={() => setUsersExpanded((v) => !v)}
            onClose={() => setUsersExpanded(false)}
          />
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

      {/* Main grid — responsive. When streaming live: 2-col (no lot sidebar), otherwise 3-col */}
      <div className={`flex-1 grid gap-0 overflow-hidden ${isStreamingLive ? "grid-cols-1 md:grid-cols-[1fr_240px]" : "grid-cols-1 md:grid-cols-[1fr_240px] lg:grid-cols-[240px_1fr_240px]"}`}>
        {/* Left: Lot queue — visible lg+ when not streaming, hidden when streaming (collapsed into main area) */}
        {!isStreamingLive && (
          <aside className="hidden lg:block border-r overflow-y-auto p-3 space-y-1">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Lots</h2>
            {lotQueue}
          </aside>
        )}

        {/* Center: Stream + current lot + bid feed */}
        <main className="overflow-y-auto p-4 flex flex-col gap-4">
          {/* Collapsible lots on small/medium screens (hidden when streaming — lots collapse below) */}
          {!isStreamingLive && (
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

          {streamStatus === "ended" ? (
            <PostStreamSummary
              title={auction.title}
              slug={auction.slug}
              auctionId={auction.id}
              durationSecs={streamDurationSecs}
              recordingResult={recordingResult}
              canRestart={auctionStatus !== "closed" && auctionStatus !== "settled" && auctionStatus !== "archived"}
              onRestart={async () => {
                setRecordingResult(null);
                setStreamDurationSecs(0);
                await startCamera();
              }}
            />
          ) : isStreamingLive ? (
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
                <AlertDialog open={endDialogOpen} onOpenChange={isSaving ? undefined : setEndDialogOpen}>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" className="h-12 min-h-[48px] px-6 text-base font-semibold">
                      End Stream
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent onEscapeKeyDown={isSaving ? (e) => e.preventDefault() : undefined}>
                    {isSaving ? (
                      <AlertDialogHeader>
                        <AlertDialogTitle>Saving recording</AlertDialogTitle>
                        <AlertDialogDescription asChild>
                          <span className="flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Uploading final chunks… Please don't close this page.
                          </span>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                    ) : (
                      <>
                        <AlertDialogHeader>
                          <AlertDialogTitle>End the live stream?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will stop the stream for all viewers. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="h-12 min-h-[48px]">Cancel</AlertDialogCancel>
                          <AlertDialogAction variant="destructive" className="h-12 min-h-[48px]" onClick={stopStream}>
                            End Stream
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </>
                    )}
                  </AlertDialogContent>
                </AlertDialog>
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
                  currentPriceCents={currentLotState.currentBidCents ?? 0}
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
                isRecording={isRecording}
                onStartCamera={startCamera}
                onStopCamera={stopCamera}
                onStartStream={startStream}
                onStopStream={stopStream}
                lotCount={allLots.length}
                hasAudioTrack={hasAudioTrack}
                audioLevel={audioLevel}
                activeStream={activeStream}
                connectionStatus={connectionStatus}
                viewerCount={viewerCount}
                auctionTitle={auction.title}
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
                  currentPriceCents={currentLotState.currentBidCents ?? 0}
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

          {/* Collapsible share on small screens */}
          <div className="md:hidden">
            <button
              onClick={() => setShareOpen(!shareOpen)}
              className="flex items-center gap-2 w-full text-left text-sm font-medium text-muted-foreground hover:text-foreground py-1"
            >
              <Share2 className="h-4 w-4" />
              Share
              {shareOpen ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
            </button>
            {shareOpen && (
              <div className="border rounded-lg p-2 mt-1 space-y-1.5">
                <p className="text-sm font-mono break-all select-all">{`${typeof window !== "undefined" ? window.location.origin : ""}/live/${auction.slug}`}</p>
                <div className="flex justify-center py-2">
                  <QRCodeSVG
                    value={`${typeof window !== "undefined" ? window.location.origin : ""}/live/${auction.slug}`}
                    size={120}
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
                  Copy Link
                </Button>
              </div>
            )}
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

        {/* Right: Share + Chat — visible md+, collapsible on small */}
        <aside className="hidden md:block border-l overflow-y-auto p-3">
          {/* Collapsible Share section */}
          <div className="pb-3 mb-3 border-b">
            <button
              onClick={() => setShareOpen(!shareOpen)}
              className="flex items-center gap-2 w-full text-left text-xs font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground"
            >
              Share
              {shareOpen ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
            </button>
            {shareOpen && (
              <div className="mt-2 space-y-1.5">
                <p className="text-sm font-mono break-all select-all">{`${typeof window !== "undefined" ? window.location.origin : ""}/live/${auction.slug}`}</p>
                <div className="flex justify-center py-2">
                  <QRCodeSVG
                    value={`${typeof window !== "undefined" ? window.location.origin : ""}/live/${auction.slug}`}
                    size={120}
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
                  Copy Link
                </Button>
              </div>
            )}
          </div>

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
  currentPriceCents,
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
  currentPriceCents: number;
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
          <SetPriceForm lotId={lotId} currentPriceCents={currentPriceCents} isConnected={isConnected} onSend={onSend} />
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

function getStepForPrice(dollars: number): string {
  if (dollars < 50) return "1";
  if (dollars < 250) return "5";
  if (dollars < 1000) return "10";
  if (dollars < 5000) return "25";
  return "50";
}

function SetPriceForm({
  lotId,
  currentPriceCents,
  isConnected,
  onSend,
}: {
  lotId: string;
  currentPriceCents: number;
  isConnected: boolean;
  onSend: (msg: AdminMessage) => void;
}) {
  const [price, setPrice] = useState(() => (currentPriceCents / 100).toString());
  const isDirty = useRef(false);

  useEffect(() => {
    if (!isDirty.current) {
      setPrice((currentPriceCents / 100).toString());
    }
  }, [currentPriceCents]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const dollars = parseFloat(price);
    if (isNaN(dollars) || dollars <= 0) return;
    onSend({ type: "set_price", lotId, priceCents: Math.round(dollars * 100) });
    isDirty.current = false;
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <div className="w-32">
        <label className="text-xs text-muted-foreground">Set Price ($)</label>
        <Input
          type="number"
          min="0.01"
          step={getStepForPrice(parseFloat(price) || 0)}
          value={price}
          onChange={(e) => { isDirty.current = true; setPrice(e.target.value); }}
          onBlur={() => { isDirty.current = false; }}
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

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function PostStreamSummary({
  title,
  slug,
  auctionId,
  durationSecs,
  recordingResult,
  canRestart,
  onRestart,
}: {
  title: string;
  slug: string;
  auctionId: string;
  durationSecs: number;
  recordingResult: RecordingResult | null;
  canRestart: boolean;
  onRestart: () => void;
}) {
  const auctionUrl = typeof window !== "undefined" ? `${window.location.origin}/live/${slug}` : `/live/${slug}`;
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    await navigator.clipboard.writeText(auctionUrl);
    setCopied(true);
    toast.success("Link copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const failed = recordingResult && !recordingResult.success;

  return (
    <Card className="py-3">
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-gray-500" />
          <span className="text-sm font-medium">Stream Ended</span>
        </div>

        <div className="space-y-2">
          <h3 className="text-lg font-semibold">{title}</h3>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>Duration: <span className="font-mono font-medium text-foreground">{formatDuration(durationSecs)}</span></span>
          </div>
        </div>

        {/* Recording status */}
        {recordingResult && (
          <div className={`rounded-lg border p-3 ${failed ? "border-red-500/30 bg-red-500/5" : "border-green-500/30 bg-green-500/5"}`}>
            {failed ? (
              <p className="text-sm text-red-600 dark:text-red-400 font-medium">
                {recordingResult.failedCount === -1
                  ? "Recording failed"
                  : `Recording saved with ${recordingResult.failedCount} failed chunk(s)`}
              </p>
            ) : (
              <p className="text-sm text-green-600 dark:text-green-400 font-medium">Recording saved</p>
            )}
          </div>
        )}

        {/* View recording link */}
        {recordingResult?.success && (
          <a
            href={`/admin/auctions/${auctionId}/recording`}
            className="inline-flex items-center justify-center w-full min-h-[48px] text-sm font-medium rounded-md border border-border bg-card hover:bg-accent px-4"
          >
            View Recording
          </a>
        )}

        {/* Restart stream */}
        {canRestart && (
          <Button
            className="w-full min-h-[48px] text-lg font-bold bg-red-600 hover:bg-red-700 text-white"
            onClick={onRestart}
          >
            Go Live Again
          </Button>
        )}

        {/* Copy auction link */}
        <Button
          variant="outline"
          className="w-full min-h-[48px] text-sm font-medium"
          onClick={copyLink}
        >
          <Share2 className="h-4 w-4" />
          {copied ? "Copied!" : "Copy Auction Link"}
        </Button>
      </CardContent>
    </Card>
  );
}

const STREAM_STATUS_LABELS: Record<StreamStatus, { label: string; color: string }> = {
  idle: { label: "Camera Off", color: "bg-gray-500" },
  previewing: { label: "Preview", color: "bg-blue-500" },
  connecting: { label: "Connecting...", color: "bg-yellow-500 animate-pulse" },
  live: { label: "Live", color: "bg-red-500 animate-pulse" },
  error: { label: "Error", color: "bg-red-500" },
  ended: { label: "Stream Ended", color: "bg-gray-500" },
};

function StreamPanel({
  streamStatus,
  cameraError,
  videoRef,
  isRecording,
  onStartCamera,
  onStopCamera,
  onStartStream,
  onStopStream,
  lotCount,
  hasAudioTrack,
  audioLevel,
  activeStream,
  connectionStatus,
  viewerCount,
  auctionTitle,
}: {
  streamStatus: StreamStatus;
  cameraError: string | null;
  videoRef: React.RefCallback<HTMLVideoElement> | React.RefObject<HTMLVideoElement | null>;
  isRecording: boolean;
  onStartCamera: () => void;
  onStopCamera: () => void;
  onStartStream: () => void;
  onStopStream: () => void;
  lotCount: number;
  hasAudioTrack: boolean;
  audioLevel: number;
  activeStream: MediaStream | null;
  connectionStatus: ConnectionStatus;
  viewerCount: number;
  auctionTitle: string;
}) {
  const [goLiveOpen, setGoLiveOpen] = useState(false);
  const { label, color } = STREAM_STATUS_LABELS[streamStatus];
  const showVideo = streamStatus === "previewing" || streamStatus === "connecting" || streamStatus === "live";

  const isWsConnected = connectionStatus === "connected";
  const canGoLive = hasAudioTrack && isWsConnected;

  // Get device info from active stream
  const videoTrack = activeStream?.getVideoTracks()[0] ?? null;
  const audioTrack = activeStream?.getAudioTracks()[0] ?? null;
  const videoSettings = videoTrack?.getSettings();
  const resolution = videoSettings ? `${videoSettings.width}×${videoSettings.height}` : null;
  const micLabel = audioTrack?.label || null;

  // Idle state: camera not active
  if (streamStatus === "idle") {
    return (
      <Card className="py-3">
        <CardContent className="space-y-4">
          <div className="flex flex-col items-center justify-center aspect-video bg-black rounded-lg gap-4 p-6">
            <h2 className="text-white text-xl font-semibold text-center">{auctionTitle}</h2>
            <p className="text-zinc-400 text-sm text-center">Start your camera to preview before going live</p>
            <div className="flex items-center gap-3 text-sm text-zinc-400">
              <span>{lotCount} lot{lotCount !== 1 ? "s" : ""}</span>
              <span className="text-zinc-600">|</span>
              <ConnectionBadge status={connectionStatus} />
            </div>
            <Button size="lg" onClick={onStartCamera} className="h-14 min-h-[48px] text-lg px-8 mt-2">
              Start Camera
            </Button>
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
            <Button size="lg" variant="secondary" onClick={onStartCamera} className="h-12 min-h-[48px] text-lg">
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
            {isRecording && (
              <span className="flex items-center gap-1 ml-2 text-xs text-red-500">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                REC
              </span>
            )}
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
          <>
            {/* Enhanced pre-stream checklist */}
            <div className="space-y-2 px-1">
              {/* Camera */}
              <div className="flex items-center gap-2 text-sm">
                <span className="text-green-600 font-medium">✓ Camera</span>
                {resolution && <span className="text-xs text-muted-foreground">{resolution}</span>}
              </div>
              {/* Mic + audio level */}
              <div className="flex items-center gap-2 text-sm">
                <span className={hasAudioTrack ? "text-green-600 font-medium" : "text-red-500 font-medium"}>
                  {hasAudioTrack ? "✓" : "✗"} Mic
                </span>
                {micLabel && <span className="text-xs text-muted-foreground truncate max-w-[200px]">{micLabel}</span>}
              </div>
              {hasAudioTrack && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-10 shrink-0">Level</span>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-[width] duration-75"
                      style={{
                        width: `${Math.min(audioLevel * 100, 100)}%`,
                        backgroundColor: audioLevel > 0.7 ? "#eab308" : "#22c55e",
                      }}
                    />
                  </div>
                </div>
              )}
              {/* Lots */}
              <div className="flex items-center gap-2 text-sm">
                <span className={lotCount === 0 ? "text-amber-500 font-medium" : "text-muted-foreground"}>
                  {lotCount} lot{lotCount !== 1 ? "s" : ""}
                </span>
                {lotCount === 0 && <span className="text-xs text-amber-500">Add lots before going live</span>}
              </div>
              {/* Connection */}
              <div className="flex items-center gap-2 text-sm">
                <ConnectionBadge status={connectionStatus} />
              </div>
            </div>

            {/* GO LIVE button — disabled when mic missing or WS disconnected */}
            <AlertDialog open={goLiveOpen} onOpenChange={setGoLiveOpen}>
              <AlertDialogTrigger asChild>
                <button
                  disabled={!canGoLive}
                  className={`w-full text-white text-xl font-bold h-16 min-h-[48px] rounded-xl transition-colors cursor-pointer ${
                    canGoLive
                      ? "bg-red-600 hover:bg-red-700 active:bg-red-800"
                      : "bg-red-600/40 cursor-not-allowed"
                  }`}
                >
                  GO LIVE
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Go live?</AlertDialogTitle>
                  <AlertDialogDescription>
                    You're about to go live with {lotCount} lot{lotCount !== 1 ? "s" : ""}. Viewers will see your stream immediately.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="h-12 min-h-[48px]">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="h-12 min-h-[48px] bg-red-600 hover:bg-red-700 text-white"
                    onClick={() => { setGoLiveOpen(false); onStartStream(); }}
                  >
                    Go Live
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            {!canGoLive && (
              <p className="text-xs text-center text-muted-foreground">
                {!hasAudioTrack ? "Mic not detected" : "Not connected to server"}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const dot =
    status === "connected" ? "bg-green-500"
    : status === "reconnecting" || status === "connecting" ? "bg-yellow-500 animate-pulse"
    : "bg-red-500";
  const text =
    status === "connected" ? "Connected"
    : status === "reconnecting" ? "Reconnecting"
    : status === "connecting" ? "Connecting"
    : "Disconnected";
  return (
    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      {text}
    </span>
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

// ─── Connected Users List ────────────────────────────────────────

const BIDDER_BADGE: Record<string, { label: string; className: string }> = {
  guest: { label: "Guest", className: "bg-gray-500/15 text-gray-600 dark:text-gray-400" },
  registered: { label: "Registered", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  card_on_file: { label: "Card on file", className: "bg-green-500/15 text-green-600 dark:text-green-400" },
};

function ConnectedUsersList({
  connectedUsers,
  viewerCount,
  expanded,
  onToggle,
  onClose,
}: {
  connectedUsers: ConnectedUserInfo[];
  viewerCount: number;
  expanded: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [expanded, onClose]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={onToggle}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        {viewerCount} <span className="hidden sm:inline">viewer{viewerCount !== 1 ? "s" : ""}</span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-md border bg-popover p-2 shadow-md">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Connected Users ({connectedUsers.length})
          </h3>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {connectedUsers.length === 0 && (
              <p className="text-xs text-muted-foreground py-1">No users connected</p>
            )}
            {connectedUsers.map((user) => {
              const badge = BIDDER_BADGE[user.bidderStatus] ?? BIDDER_BADGE.guest;
              return (
                <div key={user.userId} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50">
                  <span className="truncate">{user.username}</span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${badge.className}`}>
                    {badge.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
