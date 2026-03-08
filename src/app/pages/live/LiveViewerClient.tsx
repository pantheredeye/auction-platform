"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ServerMessage, AuctionStatus, LotStatus, ChatMessage } from "@/auction/types";
import { nanoid } from "nanoid";
import { formatCents, dollarsToCents } from "@/lib/money";
import { setGuestName } from "./server-functions/guest";

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

// ─── Chat Panel ──────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function ChatPanel({
  messages,
  guest,
  onSend,
  showNamePrompt,
  onNamePrompt,
  nameValue,
  onNameChange,
  onNameSubmit,
  nameSubmitting,
  currentLot,
  onBidTap,
  bidInputElement,
  confirmingBidCents,
  onConfirmBid,
  onCancelConfirm,
}: {
  messages: ChatMessage[];
  guest: GuestInfo | null;
  onSend: (content: string) => void;
  showNamePrompt: boolean;
  onNamePrompt: () => void;
  nameValue: string;
  onNameChange: (value: string) => void;
  onNameSubmit: () => void;
  nameSubmitting: boolean;
  currentLot: CurrentLotData | null;
  onBidTap: () => void;
  bidInputElement?: React.ReactNode;
  confirmingBidCents?: number | null;
  onConfirmBid?: (amountCents: number) => void;
  onCancelConfirm?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // Focus name input when prompt appears
  useEffect(() => {
    if (showNamePrompt) {
      // RAF ensures the DOM has painted before focusing
      requestAnimationFrame(() => nameInputRef.current?.focus());
    }
  }, [showNamePrompt]);

  // Detect manual scroll-up to pause auto-scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Consider "at bottom" if within 48px of the bottom
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    autoScrollRef.current = atBottom;
    if (atBottom) setHasNewMessages(false);
  }, []);

  // Auto-scroll on new messages (or flag new messages if scrolled up)
  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (messages.length > 0) {
      setHasNewMessages(true);
    }
  }, [messages]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    autoScrollRef.current = true;
    setHasNewMessages(false);
  }, []);

  return (
    <div className="relative flex flex-col shrink-0 h-[40dvh] md:h-auto md:flex-1 bg-zinc-950">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 space-y-2"
      >
        {messages.length === 0 && (
          <p className="text-lg text-zinc-500 font-medium text-center py-8">
            No messages yet
          </p>
        )}
        {messages.map((msg) => {
          const isBid = msg.messageType === "bid";
          return (
            <div
              key={msg.id}
              className={`text-lg rounded px-2 py-1 ${isBid ? "bg-amber-900/40 font-semibold" : ""}`}
            >
              {isBid && <span className="mr-1" aria-label="Bid">★</span>}
              <span className="font-bold text-zinc-300">{msg.username}</span>
              <span className="text-zinc-100 ml-2">{msg.content}</span>
              <span className="text-sm text-zinc-500 ml-2">
                {formatTime(msg.createdAt)}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {hasNewMessages && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 min-h-[48px] px-5 rounded-full bg-zinc-800/90 text-white text-lg font-medium shadow-lg backdrop-blur-sm cursor-pointer hover:bg-zinc-700/90 transition-colors"
        >
          New messages
        </button>
      )}

      {showNamePrompt && (
        <div className="absolute inset-x-0 bottom-0 z-20 p-3">
          <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-lg">
            <h2 className="text-lg font-semibold text-white mb-3">
              What&apos;s your name?
            </h2>
            <input
              ref={nameInputRef}
              type="text"
              value={nameValue}
              onChange={(e) => onNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onNameSubmit();
                }
              }}
              placeholder="Your first name"
              maxLength={50}
              autoFocus
              disabled={nameSubmitting}
              className="w-full h-12 px-4 rounded-lg border border-zinc-600 bg-zinc-800 text-lg text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-400 mb-3 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={onNameSubmit}
              disabled={!nameValue.trim() || nameSubmitting}
              className="w-full h-12 rounded-lg bg-white text-black text-lg font-semibold cursor-pointer hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {nameSubmitting ? "Joining…" : "Join Chat"}
            </button>
          </div>
        </div>
      )}

      {confirmingBidCents != null && onConfirmBid && onCancelConfirm && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80">
          <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-lg w-[calc(100%-2rem)] max-w-sm text-center">
            <p className="text-2xl font-bold text-white mb-6">
              Bid {formatCents(confirmingBidCents)}?
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onCancelConfirm}
                className="flex-1 h-12 rounded-lg border border-zinc-600 bg-zinc-800 text-lg font-semibold text-white cursor-pointer hover:bg-zinc-700 transition-colors"
              >
                No
              </button>
              <button
                type="button"
                onClick={() => onConfirmBid(confirmingBidCents)}
                className="flex-1 h-12 rounded-lg bg-white text-black text-lg font-semibold cursor-pointer hover:bg-zinc-200 transition-colors"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

      {bidInputElement || (
        <ChatInput guest={guest} onSend={onSend} onNamePrompt={onNamePrompt} currentLot={currentLot} onBidTap={onBidTap} />
      )}
    </div>
  );
}

// ─── Chat Input ──────────────────────────────────────────────────────

function BidButton({
  guest,
  currentLot,
  onNamePrompt,
  onBidTap,
}: {
  guest: GuestInfo | null;
  currentLot: CurrentLotData | null;
  onNamePrompt: () => void;
  onBidTap: () => void;
}) {
  const hasName = Boolean(guest?.name);
  const disabled = !currentLot;

  const handleClick = () => {
    if (!hasName) {
      onNamePrompt();
      return;
    }
    if (!disabled) {
      onBidTap();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={hasName && disabled}
      title={disabled ? "No active item" : undefined}
      aria-label="Place bid"
      className="shrink-0 h-12 w-12 rounded-lg border border-zinc-600 bg-zinc-900 text-lg font-semibold text-white cursor-pointer hover:border-zinc-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      $
    </button>
  );
}

function ChatInput({
  guest,
  onSend,
  onNamePrompt,
  currentLot,
  onBidTap,
}: {
  guest: GuestInfo | null;
  onSend: (content: string) => void;
  onNamePrompt: () => void;
  currentLot: CurrentLotData | null;
  onBidTap: () => void;
}) {
  const [value, setValue] = useState("");
  const hasName = Boolean(guest?.name);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || !hasName) return;
    onSend(trimmed);
    setValue("");
  };

  if (!hasName) {
    return (
      <div className="shrink-0 border-t border-zinc-700 p-2 flex gap-2">
        <button
          type="button"
          onClick={onNamePrompt}
          className="flex-1 h-12 px-4 rounded-lg border border-zinc-600 bg-zinc-900 text-lg text-zinc-500 text-left cursor-pointer hover:border-zinc-500 transition-colors"
        >
          Enter your name to chat
        </button>
        <BidButton guest={guest} currentLot={currentLot} onNamePrompt={onNamePrompt} onBidTap={onBidTap} />
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-zinc-700 p-2 flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder="Type a message…"
        maxLength={500}
        className="flex-1 min-w-0 h-12 px-4 rounded-lg border border-zinc-600 bg-zinc-900 text-lg text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-400"
      />
      <BidButton guest={guest} currentLot={currentLot} onNamePrompt={onNamePrompt} onBidTap={onBidTap} />
    </div>
  );
}

// ─── Bid Input ──────────────────────────────────────────────────────

function BidInput({
  currentLot,
  auction,
  onSubmit,
  onCancel,
}: {
  currentLot: CurrentLotData;
  auction: LiveAuctionData;
  onSubmit: (amountCents: number) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const currentBidCents = currentLot.currentBidCents ?? auction.activeLot?.startingPriceCents ?? 0;
  const incrementCents = auction.activeLot?.incrementCents ?? auction.defaultIncrementCents;
  const minimumBidCents = currentLot.currentBidCents != null
    ? currentBidCents + incrementCents
    : auction.activeLot?.startingPriceCents ?? incrementCents;

  const enteredCents = value ? dollarsToCents(parseFloat(value)) : 0;
  const isValid = !isNaN(enteredCents) && enteredCents >= minimumBidCents && value.trim() !== "";

  const handleSubmit = () => {
    if (!isValid) return;
    onSubmit(enteredCents);
  };

  return (
    <div className="shrink-0 border-t border-zinc-700 p-2">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-lg text-zinc-300">
          Current {formatCents(currentBidCents)}
        </span>
        <span className="text-zinc-500" aria-hidden="true">—</span>
        <span className="text-lg text-zinc-400">
          Minimum {formatCents(minimumBidCents)}
        </span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel bid"
          className="shrink-0 h-12 px-4 rounded-lg border border-zinc-600 bg-zinc-900 text-lg text-zinc-300 cursor-pointer hover:border-zinc-500 transition-colors"
        >
          Cancel
        </button>
        <input
          ref={inputRef}
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          placeholder={`$${(minimumBidCents / 100).toFixed(2)}`}
          step="0.01"
          min={minimumBidCents / 100}
          aria-label="Bid amount in dollars"
          className="flex-1 min-w-0 h-12 px-4 rounded-lg border border-zinc-600 bg-zinc-900 text-lg text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-400"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!isValid}
          className="shrink-0 h-12 px-5 rounded-lg bg-white text-black text-lg font-semibold cursor-pointer hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Bid
        </button>
      </div>
    </div>
  );
}

export function LiveViewerClient({ auction, guest: initialGuest }: LiveViewerClientProps) {
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
  const [muted, setMuted] = useState(true);
  const [viewerCount, setViewerCount] = useState(0);
  const [auctionStatus, setAuctionStatus] = useState<AuctionStatus>(auction.status as AuctionStatus);
  const [currentLot, setCurrentLot] = useState<CurrentLotData | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [guest, setGuest] = useState<GuestInfo | null>(initialGuest);
  const [bidMode, setBidMode] = useState(false);
  const [confirmingBidCents, setConfirmingBidCents] = useState<number | null>(null);

  // Incrementing this forces the WS effect to re-run (close + reconnect)
  const [wsReconnectTrigger, setWsReconnectTrigger] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempt = useRef(0);
  const mountedRef = useRef(true);
  const wsRef = useRef<WebSocket | null>(null);

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
          setCurrentLot((prev) => {
            if (prev?.id === msg.lotId) {
              setBidMode(false);
              return null;
            }
            return prev;
          });
        }
        break;
      }
      case "chat_history":
        setChatMessages(msg.messages);
        break;
      case "chat_message":
        setChatMessages((prev) => [...prev, msg]);
        break;
      case "pong":
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

  const sendChatMessage = useCallback((content: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "chat", content }));
    }
  }, []);

  const sendBid = useCallback((amountCents: number) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !currentLot) return;
    ws.send(JSON.stringify({
      type: "bid",
      lotId: currentLot.id,
      amountCents,
      idempotencyKey: nanoid(),
    }));
    setConfirmingBidCents(null);
    setBidMode(false);
  }, [currentLot]);

  const handleBidSubmit = useCallback((amountCents: number) => {
    setConfirmingBidCents(amountCents);
  }, []);

  const handleBidCancel = useCallback(() => {
    setConfirmingBidCents(null);
  }, []);

  const handleBidTap = useCallback(() => {
    if (currentLot) setBidMode(true);
  }, [currentLot]);

  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [nameSubmitting, setNameSubmitting] = useState(false);

  const handleNamePrompt = useCallback(() => {
    setShowNamePrompt(true);
  }, []);

  const handleNameSubmit = useCallback(async () => {
    const trimmed = nameValue.trim();
    if (!trimmed || nameSubmitting) return;

    setNameSubmitting(true);
    try {
      const ok = await setGuestName(trimmed);
      if (!ok) return;
      setGuest((prev) => prev ? { ...prev, name: trimmed } : prev);
      setShowNamePrompt(false);
      setNameValue("");
      // Force WS reconnect so new connection includes guest_name cookie
      setWsReconnectTrigger((n) => n + 1);
    } finally {
      setNameSubmitting(false);
    }
  }, [nameValue, nameSubmitting]);

  useEffect(() => {
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
      wsRef.current = null;
    };
  }, [auction.id, handleServerMessage, wsReconnectTrigger]);

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

        {/* Status bar */}
        <div className="shrink-0 bg-zinc-900 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-lg font-semibold text-white truncate">
              {auction.title}
            </h1>
            <div className="flex items-center gap-3 shrink-0">
              {streamStatus === "live" && (
                <span className="inline-flex items-center gap-1.5 rounded bg-green-600 px-2.5 py-1 text-sm font-semibold text-white uppercase tracking-wide">
                  <span className="inline-block h-2 w-2 rounded-full bg-white animate-pulse" aria-hidden="true" />
                  Live
                </span>
              )}
              {streamStatus === "waiting" && (
                <span className="text-lg text-zinc-300 font-medium">Starting soon</span>
              )}
              {streamStatus === "ended" && (
                <span className="text-lg text-zinc-400 font-medium">Ended</span>
              )}
              {streamStatus === "connecting" && (
                <span className="text-lg text-zinc-400 font-medium">Connecting…</span>
              )}
              {streamStatus === "error" && (
                <span className="text-lg text-red-400 font-medium">Error</span>
              )}
              <span className="text-lg text-zinc-400">{viewerCount} watching</span>
            </div>
          </div>
        </div>
      </div>

      {/* Chat section: independently scrollable (40dvh mobile, 30% desktop) */}
      <ChatPanel
        messages={chatMessages}
        guest={guest}
        onSend={sendChatMessage}
        showNamePrompt={showNamePrompt}
        onNamePrompt={handleNamePrompt}
        nameValue={nameValue}
        onNameChange={setNameValue}
        onNameSubmit={handleNameSubmit}
        nameSubmitting={nameSubmitting}
        currentLot={currentLot}
        onBidTap={handleBidTap}
        bidInputElement={bidMode && currentLot ? (
          <BidInput
            currentLot={currentLot}
            auction={auction}
            onSubmit={handleBidSubmit}
            onCancel={() => setBidMode(false)}
          />
        ) : undefined}
        confirmingBidCents={confirmingBidCents}
        onConfirmBid={sendBid}
        onCancelConfirm={handleBidCancel}
      />
    </div>
  );
}
