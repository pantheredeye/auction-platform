"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import type { ChatMessage } from "@/auction/types";
import type { GuestInfo } from "./LiveViewerClient";

interface OverlayChatPanelProps {
  messages: ChatMessage[];
  guest: GuestInfo | null;
  onSend: (content: string) => void;
  onRegistrationGate: () => void;
  registrationComplete: boolean;
  hasActiveLot: boolean;
}

export function OverlayChatPanel({
  messages,
  guest,
  onSend,
  onRegistrationGate,
  registrationComplete,
  hasActiveLot,
}: OverlayChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  // Bottom-detection: track whether user has scrolled up
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setIsAtBottom(atBottom);
    if (atBottom) setHasNewMessages(false);
  }, []);

  // Auto-scroll on new messages (only if at bottom)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (isAtBottom) {
      el.scrollTop = el.scrollHeight;
    } else if (messages.length > 0) {
      setHasNewMessages(true);
    }
  }, [messages, isAtBottom]);

  // visualViewport resize handler for mobile keyboard
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const offset = window.innerHeight - vv.height;
      setKeyboardOffset(offset > 50 ? offset : 0);
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setIsAtBottom(true);
    setHasNewMessages(false);
  }, []);

  const bottomClass = hasActiveLot ? "bottom-20" : "bottom-0";

  return (
    <div
      className={`fixed left-0 w-[70%] max-h-[40dvh] md:w-[40%] md:max-h-[50dvh] z-10 pointer-events-none flex flex-col justify-end ${bottomClass}`}
      style={keyboardOffset > 0 ? { bottom: `${keyboardOffset}px` } : undefined}
    >
      <div
        ref={scrollRef}
        className="overflow-y-auto px-3 py-2 flex flex-col gap-1.5"
        onScroll={handleScroll}
      >
        {messages.map((msg, idx) => {
          const opacity = Math.max(0.3, 1 - (messages.length - 1 - idx) * 0.12);
          return (
            <div
              key={msg.id}
              className={`px-4 py-2 rounded-full text-lg [text-shadow:0_1px_3px_rgba(0,0,0,0.8)] motion-safe:transition-opacity ${msg.messageType === "bid" ? "bg-amber-900/60" : "bg-black/60"} backdrop-blur-sm`}
              style={{ opacity }}
            >
              <span className="font-semibold text-white">{msg.username}: </span>
              <span className="text-zinc-100">
                {msg.messageType === "bid" ? `\u2B50 ${msg.content}` : msg.content}
              </span>
            </div>
          );
        })}
      </div>

      {/* New messages indicator */}
      {hasNewMessages && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="pointer-events-auto mx-3 mb-1 h-8 rounded-full bg-black/70 backdrop-blur-sm text-sm text-zinc-200 font-medium"
        >
          New messages
        </button>
      )}

      {/* Chat input */}
      <div className="pointer-events-auto px-3 pb-3">
        {registrationComplete ? (
          <input
            type="text"
            placeholder="Say something..."
            className="w-full h-12 rounded-full bg-black/40 backdrop-blur-sm border border-zinc-600 px-4 text-lg text-white placeholder:text-zinc-400"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const val = (e.target as HTMLInputElement).value.trim();
                if (val) {
                  onSend(val);
                  (e.target as HTMLInputElement).value = "";
                }
              }
            }}
          />
        ) : (
          <button
            type="button"
            onClick={onRegistrationGate}
            className="w-full h-12 rounded-full bg-black/40 backdrop-blur-sm border border-zinc-600 text-lg text-zinc-300 cursor-pointer"
          >
            Tap to join chat
          </button>
        )}
      </div>
    </div>
  );
}
