/**
 * MediaRecorder wrapper for recording live auction streams.
 * Handles codec negotiation (WebM preferred, MP4/AVC1 fallback for Safari).
 * Uploads chunks to R2 via POST endpoint as they are recorded.
 */

export interface RecordingHandle {
  stop: () => Promise<void>;
  /** Number of chunks uploaded so far */
  chunkCount: () => number;
}

const TIMESLICE_MS = 30_000;

function negotiateCodec(): string {
  // Prefer WebM with VP8+Opus (broad support)
  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")) {
    return "video/webm;codecs=vp8,opus";
  }
  // Safari fallback: MP4 with AVC1
  if (MediaRecorder.isTypeSupported("video/mp4;codecs=avc1")) {
    return "video/mp4;codecs=avc1";
  }
  // Last resort: let browser pick
  return "";
}

async function uploadChunk(
  auctionId: string,
  chunkIndex: number,
  blob: Blob,
): Promise<void> {
  const resp = await fetch(
    `/api/recordings/${encodeURIComponent(auctionId)}/chunk`,
    {
      method: "POST",
      headers: {
        "Content-Type": blob.type || "video/webm",
        "X-Chunk-Index": String(chunkIndex),
      },
      body: blob,
    },
  );
  if (!resp.ok) {
    console.error(`Chunk ${chunkIndex} upload failed: ${resp.status}`);
  }
}

export function startRecording(
  stream: MediaStream,
  auctionId: string,
): RecordingHandle {
  const mimeType = negotiateCodec();
  let chunkIndex = 0;

  const options: MediaRecorderOptions = { videoBitsPerSecond: 2_500_000 };
  if (mimeType) {
    options.mimeType = mimeType;
  }

  const recorder = new MediaRecorder(stream, options);

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      const blob = new Blob([e.data], { type: e.data.type || mimeType });
      const idx = chunkIndex++;
      uploadChunk(auctionId, idx, blob);
    }
  };

  recorder.start(TIMESLICE_MS);

  const stop = (): Promise<void> => {
    return new Promise<void>((resolve) => {
      if (recorder.state === "inactive") {
        resolve();
        return;
      }
      recorder.onstop = () => resolve();
      recorder.stop();
    });
  };

  return { stop, chunkCount: () => chunkIndex };
}
