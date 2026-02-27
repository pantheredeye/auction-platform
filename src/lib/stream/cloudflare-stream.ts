import { env } from "cloudflare:workers";

interface LiveInputResponse {
  uid: string;
  whipUrl: string;
  whepUrl: string;
}

interface StreamApiResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  result: {
    uid: string;
    webRTC?: { url: string };
    webRTCPlayback?: { url: string };
    status?: { current: string };
    meta?: Record<string, string>;
    created?: string;
    modified?: string;
  };
}

function apiBase() {
  return `https://api.cloudflare.com/client/v4/accounts/${env.CF_STREAM_ACCOUNT_ID}/stream/live_inputs`;
}

function headers() {
  return {
    Authorization: `Bearer ${env.CF_STREAM_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

export async function createLiveInput(
  name: string,
): Promise<LiveInputResponse> {
  const res = await fetch(apiBase(), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      meta: { name },
      recording: { mode: "off" },
    }),
  });

  if (!res.ok) {
    throw new Error(`Stream API createLiveInput failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as StreamApiResponse;
  if (!data.success) {
    throw new Error(`Stream API error: ${data.errors.map((e) => e.message).join(", ")}`);
  }

  return {
    uid: data.result.uid,
    whipUrl: data.result.webRTC!.url,
    whepUrl: data.result.webRTCPlayback!.url,
  };
}

export async function getLiveInput(uid: string): Promise<StreamApiResponse["result"]> {
  const res = await fetch(`${apiBase()}/${uid}`, {
    method: "GET",
    headers: headers(),
  });

  if (!res.ok) {
    throw new Error(`Stream API getLiveInput failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as StreamApiResponse;
  if (!data.success) {
    throw new Error(`Stream API error: ${data.errors.map((e) => e.message).join(", ")}`);
  }

  return data.result;
}

export async function deleteLiveInput(uid: string): Promise<void> {
  const res = await fetch(`${apiBase()}/${uid}`, {
    method: "DELETE",
    headers: headers(),
  });

  if (!res.ok) {
    throw new Error(`Stream API deleteLiveInput failed: ${res.status} ${res.statusText}`);
  }
}
