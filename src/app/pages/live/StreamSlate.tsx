type StreamStatus = "connecting" | "live" | "waiting" | "ended" | "error";

interface StreamSlateProps {
  streamStatus: StreamStatus;
  streamStale: boolean;
  auctionTitle: string;
  orgName: string;
  slateImageUrl: string | null;
  onRetry?: () => void;
  onUnmute?: () => void;
  muted?: boolean;
}

type SlateKind = "paused" | "connecting" | "waiting" | "ended" | "error" | "unmute";

function resolveSlate(props: StreamSlateProps): SlateKind | null {
  if (props.streamStale && props.streamStatus === "live") return "paused";
  if (props.streamStatus === "connecting") return "connecting";
  if (props.streamStatus === "waiting") return "waiting";
  if (props.streamStatus === "ended") return "ended";
  if (props.streamStatus === "error") return "error";
  if (props.muted && props.streamStatus === "live") return "unmute";
  return null;
}

export function StreamSlate(props: StreamSlateProps) {
  const kind = resolveSlate(props);
  if (!kind) return null;

  const { auctionTitle, orgName, slateImageUrl, onRetry, onUnmute } = props;

  // Unmute is a clickable overlay, not a full slate
  if (kind === "unmute") {
    return (
      <button
        type="button"
        onClick={onUnmute}
        className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 cursor-pointer"
        aria-label="Tap to hear audio"
      >
        <span className="text-white text-lg font-semibold">
          Tap to hear audio
        </span>
      </button>
    );
  }

  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/80">
      {slateImageUrl && (
        <img
          src={slateImageUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover opacity-30"
        />
      )}

      <div className="relative z-10 flex flex-col items-center gap-4 px-6 text-center">
        <p className="text-lg text-zinc-400 font-medium">{orgName}</p>

        {kind === "connecting" && (
          <>
            <div
              className="h-10 w-10 rounded-full border-4 border-white/30 border-t-white animate-spin"
              role="status"
              aria-label="Connecting to stream"
            />
            <p className="text-white text-lg font-medium">
              Connecting to stream...
            </p>
          </>
        )}

        {kind === "waiting" && (
          <>
            <h2 className="text-2xl font-bold text-white">{auctionTitle}</h2>
            <p className="text-white text-lg font-medium">
              Stream starting soon
            </p>
          </>
        )}

        {kind === "paused" && (
          <p className="text-white text-lg font-medium">
            Stream paused — the host will be right back
          </p>
        )}

        {kind === "ended" && (
          <p className="text-white text-lg font-semibold">
            Auction has ended
          </p>
        )}

        {kind === "error" && (
          <>
            <p className="text-white text-lg font-medium">
              Something went wrong. Try refreshing.
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="h-12 min-w-12 px-6 rounded-lg bg-white text-black text-lg font-semibold cursor-pointer hover:bg-zinc-200 transition-colors"
              >
                Retry
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
