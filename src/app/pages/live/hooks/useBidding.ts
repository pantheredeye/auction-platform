import { useState, useCallback } from "react";
import { formatCents } from "@/lib/money";
import { toast } from "sonner";
import type { CurrentLotData } from "./useStreamStatus";

export function useBidding(currentLot: CurrentLotData | null) {
  const [bidMode, setBidMode] = useState(false);
  const [confirmingBidCents, setConfirmingBidCents] = useState<number | null>(null);

  const handleBidSubmit = useCallback((amountCents: number) => {
    setConfirmingBidCents(amountCents);
  }, []);

  const handleBidCancel = useCallback(() => {
    setConfirmingBidCents(null);
  }, []);

  const handleBidTap = useCallback(() => {
    if (currentLot) setBidMode(true);
  }, [currentLot]);

  const cancelBidMode = useCallback(() => {
    setBidMode(false);
  }, []);

  const clearBidState = useCallback(() => {
    setConfirmingBidCents(null);
    setBidMode(false);
  }, []);

  const handleBidAccepted = useCallback((amountCents: number) => {
    toast.success(`Your bid of ${formatCents(amountCents)} was placed!`);
    navigator.vibrate?.(10);
    setBidMode(false);
    setConfirmingBidCents(null);
  }, []);

  const handleBidRejected = useCallback((reason: string) => {
    toast.error(reason);
    setConfirmingBidCents(null);
  }, []);

  return {
    bidMode,
    confirmingBidCents,
    handleBidSubmit,
    handleBidCancel,
    handleBidTap,
    cancelBidMode,
    clearBidState,
    handleBidAccepted,
    handleBidRejected,
    setBidMode,
  };
}
