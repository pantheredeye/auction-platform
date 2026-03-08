"use client";

interface RecordingClientProps {
  recordingUrl: string;
  auction: { id: string; title: string };
}

export function RecordingClient({ recordingUrl, auction }: RecordingClientProps) {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-muted-foreground">Recording player loading…</p>
    </div>
  );
}
