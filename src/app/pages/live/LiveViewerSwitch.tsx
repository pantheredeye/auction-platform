"use client";

import { lazy, Suspense, useMemo } from "react";
import type { LiveViewerClientProps } from "./LiveViewerClient";

const STORAGE_KEY = "live-view-mode";

const LazyLiveViewerClient = lazy(() =>
  import("./LiveViewerClient").then((m) => ({ default: m.LiveViewerClient }))
);
const LazyLiveViewerOverlayClient = lazy(() =>
  import("./LiveViewerOverlayClient").then((m) => ({ default: m.LiveViewerOverlayClient }))
);

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center w-full h-dvh bg-black">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-white" />
    </div>
  );
}

interface LiveViewerSwitchProps extends LiveViewerClientProps {
  viewMode: string | null;
}

export function LiveViewerSwitch({ viewMode: serverViewMode, ...props }: LiveViewerSwitchProps) {
  const resolvedMode = useMemo(() => {
    if (serverViewMode === "overlay" || serverViewMode === "split") {
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, serverViewMode);
      }
      return serverViewMode;
    }
    // No server param — check localStorage
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "overlay" || stored === "split") return stored;
    }
    return "split";
  }, [serverViewMode]);

  return (
    <Suspense fallback={<LoadingFallback />}>
      {resolvedMode === "overlay" ? (
        <LazyLiveViewerOverlayClient {...props} />
      ) : (
        <LazyLiveViewerClient {...props} />
      )}
    </Suspense>
  );
}
