import { useRef, useEffect, useCallback } from "react";
import type { ServerMessage } from "@/auction/types";

interface UseAuctionWebSocketOptions {
  auctionId: string;
  onMessage: (msg: ServerMessage) => void;
  reconnectTrigger: number;
}

export function useAuctionWebSocket({ auctionId, onMessage, reconnectTrigger }: UseAuctionWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);

  const send = useCallback((data: unknown) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let wsReconnectAttempt = 0;
    let alive = true;

    function connectWs() {
      if (!alive) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${location.host}/ws/auction/${auctionId}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!alive) { ws.close(); return; }
        wsReconnectAttempt = 0;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as ServerMessage;
          onMessage(msg);
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
  }, [auctionId, onMessage, reconnectTrigger]);

  return { send, wsRef };
}
