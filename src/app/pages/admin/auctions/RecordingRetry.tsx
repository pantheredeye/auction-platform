"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { updateRecordingStatus } from "./server-functions/auctions";

export function RecordingRetry({
  auctionId,
  auctionTitle,
  isUploading = false,
}: {
  auctionId: string;
  auctionTitle: string;
  isUploading?: boolean;
}) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    setError(false);
    try {
      const result = await updateRecordingStatus(auctionId, "ready");
      if (result.recording_status === "ready") {
        window.location.reload();
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <h1 className="text-xl font-semibold">{auctionTitle} — Recording</h1>
      <p className="text-muted-foreground">
        {isUploading
          ? "Recording is still processing."
          : "Recording couldn't be processed."}
      </p>
      {error && (
        <p className="text-sm text-destructive">
          Still unable to process. Try again in a few minutes.
        </p>
      )}
      <Button onClick={handleRetry} disabled={retrying}>
        {retrying ? "Processing..." : isUploading ? "Finish processing" : "Try again"}
      </Button>
    </div>
  );
}
