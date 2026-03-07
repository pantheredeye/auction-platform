"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ServerMessage, AuctionStatus, LotStatus } from "@/auction/types";

// ─── Types ──────────────────────────────────────────────────────────

type StreamStatus = "connecting" | "live" | "waiting" | "ended" | "error";

interface CurrentLotData {
  id: string;
  status: LotStatus;
  currentBidCents: number | null;
  currentBidderId: string | null;
  currentBidderName: string | null;
  bidCount: number;
}

export interface LiveAuctionData {
  id: string;
  title: string;
  slug: string;
  status: string;
  type: string;
  scheduledStartAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  streamUrl: string | null;
  defaultIncrementCents: number;
  buyerPremiumPct: number;
  extensionSeconds: number;
  organizationId: string;
  activeLot: {
    id: string;
    lotNumber: number;
    title: string;
    description: string | null;
    startingPriceCents: number;
    currentBidCents: number | null;
    currentBidderId: string | null;
    bidCount: number;
    status: string;
    incrementCents: number | null;
    closesAt: string | null;
    thumbnailUrl: string | null;
    imageUrls: string | null;
  } | null;
}

export interface GuestInfo {
  id: string;
  name: string | null;
}

interface LiveViewerClientProps {
  auction: LiveAuctionData;
  guest: GuestInfo | null;
}

// ─── Component ──────────────────────────────────────────────────────

// Map DO auction status to viewer stream status
function auctionStatusToStreamStatus(status: AuctionStatus, hasActiveStream: boolean): StreamStatus {
  switch (status) {
    case "live":
    case "closing":
      return hasActiveStream ? "live" : "connecting";
    case "draft":
    case "scheduled":
    case "preview":
      return "waiting";
    case "closed":
    case "settled":
    case "archived":
      return "ended";
    default:
      return "waiting";
  }
}

export function LiveViewerClient({ auction, guest }: LiveViewerClientProps) {
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
  const [muted, setMuted] = useState(true);
  const [viewerCount, setViewerCount] = useState(0);
  const [auctionStatus, setAuctionStatus] = useState<AuctionStatus>(auction.status as AuctionStatus);
  const [currentLot, setCurrentLot] = useState<CurrentLotData | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempt = useRef(0);
  const mountedRef = useRef(true);

  // Track whether WHEP stream is actually connected
  const whepConnectedRef = useRef(false);

  const whepUrl = `/play/${auction.id}`;

  // ─── WS message handler ──────────────────────────────────────────

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "auction_update": {
        const status = msg.status as AuctionStatus;
        setAuctionStatus(status);
        // Update stream status based on auction status + current WHEP state
        const derived = auctionStatusToStreamStatus(status, whepConnectedRef.current);
        // Don't override "live" if WHEP is connected, don't override "error"
        setStreamStatus((prev) => {
          if (prev === "error") return prev;
          if (prev === "live" && derived === "connecting") return "live"; // WHEP already connected
          return derived;
        });
        break;
      }
      case "viewer_count":
        setViewerCount(msg.count);
        break;
      case "lot_update": {
        const isActive = msg.status === "active" || msg.status === "going_once" || msg.status === "going_twice";
        if (isActive) {
          setCurrentLot({
            id: msg.lotId,
            status: msg.status,
            currentBidCents: msg.currentBidCents ?? null,
            currentBidderId: msg.currentBidderId ?? null,
            currentBidderName: msg.currentBidderName ?? null,
            bidCount: msg.bidCount,
          });
        } else {
          // Clear current lot if it's the one that just changed to non-active
          setCurrentLot((prev) => (prev?.id === msg.lotId ? null : prev));
        }
        break;
      }
      case "chat_history":
      case "chat_message":
      case "pong":
        // Handled by future chat implementation
        break;
    }
  }, []);

  const cleanupConnection = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const connectWhep = useCallback(async (url: string) => {
    if (!mountedRef.current) return;
    cleanupConnection();
    setStreamStatus("connecting");

    try {
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });

      pc.ontrack = (event) => {
        if (!videoRef.current) return;
        if (!videoRef.current.srcObject) {
          videoRef.current.srcObject = new MediaStream();
        }
        (videoRef.current.srcObject as MediaStream).addTrack(event.track);
      };

      pc.onconnectionstatechange = () => {
        if (!mountedRef.current) return;
        const state = pc.connectionState;
        if (state === "connected") {
          reconnectAttempt.current = 0;
          whepConnectedRef.current = true;
          setStreamStatus("live");
        } else if (state === "failed" || state === "disconnected" || state === "closed") {
          whepConnectedRef.current = false;
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
        if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
        whepConnectedRef.current = false;
        setStreamStatus("waiting");
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
      scheduleReconnect(url);
    }
  }, [cleanupConnection]);

  const scheduleReconnect = useCallback((url: string) => {
    if (!mountedRef.current) return;
    if (reconnectAttempt.current >= 5) {
      setStreamStatus("error");
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt.current), 10000);
    reconnectAttempt.current++;
    setStreamStatus("connecting");
    reconnectTimer.current = setTimeout(() => {
      if (mountedRef.current) connectWhep(url);
    }, delay);
  }, [connectWhep]);

  useEffect(() => {
    mountedRef.current = true;
    connectWhep(whepUrl);
    return () => {
      mountedRef.current = false;
      cleanupConnection();
    };
  }, [whepUrl, connectWhep, cleanupConnection]);

  // ─── WebSocket lifecycle ──────────────────────────────────────────

  useEffect(() => {
    const wsRef = { current: null as WebSocket | null };
    let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let wsReconnectAttempt = 0;
    let alive = true;

    function connectWs() {
      if (!alive) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${location.host}/ws/auction/${auction.id}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!alive) { ws.close(); return; }
        wsReconnectAttempt = 0;
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
        if (!alive) return;
        scheduleWsReconnect();
      };

      ws.onerror = () => {};
    }

    function scheduleWsReconnect() {
      if (!alive) return;
      const delay = Math.min(1000 * Math.pow(2, wsReconnectAttempt), 15000);
      wsReconnectAttempt++;
      wsReconnectTimer = setTimeout(connectWs, delay);
    }

    const pingInterval = setInterval(() => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);

    connectWs();

    return () => {
      alive = false;
      clearInterval(pingInterval);
      if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
      wsRef.current?.close();
    };
  }, [auction.id, handleServerMessage]);

  return (
    <div className="flex flex-col md:flex-row min-h-dvh bg-black">
      {/* Video section: flex-1 on mobile (top), 70% on desktop (left) */}
      <div className="flex flex-col flex-1 md:flex-none md:w-[70%]">
        <div className="relative flex-1 bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={muted}
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Unmute overlay */}
          {muted && streamStatus === "live" && (
            <button
              type="button"
              onClick={() => setMuted(false)}
              className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 cursor-pointer"
              aria-label="Tap to hear audio"
            >
              <span className="text-white text-lg font-semibold">
                Tap to hear audio
              </span>
            </button>
          )}

          {/* LIVE badge */}
          {streamStatus === "live" && (
            <div className="absolute top-4 left-4 z-20">
              <span className="inline-flex items-center gap-1.5 rounded bg-green-600 px-2.5 py-1 text-sm font-semibold text-white uppercase tracking-wide">
                <span className="inline-block h-2 w-2 rounded-full bg-white animate-pulse" aria-hidden="true" />
                Live
              </span>
            </div>
          )}

          {/* Stream status overlays */}
          {streamStatus === "connecting" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
              <div
                className="h-10 w-10 rounded-full border-4 border-white/30 border-t-white animate-spin"
                role="status"
                aria-label="Connecting to stream"
              />
              <p className="text-white text-lg font-medium">
                Connecting to stream...
              </p>
            </div>
          )}
          {streamStatus === "waiting" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <h2 className="text-2xl font-bold text-white">{auction.title}</h2>
              <p className="text-white text-lg font-medium">
                Stream starting soon
              </p>
            </div>
          )}
          {streamStatus === "ended" && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-white text-lg font-semibold">
                Auction has ended
              </p>
            </div>
          )}
          {streamStatus === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
              <p className="text-white text-lg font-medium">
                Something went wrong. Try refreshing.
              </p>
              <button
                type="button"
                onClick={() => { reconnectAttempt.current = 0; connectWhep(whepUrl); }}
                className="h-12 min-w-12 px-6 rounded-lg bg-white text-black text-lg font-semibold cursor-pointer hover:bg-zinc-200 transition-colors"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        {/* Status area */}
        <div className="shrink-0 bg-zinc-900 px-4 py-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-white truncate">
              {auction.title}
            </h1>
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <span>{viewerCount} watching</span>
            </div>
          </div>
        </div>
      </div>

      {/* Chat section: placeholder for chat panel (30% on desktop) */}
      <div className="shrink-0 h-[40dvh] md:h-auto md:flex-1 bg-zinc-950" />
    </div>
  );
}
