"use client";

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
  return (
    <div
      className={`fixed left-0 w-[70%] max-h-[40dvh] md:w-[40%] md:max-h-[50dvh] z-10 pointer-events-none flex flex-col justify-end ${hasActiveLot ? "bottom-20" : "bottom-0"}`}
    >
      <div className="overflow-y-auto px-3 py-2 flex flex-col gap-1.5">
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
                {msg.messageType === "bid" ? `⭐ ${msg.content}` : msg.content}
              </span>
            </div>
          );
        })}
      </div>
      {/* Chat input — placeholder, full implementation in sibling epic */}
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
