import { useCallback } from "react";
import type { ServerMessage, AuctionStatus, LotStatus, ChatMessage } from "@/auction/types";
import type { StreamStatus } from "./useStreamStatus";

interface DispatchDeps {
  // Stream status
  handleAuctionUpdate: (status: AuctionStatus, whepConnected: boolean) => void;
  handleViewerCount: (count: number) => void;
  handleLotUpdate: (
    lotId: string,
    status: LotStatus,
    currentBidCents: number | null,
    currentBidderId: string | null,
    currentBidderName: string | null,
    bidCount: number,
    onLotCleared?: () => void,
  ) => void;
  setStreamStatus: (status: StreamStatus) => void;

  // WHEP refs
  whepConnectedRef: React.RefObject<boolean>;
  reconnectAttempt: React.RefObject<number>;
  reconnectTimer: React.RefObject<ReturnType<typeof setTimeout> | null>;
  pcRef: React.RefObject<RTCPeerConnection | null>;

  // Chat
  handleChatHistory: (messages: ChatMessage[]) => void;
  handleChatMessage: (msg: ChatMessage) => void;

  // Bidding
  handleBidAccepted: (amountCents: number) => void;
  handleBidRejected: (reason: string) => void;
  setBidMode: (mode: boolean) => void;

  // Registration
  setStreamStale: (stale: boolean) => void;
  openRegistration: () => void;
}

export function useServerMessageDispatch(deps: DispatchDeps) {
  const {
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
    handleBidAccepted,
    handleBidRejected,
    setBidMode,
    setStreamStale,
    openRegistration,
  } = deps;

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "auction_update": {
        const status = msg.status as AuctionStatus;
        handleAuctionUpdate(status, whepConnectedRef.current);
        if (status === "live" && !whepConnectedRef.current) {
          reconnectAttempt.current = 0;
        }
        break;
      }
      case "stream_ended": {
        setStreamStatus("ended");
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
        handleChatHistory(msg.messages);
        break;
      case "chat_message":
        handleChatMessage(msg);
        break;
      case "stream_paused":
        setStreamStale(true);
        break;
      case "bid_accepted":
        handleBidAccepted(msg.amountCents);
        break;
      case "bid_rejected":
        handleBidRejected(msg.reason);
        break;
      case "registration_required":
        openRegistration();
        break;
      case "pong":
        break;
    }
  }, [
    handleAuctionUpdate, handleViewerCount, handleLotUpdate, setStreamStatus,
    whepConnectedRef, reconnectAttempt, reconnectTimer, pcRef,
    handleChatHistory, handleChatMessage,
    handleBidAccepted, handleBidRejected, setBidMode,
    setStreamStale, openRegistration,
  ]);

  return { handleServerMessage };
}
