import { useState, useCallback } from "react";
import type { GuestInfo, ExistingRegistration } from "../LiveViewerClient";

export function useRegistration(
  initialGuest: GuestInfo | null,
  existingRegistration: ExistingRegistration | null,
  bidderRequirement: string,
  setWsReconnectTrigger: (fn: (n: number) => number) => void,
) {
  const [guest, setGuest] = useState<GuestInfo | null>(initialGuest);
  const [showRegistration, setShowRegistration] = useState(false);
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
    setWsReconnectTrigger((n) => n + 1);
  }, [setWsReconnectTrigger]);

  const openRegistration = useCallback(() => {
    setShowRegistration(true);
  }, []);

  const closeRegistration = useCallback(() => {
    setShowRegistration(false);
  }, []);

  return {
    guest,
    showRegistration,
    registrationComplete,
    handleRegistrationGate,
    handleRegistrationComplete,
    openRegistration,
    closeRegistration,
  };
}
