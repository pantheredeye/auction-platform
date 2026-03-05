# Live Experience — Implementation Scope

> Concrete build plan. Each chunk is independently deployable.
> Estimated in relative size (S/M/L), not time.

---

## Prerequisites

- [ ] **Merge PR #2** — `chunk-3-live-auction-core` → `main`
- [ ] **Create branch** — `live-experience` from main

---

## Chunk 1: Infrastructure (foundation for everything else)

### 1A. Chat Persistence via Queue — S

**What:** DO broadcasts chat but never writes to D1. Add queue-based persistence.

**Files:**
- `wrangler.jsonc` — add `CHAT_QUEUE` producer/consumer bindings
- `src/auction/durableObject.ts` — in `handleChat()`, push to chat buffer + flush (same pattern as bid buffer)
- `src/queue/chat-events.ts` — new consumer, writes to `chat_messages` table
- `src/worker.tsx` — wire consumer in `queue()` handler

**Schema:** `chat_messages` table already exists with all needed columns.

### 1B. Guest Identity System — S

**What:** Cookie-based guest identity. No account required. Just a name.

**Files:**
- `src/app/lib/guest.ts` — new. `getOrCreateGuestId(request): { guestId, guestName }` reads/sets cookie. Returns `guest-{nanoid}` if no cookie.
- `src/worker.tsx` — in session middleware, populate `ctx.guest` alongside `ctx.user`
- `src/auction/types.ts` — extend `SocketAttachment` to accept `isGuest: boolean`

**How WebSocket works for guests:**
- Current WS upgrade requires `ctx.user` (returns 401 if missing)
- Change: if no `ctx.user`, check for guest cookie → allow connection with guest identity
- Guest gets `X-User-Id: guest-{id}`, `X-Username: {their chosen name}`, `X-Is-Admin: false`
- Everything downstream (chat, bids) works unchanged — userId is just a string

### 1C. Stream Recording — M

**What:** Record WHIP sessions. Store reference in D1. Playback later.

**Approach:** Cloudflare Calls doesn't have built-in recording. Two options:
1. **MediaRecorder on auctioneer client** — record locally, upload to R2 on end
2. **Server-side recording via Cloudflare Stream** — requires separate Stream Live Input (not Calls SFU)

**Recommended: Option 1 for MVP.** Simpler, no new infra. Auctioneer's browser records the stream locally via MediaRecorder API, uploads chunks to R2 on completion or periodically.

**Files:**
- `src/app/pages/admin/auctions/AuctioneerConsole.tsx` — add MediaRecorder to camera capture flow
- `src/lib/stream/recording.ts` — new. `uploadRecording(auctionId, blob)` → R2
- `src/worker.tsx` — add `POST /api/recordings/:auctionId` route for upload
- `src/db/index.ts` — no schema change needed; store recording key in `auctions.streamUrl` or add `recordingKey` column

**D1 migration:**
```sql
ALTER TABLE auctions ADD COLUMN recording_key TEXT;
ALTER TABLE auctions ADD COLUMN recording_status TEXT DEFAULT 'none';
-- recording_status: 'none' | 'recording' | 'uploading' | 'ready' | 'failed'
```

---

## Chunk 2: Live Viewer Page — L

The core customer experience. One page. One URL.

### 2A. LiveLayout — S

**What:** Minimal shell. No sidebar, no nav. Stream-focused.

**Files:**
- `src/layouts/LiveLayout.tsx` — new RSC layout. Just renders `<Document>` wrapper + children. No nav, no sidebar.
- `src/layouts/LiveLayoutClient.tsx` — new. Minimal: dark bg, full viewport, slot for content.

**Design:**
- Dark background (`bg-black` or `bg-zinc-950`)
- No header, no footer, no sidebar
- Full viewport height (`min-h-dvh`)
- Content fills available space

### 2B. `/live/:slug` Route + Server Page — S

**What:** Anonymous entry point. Load auction data, render viewer.

**Files:**
- `src/app/pages/live/LivePage.tsx` — new RSC. Looks up auction by slug, passes data to client.
- `src/app/pages/live/server-functions/live.ts` — new. `getAuctionBySlug(slug)` — public, no auth check.
- `src/worker.tsx` — add route: `route("/live/:slug", [LivePage])` inside `layout(LiveLayout, [...])`

**No auth interruptor.** This route is open to everyone.

### 2C. LiveViewerClient — L (the big one)

**What:** The full viewer experience. Stream + chat + guest name prompt.

**File:** `src/app/pages/live/LiveViewerClient.tsx` — new. ~400-500 LOC.

**Sections:**

#### Stream Player
- WHEP playback (reuse logic from existing `AuctionRoomClient`)
- Muted by default (browser requirement)
- **"Tap to hear audio" overlay** — full-screen tap target, 18px+ text, high contrast
- Auto-play video, just muted

#### Status Bar
- 🔴 LIVE indicator (or "Ended" / "Starting soon")
- Viewer count
- Small, sits between video and chat

#### Chat Panel
- Scrolling message list
- Bids highlighted with ★ prefix + distinct background
- Auto-scroll, pause on manual scroll, "↓ New messages" button
- **18px font, high contrast (white on dark)**

#### Guest Name Prompt
- Triggered on first tap of chat input (not before)
- Single field: "What's your name?"
- One button: "Join Chat"
- Sets cookie via server action, reconnects WS with name
- **48px input height, large button, no tiny UI**

#### Chat Input + Bid Button
- Text input for messages
- "$" button next to input → opens bid amount input
- Bid confirmation: "Bid $55? [Yes] [No]" — large buttons, can't accidentally confirm
- Or: detect numeric-only input as bid intent

#### Post-Auction Prompt
- When auction status → "closed", show overlay
- "Thanks for joining! Want a heads-up next time?"
- Phone number input (optional)
- [Notify Me] [Skip] — both large, clear
- Dismissable, non-blocking

**Layout (mobile):**
```
┌──────────────────────────┐
│     VIDEO (flex-1)       │  ← fills available space
├──────────────────────────┤
│ 🔴 LIVE · 47 watching   │  ← fixed height status bar
├──────────────────────────┤
│ chat messages...         │  ← scrollable, ~35% of viewport
│ ★ BID $50 — Mary        │
├──────────────────────────┤
│ [Message...        ] [$] │  ← fixed bottom input
└──────────────────────────┘
```

**Layout (desktop, md+):**
```
┌─────────────────────┬────────────────┐
│                     │ 🔴 LIVE · 47   │
│     VIDEO           ├────────────────┤
│     (70%)           │ chat messages  │
│                     │                │
│                     ├────────────────┤
│                     │ [Msg...] [$]   │
└─────────────────────┴────────────────┘
```

**Accessibility (baked in, not bolted on):**
- `font-size: 18px` base (Tailwind: `text-lg` as minimum)
- Touch targets: `h-12 min-w-12` (48px) on all interactive elements
- No icons without text labels
- `prefers-reduced-motion` respected (no bouncing/sliding)
- High contrast: `text-white` on dark, `text-zinc-950` on light backgrounds
- `font-medium` (500) minimum on all text, `font-semibold` on important
- Auto-rotate works (no orientation lock)
- No timeouts on prompts
- Visible focus rings for keyboard nav
- Chat input: `text-lg h-12` with clear border

---

## Chunk 3: Auctioneer Enhancements — M

### 3A. GO LIVE Button Enhancement — S

**What:** Make the go-live flow more prominent and simpler.

**File:** `src/app/pages/admin/auctions/AuctioneerConsole.tsx` — modify existing.

**Changes:**
- Before stream starts: big centered "GO LIVE" button (full-width, red, impossible to miss)
- On click: existing WHIP flow + start MediaRecorder for recording
- Hide lot management UI until stream is active (or collapse it)
- Show camera preview before going live

### 3B. Share Link Flow — S

**What:** Easy way to share the `/live/:slug` URL.

**File:** `src/app/pages/admin/auctions/AuctioneerConsole.tsx` — add share controls.

**Features:**
- Copy link button (copies `https://{domain}/live/{slug}`)
- QR code generation (use a small lib or canvas-based)
- Native share button on mobile (`navigator.share()` with fallback)
- Show when stream is live or preparing

### 3C. End Stream + Recording Upload — S

**What:** Clean stream end, upload recording.

**File:** `src/app/pages/admin/auctions/AuctioneerConsole.tsx` — modify existing.

**Flow:**
1. "End Stream" button
2. Stop MediaRecorder → get final blob
3. Upload to R2 via `POST /api/recordings/:auctionId`
4. Update auction `recording_status` → "ready"
5. Show confirmation: "Stream ended. Recording saved."

---

## Chunk 4: Recording Playback + Chat Replay — S

### 4A. Recording Playback Page — S

**Files:**
- `src/app/pages/admin/auctions/RecordingPage.tsx` — new RSC
- `src/app/pages/admin/auctions/RecordingClient.tsx` — new client component
- `src/worker.tsx` — add route `/admin/auctions/:id/recording`

**Features:**
- Video player (R2 URL → `<video>` element)
- Chat replay alongside (load from `chat_messages`, display in time order)
- Basic playback controls (play/pause, seek, speed)

---

## Build Order & Dependencies

```
Chunk 1A (chat queue)     ─┐
Chunk 1B (guest identity) ─┼─→ Chunk 2 (live viewer page)
Chunk 1C (recording)      ─┘         │
                                      ├─→ Chunk 4 (playback)
Chunk 3 (auctioneer enhancements) ───┘
```

**Chunks 1A, 1B, 1C are independent** — can build in parallel.
**Chunk 2 depends on 1A + 1B** — needs guest system + chat persistence.
**Chunk 3 is independent** — can build anytime.
**Chunk 4 depends on 1A + 1C** — needs chat data + recordings.

### Suggested sequence (serial):
1. Merge PR #2
2. Chunk 1B (guest identity) — unblocks the key UX
3. Chunk 1A (chat persistence) — quick win, needed for review
4. Chunk 2A + 2B (layout + route) — skeleton
5. Chunk 2C (live viewer) — the main event
6. Chunk 1C (recording) — auctioneer-side
7. Chunk 3 (auctioneer enhancements)
8. Chunk 4 (playback)

---

## Files Summary

| Action | Path |
|--------|------|
| **New** | `src/layouts/LiveLayout.tsx` |
| **New** | `src/layouts/LiveLayoutClient.tsx` |
| **New** | `src/app/pages/live/LivePage.tsx` |
| **New** | `src/app/pages/live/LiveViewerClient.tsx` |
| **New** | `src/app/pages/live/server-functions/live.ts` |
| **New** | `src/app/lib/guest.ts` |
| **New** | `src/queue/chat-events.ts` |
| **New** | `src/lib/stream/recording.ts` |
| **New** | `src/app/pages/admin/auctions/RecordingPage.tsx` |
| **New** | `src/app/pages/admin/auctions/RecordingClient.tsx` |
| **Modify** | `src/worker.tsx` (routes, WS guest support, queue consumer, recording upload) |
| **Modify** | `src/auction/durableObject.ts` (chat buffer + flush) |
| **Modify** | `src/auction/types.ts` (guest socket attachment) |
| **Modify** | `src/app/pages/admin/auctions/AuctioneerConsole.tsx` (GO LIVE, share, recording) |
| **Modify** | `wrangler.jsonc` (chat queue bindings) |
| **Migration** | `recording_key` + `recording_status` columns on `auctions` |

---

## Not In Scope (future)

- Lot management in live viewer (no pre-listing needed)
- Payment flow (waiting on Stan's input)
- SMS/notification sending (infrastructure only, no actual sends)
- VAD / AI transcription (research phase)
- QR registration at pickup (post-launch)
- Soft registration timing configuration (hardcode for now)
