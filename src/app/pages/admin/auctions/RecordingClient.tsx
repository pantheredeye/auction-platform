"use client";

import { useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";

interface RecordingClientProps {
  recordingUrl: string;
  auction: { id: string; title: string };
}

const PLAYBACK_SPEEDS = [
  { value: "1", label: "1x" },
  { value: "1.5", label: "1.5x" },
  { value: "2", label: "2x" },
];

export function RecordingClient({ recordingUrl, auction }: RecordingClientProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [speed, setSpeed] = useState("1");

  function handleSpeedChange(value: string) {
    setSpeed(value);
    if (videoRef.current) {
      videoRef.current.playbackRate = parseFloat(value);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
      <h1 className="mb-4 text-xl font-semibold">{auction.title} — Recording</h1>

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
  );
}
