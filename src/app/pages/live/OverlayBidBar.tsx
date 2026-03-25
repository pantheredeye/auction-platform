"use client";

import { useState, useRef, useEffect } from "react";
import type { LotStatus } from "@/auction/types";
import type { CurrentLotData } from "./hooks/useStreamStatus";
import type { LiveAuctionData } from "./LiveViewerClient";
import { formatCents, dollarsToCents } from "@/lib/money";

interface OverlayBidBarProps {
  currentLot: CurrentLotData | null;
  auction: LiveAuctionData;
  bidMode: boolean;
  confirmingBidCents: number | null;
  registrationComplete: boolean;
  onBidTap: () => void;
  onBidSubmit: (amountCents: number) => void;
  onBidCancel: () => void;
  onConfirmBid: (amountCents: number) => void;
  onCancelConfirm: () => void;
  onRegistrationGate: () => void;
  onCancelBidMode: () => void;
}

function lotStatusLabel(status: LotStatus): string | null {
  switch (status) {
    case "going_once":
      return "Going once!";
    case "going_twice":
      return "Going twice!";
    case "sold":
      return "Sold!";
    default:
      return null;
  }
}

export function OverlayBidBar({
  currentLot,
  auction,
  bidMode,
  confirmingBidCents,
  registrationComplete,
  onBidTap,
  onBidSubmit,
  onBidCancel,
  onConfirmBid,
  onCancelConfirm,
  onRegistrationGate,
  onCancelBidMode,
}: OverlayBidBarProps) {
  const isVisible = currentLot !== null;
  const statusLabel = currentLot ? lotStatusLabel(currentLot.status) : null;

  const currentBidCents =
    currentLot?.currentBidCents ??
    auction.activeLot?.startingPriceCents ??
    0;

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-20 pb-[max(0.5rem,env(safe-area-inset-bottom))] ${
        isVisible
          ? "translate-y-0"
          : "translate-y-full"
      } motion-safe:transition-transform motion-safe:duration-300`}
    >
      <div className="bg-zinc-900/95 backdrop-blur-sm px-4 pt-3 pb-2 md:max-w-lg md:mx-auto md:rounded-t-xl">
        {/* Bid confirmation modal */}
        {confirmingBidCents !== null && (
          <ConfirmModal
            amountCents={confirmingBidCents}
            onConfirm={() => onConfirmBid(confirmingBidCents)}
            onCancel={onCancelConfirm}
          />
        )}

        {bidMode && currentLot ? (
          <BidInputBar
            currentLot={currentLot}
            auction={auction}
            onSubmit={onBidSubmit}
            onCancel={onCancelBidMode}
          />
        ) : (
          <DefaultBar
            currentBidCents={currentBidCents}
            statusLabel={statusLabel}
            registrationComplete={registrationComplete}
            onBidTap={onBidTap}
            onRegistrationGate={onRegistrationGate}
          />
        )}
      </div>
    </div>
  );
}

// ─── Default state: bid amount + status + Place Bid button ─────────

function DefaultBar({
  currentBidCents,
  statusLabel,
  registrationComplete,
  onBidTap,
  onRegistrationGate,
}: {
  currentBidCents: number;
  statusLabel: string | null;
  registrationComplete: boolean;
  onBidTap: () => void;
  onRegistrationGate: () => void;
}) {
  const handlePress = () => {
    if (!registrationComplete) {
      onRegistrationGate();
      return;
    }
    onBidTap();
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-lg font-semibold text-white truncate">
          {formatCents(currentBidCents)}
        </p>
        {statusLabel && (
          <p className="text-sm font-medium text-amber-400">{statusLabel}</p>
        )}
      </div>
      <button
        type="button"
        onClick={handlePress}
        className="shrink-0 h-12 px-6 rounded-lg bg-white text-black text-lg font-semibold cursor-pointer hover:bg-zinc-200 transition-colors"
      >
        Place Bid
      </button>
    </div>
  );
}

// ─── Bid input mode ────────────────────────────────────────────────

function BidInputBar({
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

  const currentBidCents =
    currentLot.currentBidCents ?? auction.activeLot?.startingPriceCents ?? 0;
  const incrementCents =
    auction.activeLot?.incrementCents ?? auction.defaultIncrementCents;
  const minimumBidCents =
    currentLot.currentBidCents != null
      ? currentBidCents + incrementCents
      : auction.activeLot?.startingPriceCents ?? incrementCents;

  const enteredCents = value ? dollarsToCents(parseFloat(value)) : 0;
  const isValid =
    !isNaN(enteredCents) && enteredCents >= minimumBidCents && value.trim() !== "";

  const handleSubmit = () => {
    if (!isValid) return;
    onSubmit(enteredCents);
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-lg text-zinc-300">
          Current {formatCents(currentBidCents)}
        </span>
        <span className="text-zinc-500" aria-hidden="true">
          —
        </span>
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

// ─── Confirmation modal ────────────────────────────────────────────

function ConfirmModal({
  amountCents,
  onConfirm,
  onCancel,
}: {
  amountCents: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="absolute inset-x-0 bottom-full mb-2 px-4 md:max-w-lg md:mx-auto">
      <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 shadow-xl">
        <p className="text-lg text-white text-center mb-3">
          Bid {formatCents(amountCents)}?
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-12 rounded-lg border border-zinc-600 bg-zinc-900 text-lg text-zinc-300 cursor-pointer hover:border-zinc-500 transition-colors"
          >
            No
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 h-12 rounded-lg bg-white text-black text-lg font-semibold cursor-pointer hover:bg-zinc-200 transition-colors"
          >
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}
