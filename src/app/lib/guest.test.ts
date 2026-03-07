import { describe, it, expect } from "vitest";
import { getOrCreateGuestId } from "./guest";

// Mirror the WS header-setting logic from worker.tsx (lines 192-205)
function buildWsHeaders(ctx: {
  user: { id: string; displayName?: string; name?: string; username: string } | null;
  guest: { id: string; name: string | null } | null;
  currentOrganization?: { role: string } | null;
}): Headers | null {
  if (!ctx.user && !ctx.guest) return null;

  const headers = new Headers();
  if (ctx.user) {
    const isAdmin =
      ctx.currentOrganization?.role === "super_admin" ||
      ctx.currentOrganization?.role === "admin" ||
      ctx.currentOrganization?.role === "auctioneer";
    headers.set("X-User-Id", ctx.user.id);
    headers.set(
      "X-Username",
      ctx.user.displayName ?? ctx.user.name ?? ctx.user.username,
    );
    headers.set("X-Is-Admin", String(isAdmin));
  } else {
    headers.set("X-User-Id", ctx.guest!.id);
    headers.set("X-Username", ctx.guest!.name || "Guest");
    headers.set("X-Is-Admin", "false");
    headers.set("X-Is-Guest", "true");
  }
  return headers;
}

// Mirror the DO SocketAttachment parsing from durableObject.ts (lines 180-194)
function parseSocketAttachment(headers: Headers) {
  return {
    userId: headers.get("X-User-Id") ?? "anonymous",
    username: headers.get("X-Username") ?? "Anonymous",
    isAdmin: headers.get("X-Is-Admin") === "true",
    isGuest: headers.get("X-Is-Guest") === "true",
  };
}

function makeRequest(url: string, cookies?: string): Request {
  const headers: Record<string, string> = {};
  if (cookies) headers["Cookie"] = cookies;
  return new Request(url, { headers });
}

describe("Guest identity flow", () => {
  describe("getOrCreateGuestId", () => {
    it("generates new guest_id when no cookie present", () => {
      const req = makeRequest("https://example.com/live/test-auction");
      const guest = getOrCreateGuestId(req);

      expect(guest.guestId).toBeTruthy();
      expect(guest.guestName).toBeNull();
      expect(guest.setCookieHeader).toContain("guest_id=");
      expect(guest.setCookieHeader).toContain("Max-Age=2592000");
      expect(guest.setCookieHeader).toContain("HttpOnly");
      expect(guest.setCookieHeader).toContain("SameSite=Lax");
    });

    it("returns existing guest_id from cookie", () => {
      const req = makeRequest(
        "https://example.com/live/test-auction",
        "guest_id=existing-123",
      );
      const guest = getOrCreateGuestId(req);

      expect(guest.guestId).toBe("existing-123");
      expect(guest.guestName).toBeNull();
      expect(guest.setCookieHeader).toBeNull(); // no new cookie
    });

    it("returns guest_name from cookie when present", () => {
      const req = makeRequest(
        "https://example.com/live/test-auction",
        "guest_id=existing-123; guest_name=Alice",
      );
      const guest = getOrCreateGuestId(req);

      expect(guest.guestId).toBe("existing-123");
      expect(guest.guestName).toBe("Alice");
      expect(guest.setCookieHeader).toBeNull();
    });

    it("decodes URL-encoded guest_name", () => {
      const req = makeRequest(
        "https://example.com/live/test-auction",
        "guest_id=g1; guest_name=Bob%20Smith",
      );
      const guest = getOrCreateGuestId(req);

      expect(guest.guestName).toBe("Bob Smith");
    });

    it("guest_id stays stable across requests (same cookie reused)", () => {
      const req1 = makeRequest(
        "https://example.com/live/test-auction",
        "guest_id=stable-id-456",
      );
      const req2 = makeRequest(
        "https://example.com/live/test-auction",
        "guest_id=stable-id-456",
      );

      expect(getOrCreateGuestId(req1).guestId).toBe("stable-id-456");
      expect(getOrCreateGuestId(req2).guestId).toBe("stable-id-456");
    });
  });

  describe("WS headers for guest (no name)", () => {
    it("sets X-Username to 'Guest' when no guest_name", () => {
      const guest = getOrCreateGuestId(
        makeRequest("https://example.com/ws/auction/a1", "guest_id=g1"),
      );
      const ctx = { user: null, guest: { id: guest.guestId, name: guest.guestName } };
      const headers = buildWsHeaders(ctx)!;

      expect(headers.get("X-User-Id")).toBe("g1");
      expect(headers.get("X-Username")).toBe("Guest");
      expect(headers.get("X-Is-Admin")).toBe("false");
      expect(headers.get("X-Is-Guest")).toBe("true");
    });
  });

  describe("WS headers for guest (with name)", () => {
    it("uses real name in X-Username after setGuestName", () => {
      // After setGuestName, guest_name cookie is set for subsequent requests
      const guest = getOrCreateGuestId(
        makeRequest(
          "https://example.com/ws/auction/a1",
          "guest_id=g1; guest_name=Alice",
        ),
      );
      const ctx = { user: null, guest: { id: guest.guestId, name: guest.guestName } };
      const headers = buildWsHeaders(ctx)!;

      expect(headers.get("X-User-Id")).toBe("g1");
      expect(headers.get("X-Username")).toBe("Alice");
      expect(headers.get("X-Is-Guest")).toBe("true");
    });
  });

  describe("WS headers for authenticated user", () => {
    it("sets user headers without X-Is-Guest", () => {
      const ctx = {
        user: { id: "user-1", displayName: "Bob", username: "bob" },
        guest: null,
        currentOrganization: { role: "viewer" },
      };
      const headers = buildWsHeaders(ctx)!;

      expect(headers.get("X-User-Id")).toBe("user-1");
      expect(headers.get("X-Username")).toBe("Bob");
      expect(headers.get("X-Is-Admin")).toBe("false");
      expect(headers.get("X-Is-Guest")).toBeNull(); // not set for auth users
    });

    it("sets X-Is-Admin for admin roles", () => {
      const ctx = {
        user: { id: "user-1", username: "admin1" },
        guest: null,
        currentOrganization: { role: "super_admin" },
      };
      const headers = buildWsHeaders(ctx)!;

      expect(headers.get("X-Is-Admin")).toBe("true");
      expect(headers.get("X-Is-Guest")).toBeNull();
    });

    it("uses fallback name chain: displayName > name > username", () => {
      // No displayName, has name
      const ctx1 = {
        user: { id: "u1", name: "Full Name", username: "uname" } as any,
        guest: null,
      };
      expect(buildWsHeaders(ctx1)!.get("X-Username")).toBe("Full Name");

      // No displayName, no name
      const ctx2 = {
        user: { id: "u1", username: "uname" } as any,
        guest: null,
      };
      expect(buildWsHeaders(ctx2)!.get("X-Username")).toBe("uname");
    });
  });

  describe("DO distinguishes guest vs authenticated", () => {
    it("parses guest attachment with isGuest=true", () => {
      const guest = getOrCreateGuestId(
        makeRequest("https://example.com/ws/auction/a1", "guest_id=g1"),
      );
      const ctx = { user: null, guest: { id: guest.guestId, name: guest.guestName } };
      const headers = buildWsHeaders(ctx)!;
      const attachment = parseSocketAttachment(headers);

      expect(attachment.isGuest).toBe(true);
      expect(attachment.isAdmin).toBe(false);
      expect(attachment.userId).toBe("g1");
      expect(attachment.username).toBe("Guest");
    });

    it("parses authenticated attachment with isGuest=false", () => {
      const ctx = {
        user: { id: "user-1", displayName: "Bob", username: "bob" },
        guest: null,
        currentOrganization: { role: "auctioneer" },
      };
      const headers = buildWsHeaders(ctx)!;
      const attachment = parseSocketAttachment(headers);

      expect(attachment.isGuest).toBe(false);
      expect(attachment.isAdmin).toBe(true);
      expect(attachment.userId).toBe("user-1");
      expect(attachment.username).toBe("Bob");
    });
  });

  describe("Unauthorized when no user and no guest", () => {
    it("returns null headers (401 path)", () => {
      const headers = buildWsHeaders({ user: null, guest: null });
      expect(headers).toBeNull();
    });
  });

  describe("Full flow: visit -> cookie -> WS -> DO", () => {
    it("traces guest lifecycle end-to-end", () => {
      // 1. First visit: no cookies, gets new guest_id
      const firstVisit = getOrCreateGuestId(
        makeRequest("https://example.com/live/test-auction"),
      );
      expect(firstVisit.setCookieHeader).toBeTruthy();
      const guestId = firstVisit.guestId;

      // 2. WS connect with no name -> "Guest"
      const wsVisit1 = getOrCreateGuestId(
        makeRequest(
          "https://example.com/ws/auction/a1",
          `guest_id=${guestId}`,
        ),
      );
      const ctx1 = {
        user: null,
        guest: { id: wsVisit1.guestId, name: wsVisit1.guestName },
      };
      const headers1 = buildWsHeaders(ctx1)!;
      const attach1 = parseSocketAttachment(headers1);
      expect(attach1.username).toBe("Guest");
      expect(attach1.isGuest).toBe(true);
      expect(attach1.userId).toBe(guestId);

      // 3. After setGuestName("Alice"), new WS connect uses real name
      const wsVisit2 = getOrCreateGuestId(
        makeRequest(
          "https://example.com/ws/auction/a1",
          `guest_id=${guestId}; guest_name=Alice`,
        ),
      );
      const ctx2 = {
        user: null,
        guest: { id: wsVisit2.guestId, name: wsVisit2.guestName },
      };
      const headers2 = buildWsHeaders(ctx2)!;
      const attach2 = parseSocketAttachment(headers2);
      expect(attach2.username).toBe("Alice");
      expect(attach2.isGuest).toBe(true);
      expect(attach2.userId).toBe(guestId); // same guest_id
    });
  });
});
