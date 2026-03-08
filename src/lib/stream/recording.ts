/**
 * MediaRecorder wrapper for recording live auction streams.
 * Handles codec negotiation (WebM preferred, MP4/AVC1 fallback for Safari).
 */

export interface RecordingHandle {
  stop: () => Promise<void>;
}

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

export function startRecording(
  stream: MediaStream,
  auctionId: string,
): RecordingHandle {
  const mimeType = negotiateCodec();
  const chunks: Blob[] = [];

  const options: MediaRecorderOptions = { videoBitsPerSecond: 2_500_000 };
  if (mimeType) {
    options.mimeType = mimeType;
  }

  const recorder = new MediaRecorder(stream, options);

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  recorder.start(5000); // 5s timeslice chunks

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

  return { stop };
}
