/**
 * MediaRecorder wrapper for recording live auction streams.
 * Handles codec negotiation (WebM preferred, MP4/AVC1 fallback for Safari).
 * Uploads chunks to R2 via POST endpoint as they are recorded.
 */

export interface RecordingHandle {
  stop: () => Promise<void>;
  /** Number of chunks uploaded so far */
  chunkCount: () => number;
  /** Indices of chunks that failed to upload */
  failedChunks: () => number[];
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
  failedChunks: number[],
): Promise<void> {
  try {
    const resp = await fetch(
      `/api/recordings/${encodeURIComponent(auctionId)}/chunk?chunkIndex=${chunkIndex}`,
      {
        method: "POST",
        headers: {
          "Content-Type": blob.type || "video/webm",
        },
        body: blob,
      },
    );
    if (!resp.ok) {
      console.error(`Chunk ${chunkIndex} upload failed: ${resp.status}`);
      failedChunks.push(chunkIndex);
    }
  } catch (err) {
    console.error(`Chunk ${chunkIndex} upload error:`, err);
    failedChunks.push(chunkIndex);
  }
}

export function startRecording(
  stream: MediaStream,
  auctionId: string,
): RecordingHandle {
  const mimeType = negotiateCodec();
  let chunkIndex = 0;
  const failedChunks: number[] = [];

  const options: MediaRecorderOptions = { videoBitsPerSecond: 2_500_000 };
  if (mimeType) {
    options.mimeType = mimeType;
  }

  const recorder = new MediaRecorder(stream, options);

  // Track in-flight uploads so stop() can wait for them
  const pendingUploads: Promise<void>[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      const blob = new Blob([e.data], { type: e.data.type || mimeType });
      const idx = chunkIndex++;
      const p = uploadChunk(auctionId, idx, blob, failedChunks);
      pendingUploads.push(p);
    }
  };

  recorder.start(TIMESLICE_MS);

  const stop = (): Promise<void> => {
    return new Promise<void>((resolve) => {
      if (recorder.state === "inactive") {
        resolve();
        return;
      }
      recorder.onstop = async () => {
        // Wait for all uploads (including the final chunk) to complete
        await Promise.all(pendingUploads);
        resolve();
      };
      // Triggers one last ondataavailable before onstop
      recorder.stop();
    });
  };

  return { stop, chunkCount: () => chunkIndex, failedChunks: () => [...failedChunks] };
}
