"use client";

import { useState, useRef, useEffect, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────────────────

type StreamStatus = "connecting" | "live" | "waiting" | "ended" | "error";

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

export function LiveViewerClient({ auction, guest }: LiveViewerClientProps) {
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
  const [muted, setMuted] = useState(true);
  const [viewerCount, setViewerCount] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const whepUrl = `/play/${auction.id}`;

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
          setStreamStatus("live");
        } else if (state === "failed" || state === "disconnected" || state === "closed") {
          setStreamStatus("error");
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
      setStreamStatus("error");
      scheduleReconnect(url);
    }
  }, [cleanupConnection]);

  const scheduleReconnect = useCallback((url: string) => {
    if (!mountedRef.current) return;
    reconnectTimer.current = setTimeout(() => {
      if (mountedRef.current) connectWhep(url);
    }, 5000);
  }, [connectWhep]);

  useEffect(() => {
    mountedRef.current = true;
    connectWhep(whepUrl);
    return () => {
      mountedRef.current = false;
      cleanupConnection();
    };
  }, [whepUrl, connectWhep, cleanupConnection]);

  return (
    <div className="flex flex-col min-h-dvh bg-black">
      {/* Video container */}
      <div className="relative flex-1 bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className="w-full h-full object-cover"
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
              onClick={() => connectWhep(whepUrl)}
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
  );
}
