import { nanoid } from "nanoid";

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

export function getOrCreateGuestId(request: Request): GuestInfo {
  const cookies = parseCookies(request);
  const existingId = cookies[GUEST_ID_COOKIE];
  const guestName = cookies[GUEST_NAME_COOKIE] || null;

  if (existingId) {
    return { guestId: existingId, guestName, setCookieHeader: null };
  }

  const guestId = nanoid();
  const setCookieHeader = [
    `${GUEST_ID_COOKIE}=${guestId}`,
    `Max-Age=${THIRTY_DAYS}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
  ].join("; ");

  return { guestId, guestName, setCookieHeader };
}
