"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ServerMessage, AuctionStatus, ChatMessage } from "@/auction/types";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { formatCents, dollarsToCents } from "@/lib/money";
import { RegistrationPanel } from "./RegistrationPanel";
import { StreamSlate } from "./StreamSlate";
import { useStreamStatus, formatTime } from "./hooks/useStreamStatus";
import { useWhepConnection } from "./hooks/useWhepConnection";
import { useAuctionWebSocket } from "./hooks/useAuctionWebSocket";
import type { StreamStatus, CurrentLotData } from "./hooks/useStreamStatus";

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
  orgName: string;
  orgSlateImageUrl: string | null;
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

export interface ExistingRegistration {
  registered: boolean;
  hasCard: boolean;
  userId?: string;
  userName?: string | null;
  userEmail?: string | null;
}

interface LiveViewerClientProps {
  auction: LiveAuctionData;
  guest: GuestInfo | null;
  bidderRequirement: string;
  existingRegistration: ExistingRegistration | null;
}

// ─── Chat Panel ──────────────────────────────────────────────────────

function ChatPanel({
  messages,
  guest,
  onSend,
  onRegistrationGate,
  registrationComplete,
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
  onRegistrationGate: () => void;
  registrationComplete: boolean;
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

  // Scroll pin on mobile keyboard open
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      if (autoScrollRef.current) {
        bottomRef.current?.scrollIntoView({ behavior: "instant" });
      }
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

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
    <div className="relative flex flex-col flex-1 min-h-0 bg-zinc-950 touch-manipulation">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 space-y-2 overscroll-contain [scrollbar-gutter:stable] [will-change:scroll-position]"
        aria-live="polite"
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
        <ChatInput guest={guest} onSend={onSend} onRegistrationGate={onRegistrationGate} registrationComplete={registrationComplete} currentLot={currentLot} onBidTap={onBidTap} />
      )}
    </div>
  );
}

// ─── Chat Input ──────────────────────────────────────────────────────

function BidButton({
  currentLot,
  registrationComplete,
  onRegistrationGate,
  onBidTap,
}: {
  currentLot: CurrentLotData | null;
  registrationComplete: boolean;
  onRegistrationGate: () => void;
  onBidTap: () => void;
}) {
  const disabled = !currentLot;

  const handleClick = () => {
    if (!registrationComplete) {
      onRegistrationGate();
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
      disabled={registrationComplete && disabled}
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
  onRegistrationGate,
  registrationComplete,
  currentLot,
  onBidTap,
}: {
  guest: GuestInfo | null;
  onSend: (content: string) => void;
  onRegistrationGate: () => void;
  registrationComplete: boolean;
  currentLot: CurrentLotData | null;
  onBidTap: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
    inputRef.current?.focus();
  };

  if (!registrationComplete) {
    return (
      <div className="shrink-0 border-t border-zinc-700 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex gap-2">
        <button
          type="button"
          onClick={onRegistrationGate}
          className="flex-1 h-12 px-4 rounded-lg border border-zinc-600 bg-zinc-900 text-lg text-zinc-500 text-left cursor-pointer hover:border-zinc-500 transition-colors"
        >
          Tap to join chat
        </button>
        <button
          type="button"
          onClick={onRegistrationGate}
          aria-label="Send"
          className="shrink-0 h-12 w-12 rounded-lg border border-zinc-600 bg-zinc-900 text-white cursor-pointer hover:border-zinc-500 transition-colors flex items-center justify-center"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M10 16V4M10 4L5 9M10 4L15 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-zinc-700 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex gap-2">
      <input
        ref={inputRef}
        type="text"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        enterKeyHint="send"
        placeholder="Type a message…"
        maxLength={500}
        className="flex-1 min-w-0 h-12 px-4 rounded-lg border border-zinc-600 bg-zinc-900 text-lg text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-400"
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!value.trim()}
        aria-label="Send"
        className="shrink-0 h-12 w-12 rounded-lg border border-zinc-600 bg-zinc-900 text-white cursor-pointer hover:border-zinc-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 16V4M10 4L5 9M10 4L15 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
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

export function LiveViewerClient({ auction, guest: initialGuest, bidderRequirement, existingRegistration }: LiveViewerClientProps) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [guest, setGuest] = useState<GuestInfo | null>(initialGuest);
  const [bidMode, setBidMode] = useState(false);
  const [confirmingBidCents, setConfirmingBidCents] = useState<number | null>(null);

  // Incrementing this forces the WS effect to re-run (close + reconnect)
  const [wsReconnectTrigger, setWsReconnectTrigger] = useState(0);

  // ─── Connection hooks ──────────────────────────────────────────

  const {
    streamStatus,
    setStreamStatus,
    viewerCount,
    currentLot,
    handleAuctionUpdate,
    handleLotUpdate,
    handleViewerCount,
  } = useStreamStatus(auction.status as AuctionStatus);

  const {
    videoRef,
    muted,
    toggleMute,
    streamStale,
    setStreamStale,
    cleanupWhep,
    retry,
    whepConnectedRef,
    reconnectAttempt,
    pcRef,
    reconnectTimer,
  } = useWhepConnection({
    auctionId: auction.id,
    streamStatus,
    setStreamStatus,
  });

  // ─── WS message handler ──────────────────────────────────────────

  const [showRegistration, setShowRegistration] = useState(false);

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "auction_update": {
        const status = msg.status as AuctionStatus;
        handleAuctionUpdate(status, whepConnectedRef.current);
        // Stream just became available — reset WHEP reconnect counter so next attempt succeeds
        if (status === "live" && !whepConnectedRef.current) {
          reconnectAttempt.current = 0;
        }
        break;
      }
      case "stream_ended": {
        setStreamStatus("ended");
        // Stop reconnection + close WHEP
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
        if (pcRef.current) {
          pcRef.current.close();
          pcRef.current = null;
        }
        whepConnectedRef.current = false;
        break;
      }
      case "viewer_count":
        handleViewerCount(msg.count);
        break;
      case "lot_update": {
        handleLotUpdate(
          msg.lotId,
          msg.status,
          msg.currentBidCents ?? null,
          msg.currentBidderId ?? null,
          msg.currentBidderName ?? null,
          msg.bidCount,
          () => setBidMode(false),
        );
        break;
      }
      case "chat_history":
        setChatMessages(msg.messages);
        break;
      case "chat_message":
        setChatMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        break;
      case "stream_paused":
        setStreamStale(true);
        break;
      case "bid_accepted":
        toast.success(`Your bid of ${formatCents(msg.amountCents)} was placed!`);
        navigator.vibrate?.(10);
        setBidMode(false);
        setConfirmingBidCents(null);
        break;
      case "bid_rejected":
        toast.error(msg.reason);
        setConfirmingBidCents(null);
        break;
      case "registration_required":
        setShowRegistration(true);
        break;
      case "pong":
        break;
    }
  }, [handleAuctionUpdate, handleLotUpdate, handleViewerCount, whepConnectedRef, reconnectAttempt, reconnectTimer, pcRef, setStreamStatus, setStreamStale]);

  const { send } = useAuctionWebSocket({
    auctionId: auction.id,
    onMessage: handleServerMessage,
    reconnectTrigger: wsReconnectTrigger,
  });

  // ─── Chat & bidding handlers ──────────────────────────────────────

  const sendChatMessage = useCallback((content: string) => {
    send({ type: "chat", content });
  }, [send]);

  const sendBid = useCallback((amountCents: number) => {
    if (!currentLot) return;
    send({
      type: "bid",
      lotId: currentLot.id,
      amountCents,
      idempotencyKey: nanoid(),
    });
    setConfirmingBidCents(null);
    setBidMode(false);
  }, [currentLot, send]);

  const handleBidSubmit = useCallback((amountCents: number) => {
    setConfirmingBidCents(amountCents);
  }, []);

  const handleBidCancel = useCallback(() => {
    setConfirmingBidCents(null);
  }, []);

  const handleBidTap = useCallback(() => {
    if (currentLot) setBidMode(true);
  }, [currentLot]);

  const [registrationComplete, setRegistrationComplete] = useState(() => {
    if (!existingRegistration?.registered) return false;
    return existingRegistration.hasCard || bidderRequirement !== "card_on_file";
  });

  const handleRegistrationGate = useCallback(() => {
    if (!registrationComplete) {
      setShowRegistration(true);
    }
  }, [registrationComplete]);

  const handleRegistrationComplete = useCallback(async (reg: { userId?: string; name: string; hasCard: boolean }) => {
    setGuest((prev) => prev ? { ...prev, name: reg.name } : prev);
    setRegistrationComplete(true);
    setShowRegistration(false);
    // Force WS reconnect so new connection includes updated cookies
    setWsReconnectTrigger((n) => n + 1);
  }, []);

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

          <StreamSlate
            streamStatus={streamStatus}
            streamStale={streamStale}
            auctionTitle={auction.title}
            orgName={auction.orgName}
            slateImageUrl={auction.orgSlateImageUrl}
            onRetry={retry}
            onUnmute={toggleMute}
            muted={muted}
          />
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

      {/* Chat column: banner + chat panel */}
      <div className="flex flex-col shrink-0 h-[40dvh] md:h-auto md:flex-1">
        {/* Pre-registration banner */}
        {bidderRequirement !== "guest" && !registrationComplete && (
          <div className="shrink-0 bg-zinc-800/90 border-b border-zinc-700 px-4 py-2 flex items-center justify-between gap-3">
            <p className="text-sm text-zinc-300">
              Register now to participate when bidding starts
            </p>
            <button
              type="button"
              onClick={() => setShowRegistration(true)}
              className="shrink-0 h-10 min-w-[5rem] px-4 rounded-lg bg-white text-black text-sm font-semibold cursor-pointer hover:bg-zinc-200 transition-colors"
            >
              Register
            </button>
          </div>
        )}

        <ChatPanel
          messages={chatMessages}
          guest={guest}
          onSend={sendChatMessage}
          onRegistrationGate={handleRegistrationGate}
          registrationComplete={registrationComplete}
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

      {showRegistration && guest && (
        <RegistrationPanel
          requirement={bidderRequirement as "guest" | "registered" | "card_on_file"}
          onComplete={handleRegistrationComplete}
          onCancel={() => setShowRegistration(false)}
          guestId={guest.id}
        />
      )}
    </div>
  );
}
