import { nanoid } from "nanoid";
import { env } from "cloudflare:workers";

const GUEST_ID_COOKIE = "guest_id";
const GUEST_NAME_COOKIE = "guest_name";
const THIRTY_DAYS = 30 * 24 * 60 * 60;

export interface GuestInfo {
  guestId: string;
  guestName: string | null;
  /** Set-Cookie header value — only present when a new guest_id was generated */
  setCookieHeader: string | null;
}

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("Cookie") || "";
  const cookies: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name) {
      cookies[name.trim()] = decodeURIComponent(rest.join("=").trim());
    }
  }
  return cookies;
}

async function hmacSign(guestId: string): Promise<string> {
  const secret = (env as any).AUTH_SECRET_KEY || "dev-secret";
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(guestId));
  // Use first 16 bytes of HMAC for compact cookie value
  return Array.from(new Uint8Array(sig).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacVerify(guestId: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(guestId);
  return expected === signature;
}

export async function getOrCreateGuestId(request: Request): Promise<GuestInfo> {
  const cookies = parseCookies(request);
  const existingValue = cookies[GUEST_ID_COOKIE];
  const guestName = cookies[GUEST_NAME_COOKIE] || null;

  if (existingValue) {
    // Parse signed format: guestId.signature
    const dotIndex = existingValue.lastIndexOf(".");
    if (dotIndex > 0) {
      const id = existingValue.slice(0, dotIndex);
      const sig = existingValue.slice(dotIndex + 1);
      if (await hmacVerify(id, sig)) {
        return { guestId: id, guestName, setCookieHeader: null };
      }
    }
    // Accept unsigned cookies for backward compat (existing guests)
    // but re-sign on next visit
    if (!existingValue.includes(".")) {
      const sig = await hmacSign(existingValue);
      const signedValue = `${existingValue}.${sig}`;
      const setCookieHeader = [
        `${GUEST_ID_COOKIE}=${signedValue}`,
        `Max-Age=${THIRTY_DAYS}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        "Secure",
      ].join("; ");
      return { guestId: existingValue, guestName, setCookieHeader };
    }
    // Invalid signed cookie — fall through to create new
  }

  const guestId = nanoid();
  const sig = await hmacSign(guestId);
  const signedValue = `${guestId}.${sig}`;
  const setCookieHeader = [
    `${GUEST_ID_COOKIE}=${signedValue}`,
    `Max-Age=${THIRTY_DAYS}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
  ].join("; ");

  return { guestId, guestName, setCookieHeader };
}
