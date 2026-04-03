/**
 * MediaRecorder wrapper for recording live auction streams.
 * Handles codec negotiation (WebM preferred, MP4/AVC1 fallback for Safari).
 * Uploads chunks to R2 via POST endpoint as they are recorded.
 * On tab close, uses sendBeacon to fire-and-forget remaining data.
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
  recBitrate = 5_000_000,
): RecordingHandle {
  const mimeType = negotiateCodec();
  let chunkIndex = 0;
  const failedChunks: number[] = [];

  const options: MediaRecorderOptions = { videoBitsPerSecond: recBitrate };
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

  // beforeunload: beacon remaining data as fire-and-forget partial save
  const handleBeforeUnload = () => {
    if (recorder.state === "inactive") return;

    // Swap ondataavailable to use sendBeacon instead of fetch
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        const idx = chunkIndex++;
        const url = `/api/recordings/${encodeURIComponent(auctionId)}/chunk?chunkIndex=${idx}`;
        navigator.sendBeacon(url, e.data);
      }
    };

    // requestData() triggers ondataavailable synchronously with buffered data
    try {
      recorder.requestData();
    } catch {
      // May throw if recorder is in unexpected state
    }

    try {
      recorder.stop();
    } catch {
      // May already be stopped
    }

    // Mark recording as uploading (incomplete/partial)
    navigator.sendBeacon(
      `/api/recordings/${encodeURIComponent(auctionId)}/status`,
      new Blob([JSON.stringify({ status: "uploading" })], {
        type: "application/json",
      }),
    );
  };

  window.addEventListener("beforeunload", handleBeforeUnload);

  const stop = (): Promise<void> => {
    // Clean up beforeunload handler on normal stop
    window.removeEventListener("beforeunload", handleBeforeUnload);

    return new Promise<void>((resolve) => {
      if (recorder.state === "inactive") {
        resolve();
        return;
      }
      recorder.onstop = async () => {
        // Wait for all uploads with 15s timeout to avoid hanging forever
        const timeout = new Promise<void>((r) => setTimeout(r, 15_000));
        await Promise.race([Promise.all(pendingUploads), timeout]);
        resolve();
      };
      // Triggers one last ondataavailable before onstop
      recorder.stop();
    });
  };

  return { stop, chunkCount: () => chunkIndex, failedChunks: () => [...failedChunks] };
}
