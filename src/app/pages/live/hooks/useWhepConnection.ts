import { useState, useRef, useEffect, useCallback } from "react";
import type { StreamStatus } from "./useStreamStatus";

interface UseWhepConnectionOptions {
  auctionId: string;
  streamStatus: StreamStatus;
  setStreamStatus: (status: StreamStatus | ((prev: StreamStatus) => StreamStatus)) => void;
}

export function useWhepConnection({ auctionId, streamStatus, setStreamStatus }: UseWhepConnectionOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempt = useRef(0);
  const mountedRef = useRef(true);
  const whepConnectedRef = useRef(false);
  const [muted, setMuted] = useState(true);
  const [streamStale, setStreamStale] = useState(false);

  const whepUrl = `/play/${auctionId}`;

  const cleanupWhep = useCallback(() => {
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
    cleanupWhep();
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
        setStreamStale(false);
        event.track.onmute = () => setStreamStale(true);
        event.track.onended = () => setStreamStale(true);
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
  }, [cleanupWhep, setStreamStatus]);

  const scheduleReconnect = useCallback((url: string) => {
    if (!mountedRef.current) return;
    if (reconnectAttempt.current >= 15) {
      setStreamStatus("error");
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt.current), 10000);
    reconnectAttempt.current++;
    setStreamStatus((prev: StreamStatus) => prev === "waiting" ? "waiting" : "connecting");
    reconnectTimer.current = setTimeout(() => {
      if (mountedRef.current) connectWhep(url);
    }, delay);
  }, [connectWhep, setStreamStatus]);

  const toggleMute = useCallback(() => {
    setMuted((m) => !m);
  }, []);

  const retry = useCallback(() => {
    reconnectAttempt.current = 0;
    connectWhep(whepUrl);
  }, [connectWhep, whepUrl]);

  useEffect(() => {
    mountedRef.current = true;
    connectWhep(whepUrl);
    return () => {
      mountedRef.current = false;
      cleanupWhep();
    };
  }, [whepUrl, connectWhep, cleanupWhep]);

  return {
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
  };
}
