"use server";

import { requestInfo } from "rwsdk/worker";

const GUEST_NAME_COOKIE = "guest_name";
const THIRTY_DAYS = 30 * 24 * 60 * 60;

export async function setGuestName(name: string): Promise<boolean> {
  const { response } = requestInfo;

  const trimmed = name.trim().slice(0, 50);
  if (!trimmed) {
    return false;
  }

  const setCookieHeader = [
    `${GUEST_NAME_COOKIE}=${encodeURIComponent(trimmed)}`,
    `Max-Age=${THIRTY_DAYS}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
  ].join("; ");

  response.headers.append("Set-Cookie", setCookieHeader);

  return true;
}
