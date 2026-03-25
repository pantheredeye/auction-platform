"use client";

import { useState, useCallback } from "react";
import type { AuctionStatus } from "@/auction/types";
import { nanoid } from "nanoid";
import type { LiveViewerClientProps } from "./LiveViewerClient";
import { RegistrationPanel } from "./RegistrationPanel";
import { StreamSlate } from "./StreamSlate";
import { OverlayHeader } from "./OverlayHeader";
import { OverlayChatPanel } from "./OverlayChatPanel";
import { OverlayBidBar } from "./OverlayBidBar";
import { useStreamStatus } from "./hooks/useStreamStatus";
import { useWhepConnection } from "./hooks/useWhepConnection";
import { useAuctionWebSocket } from "./hooks/useAuctionWebSocket";
import { useChat } from "./hooks/useChat";
import { useBidding } from "./hooks/useBidding";
import { useRegistration } from "./hooks/useRegistration";
import { useServerMessageDispatch } from "./hooks/useServerMessageDispatch";

export function LiveViewerOverlayClient({
  auction,
  guest: initialGuest,
  bidderRequirement,
  existingRegistration,
}: LiveViewerClientProps) {
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

  // ─── Interaction hooks ──────────────────────────────────────────

  const { chatMessages, handleChatHistory, handleChatMessage } = useChat();

  const bidding = useBidding(currentLot);

  const {
    guest,
    showRegistration,
    registrationComplete,
    handleRegistrationGate,
    handleRegistrationComplete,
    openRegistration,
    closeRegistration,
  } = useRegistration(initialGuest, existingRegistration, bidderRequirement, setWsReconnectTrigger);

  // ─── Orchestration: message dispatch → WS ──────────────────────

  const { handleServerMessage } = useServerMessageDispatch({
    handleAuctionUpdate,
    handleViewerCount,
    handleLotUpdate,
    setStreamStatus,
    whepConnectedRef,
    reconnectAttempt,
    reconnectTimer,
    pcRef,
    handleChatHistory,
    handleChatMessage,
    handleBidAccepted: bidding.handleBidAccepted,
    handleBidRejected: bidding.handleBidRejected,
    setBidMode: bidding.setBidMode,
    setStreamStale,
    openRegistration,
  });

  const { send } = useAuctionWebSocket({
    auctionId: auction.id,
    onMessage: handleServerMessage,
    reconnectTrigger: wsReconnectTrigger,
  });

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
    bidding.clearBidState();
  }, [currentLot, send, bidding.clearBidState]);

  const hasActiveLot = !!(currentLot && currentLot.status !== "pending");

  return (
    <div className="relative w-full h-dvh bg-black overflow-hidden">
      {/* Video — base layer */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* StreamSlate — z-10, pointer-events-auto for unmute tap */}
      <div className="absolute inset-0 z-10 pointer-events-auto">
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

      {/* OverlayChatPanel — z-10, pointer-events-none */}
      <OverlayChatPanel
        messages={chatMessages}
        guest={guest}
        onSend={sendChatMessage}
        onRegistrationGate={handleRegistrationGate}
        registrationComplete={registrationComplete}
        hasActiveLot={hasActiveLot}
      />

      {/* OverlayHeader — z-20 */}
      <OverlayHeader
        currentLot={currentLot}
        streamStatus={streamStatus}
        viewerCount={viewerCount}
        auctionTitle={auction.title}
      />

      {/* OverlayBidBar — z-20 */}
      <OverlayBidBar
        currentLot={currentLot}
        auction={auction}
        bidMode={bidding.bidMode}
        confirmingBidCents={bidding.confirmingBidCents}
        registrationComplete={registrationComplete}
        onBidTap={bidding.handleBidTap}
        onBidSubmit={bidding.handleBidSubmit}
        onBidCancel={bidding.handleBidCancel}
        onConfirmBid={sendBid}
        onCancelConfirm={bidding.handleBidCancel}
        onRegistrationGate={handleRegistrationGate}
        onCancelBidMode={bidding.cancelBidMode}
      />

      {/* RegistrationPanel — z-50 */}
      {showRegistration && guest && (
        <RegistrationPanel
          requirement={bidderRequirement as "guest" | "registered" | "card_on_file"}
          onComplete={handleRegistrationComplete}
          onCancel={closeRegistration}
          guestId={guest.id}
        />
      )}
    </div>
  );
}
