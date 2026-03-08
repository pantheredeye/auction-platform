"use client";

import { useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";

interface ChatMessage {
  id: string;
  content: string;
  type: string;
  createdAt: string;
  username: string;
  displayName: string | null;
}

interface RecordingClientProps {
  recordingUrl: string;
  auction: { id: string; title: string };
  chatMessages: ChatMessage[];
}

const PLAYBACK_SPEEDS = [
  { value: "1", label: "1x" },
  { value: "1.5", label: "1.5x" },
  { value: "2", label: "2x" },
];

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function RecordingClient({ recordingUrl, auction, chatMessages }: RecordingClientProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [speed, setSpeed] = useState("1");

  function handleSpeedChange(value: string) {
    setSpeed(value);
    if (videoRef.current) {
      videoRef.current.playbackRate = parseFloat(value);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <h1 className="mb-4 text-xl font-semibold">{auction.title} — Recording</h1>

      <div className="flex flex-col gap-4 md:flex-row">
        {/* Video panel */}
        <div className="flex-1 min-w-0">
          <div className="overflow-hidden rounded-lg bg-black">
            <video
              ref={videoRef}
              src={recordingUrl}
              controls
              className="w-full"
              playsInline
            />
          </div>

          <div className="mt-3 flex items-center gap-3">
            <label className="text-sm text-muted-foreground">Speed</label>
            <Select value={speed} onValueChange={handleSpeedChange}>
              <SelectTrigger size="sm" className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLAYBACK_SPEEDS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Chat timeline */}
        <div className="md:w-80 lg:w-96 flex flex-col rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">
              Chat ({chatMessages.length})
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto p-3 max-h-[40dvh] md:max-h-[70vh]">
            {chatMessages.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No chat messages
              </p>
            ) : (
              <div className="space-y-1">
                {chatMessages.map((msg) => (
                  <div key={msg.id} className="rounded px-2 py-1 text-lg">
                    <span className="text-sm text-muted-foreground mr-2">
                      {formatTime(msg.createdAt)}
                    </span>
                    <span className="font-bold text-zinc-300">
                      {msg.displayName || msg.username}
                    </span>
                    <span className="text-zinc-100 ml-2">{msg.content}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
