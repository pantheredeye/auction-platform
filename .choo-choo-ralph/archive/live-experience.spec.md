---
title: "Live Experience"
created: 2026-03-05
poured:
  - auction-platform-mol-o00
  - auction-platform-mol-v4q
  - auction-platform-mol-vg8
  - auction-platform-mol-8td
  - auction-platform-mol-aky
  - auction-platform-mol-wt1
  - auction-platform-mol-z2c
  - auction-platform-mol-ckl
  - auction-platform-mol-v1bz
  - auction-platform-mol-gsha
  - auction-platform-mol-3ucb
  - auction-platform-mol-mcqc
  - auction-platform-mol-9260
  - auction-platform-mol-qc4z
  - auction-platform-mol-ovyj
  - auction-platform-mol-10k1
  - auction-platform-mol-z8la
  - auction-platform-mol-o5v8
  - auction-platform-mol-y4nd
  - auction-platform-mol-wzkm
  - auction-platform-mol-mul7
  - auction-platform-mol-9fgy
  - auction-platform-mol-uuy2
  - auction-platform-mol-hpc4
  - auction-platform-mol-6c22
  - auction-platform-mol-5ak4
  - auction-platform-mol-qkza
  - auction-platform-mol-silh
  - auction-platform-mol-nhez
  - auction-platform-mol-zvtx
  - auction-platform-mol-r4px
  - auction-platform-mol-pfqi
  - auction-platform-mol-ct66
  - auction-platform-mol-sezq
  - auction-platform-mol-atu2
  - auction-platform-mol-1hqt
  - auction-platform-mol-4mv6
  - auction-platform-mol-vqgo
  - auction-platform-mol-f6wl
  - auction-platform-mol-1wom
  - auction-platform-mol-qqaf
  - auction-platform-mol-7mas
  - auction-platform-mol-0x3i
  - auction-platform-mol-d5wk
  - auction-platform-mol-yxga
  - auction-platform-mol-nj88
  - auction-platform-mol-tgpp
  - auction-platform-mol-b9b5
  - auction-platform-mol-phte
  - auction-platform-mol-jty0
  - auction-platform-mol-7zsq
  - auction-platform-mol-f47n
  - auction-platform-mol-154i
  - auction-platform-mol-3as1
  - auction-platform-mol-gp6b
  - auction-platform-mol-hsw4
  - auction-platform-mol-2isu
  - auction-platform-mol-iamg
  - auction-platform-mol-44mk
  - auction-platform-mol-8bre
  - auction-platform-mol-lfq2
  - auction-platform-mol-yjwb
  - auction-platform-mol-1amh
  - auction-platform-mol-5sez
  - auction-platform-mol-icwp
  - auction-platform-mol-5dsq
  - auction-platform-mol-xfvx
  - auction-platform-mol-xzcs
  - auction-platform-mol-ygv6
  - auction-platform-mol-ccar
  - auction-platform-mol-bp1c
  - auction-platform-mol-0qer
  - auction-platform-mol-orpp
  - auction-platform-mol-k0nb
  - auction-platform-mol-lrxp
  - auction-platform-mol-95pj
iteration: 1
auto_discovery: false
auto_learnings: false
---
<project_specification>
<project_name>Live Experience</project_name>

  <overview>
    Build a separate, customer-facing live auction viewing experience at /live/:slug.
    Anonymous entry (no auth wall), stream-focused, mobile-first.
    Audience: 20-85 year old southern Americans, varying tech literacy, coming from Facebook Live/Zoom auctions.
    Auctioneer experience: simplified GO LIVE flow, stream recording, share link.
    Two app surfaces: existing admin/management stays untouched, new /live/* routes are purpose-built.
    See DESIGN.md for full accessibility constraints (18px font, 48px touch targets, no icons without labels).
    See SCOPE.md for full implementation scope and dependency graph.
  </overview>

  <context>
    <existing_patterns>
      - WHEP playback: RTCPeerConnection with recvonly transceivers, SDP offer/answer via POST /play/:id, reconnect with exponential backoff (AuctionRoomClient.tsx:903-1064)
      - WebSocket: ws/wss URL, JSON messages, 30s ping keepalive, exponential backoff reconnect up to 10s (AuctionRoomClient.tsx:234-293)
      - Queue buffer: DO buffers events in memory array, flushes at threshold (10) or on state transitions, sendBatch to queue (durableObject.ts:1160-1170)
      - Queue consumer: processBidEvent in src/queue/bid-events.ts, Kysely insert with idempotency key via onConflict doNothing
      - Auth headers on WS: worker.tsx middleware injects X-User-Id, X-Username, X-Is-Admin before forwarding to DO
      - Layout pattern: RSC wrapper loads auth/data, passes to client component. Layout wraps route groups.
      - Server functions: "use server" directive, access requestInfo.ctx, called from client via useTransition()
      - R2 upload: env.IMAGES.put(key, body, { httpMetadata }) in src/lib/r2.ts, served at /images/* route
      - Share: navigator.share() with clipboard.writeText() fallback (AuctionRoomClient.tsx:374-393)
      - Route registration: render(Document, [...prefix("/x", layout(Layout, [route("/y", [interceptor, Page])]))])
    </existing_patterns>
    <integration_points>
      - src/worker.tsx — add /live/* routes, guest WS upgrade path, recording upload endpoint, chat queue consumer, CSP media-src + connect-src for /live/* routes
      - src/auction/durableObject.ts — add chat buffer + flush (mirror bid buffer pattern), viewer count tracking, state-on-connect message
      - src/auction/types.ts — extend SocketAttachment with isGuest field
      - wrangler.jsonc — add CHAT_EVENTS_QUEUE producer/consumer bindings
      - src/db/index.ts — chat_messages table already exists; add recording_key + recording_status to auctions, add unique constraint on auction slug
      - src/lib/r2.ts — reuse uploadImage for recording blobs
      - src/app/components/ui/* — reuse all shadcn primitives
      - AuctionRoomDO — existing DO handles both admin and viewer WebSocket, no changes to bid/lot logic needed
      - LiveStore DO — existing, provides getTracks() for WHEP playback
    </integration_points>
    <new_technologies>
      - MediaRecorder API: browser-native recording of MediaStream. Use webm/vp8+opus codec with mp4/avc1 fallback for Safari. Captures from getUserMedia stream already active in auctioneer console. ondataavailable with timeslice for periodic chunked upload. No new server-side tech. All CF Workers + D1 + R2 + Queues (existing stack).
    </new_technologies>
    <conventions>
      - Page files: PageName.tsx (RSC) + PageNameClient.tsx (client component)
      - Server functions in server-functions/ subdir with "use server" directive
      - Client components: "use client" at top
      - Shadcn imports from @/app/components/ui/
      - cn() for class merging (src/app/lib/utils.ts)
      - formatCents() for money display (src/lib/money.ts)
      - Tailwind 4, dark theme colors in Document.tsx
    </conventions>
  </context>

  <tasks>
    <task id="chat-persistence" priority="1" category="infrastructure">
      <title>Chat Persistence via Queue</title>
      <description>
        Chat messages are broadcast by the DO but never written to D1. Add queue-based persistence
        mirroring the existing bid buffer pattern. The chat_messages table already exists in the schema.
        DO also keeps a ring buffer of last 50 messages in memory for new-client history.
      </description>
      <steps>
        - Add CHAT_EVENTS_QUEUE producer/consumer bindings to wrangler.jsonc (and staging env)
        - Define BufferedChatEvent type in src/auction/types.ts (auctionId, userId, username, content, createdAt, id)
        - Add chatBuffer array to AuctionRoomDO, flush at threshold (10), on auction close, or via alarm every 30s
        - Set DO alarm for periodic flush (30s interval) to prevent message loss if DO hibernates or worker crashes
        - In handleChat(), after broadcast, push event to chatBuffer
        - Keep ring buffer of last 50 messages in DO memory (separate from flush buffer)
        - On new WS connect, send buffered messages as `chat_history` message (array of recent messages)
        - Create src/queue/chat-events.ts consumer: processChatEvent inserts into chat_messages with onConflict(id).doNothing()
        - Wire consumer in worker.tsx queue() handler for "auction-chat-events" queue prefix
      </steps>
      <test_steps>
        1. Start a live auction, send chat messages via WebSocket
        2. Query D1 chat_messages table — verify messages persisted
        3. Send 10+ messages rapidly — verify buffer flushes at threshold
        4. Close auction — verify remaining buffer flushed
        5. Send duplicate message ID — verify idempotent (no duplicate rows)
        6. Wait 30s with messages in buffer — verify alarm-based flush fires
        7. Connect a new client mid-auction — verify receives chat_history with recent messages
      </test_steps>
      <review></review>
    </task>

    <task id="guest-identity" priority="1" category="infrastructure">
      <title>Guest Identity System</title>
      <description>
        Cookie-based guest identity for anonymous viewers. No account required. Guest gets a stable
        ID (cookie) and optional display name. Allows WS connection + chat + bidding without auth.
        Before name is set, guest appears as "Guest" in WS headers. Chat input disabled until name provided.
      </description>
      <steps>
        - Create src/app/lib/guest.ts: getOrCreateGuestId(request) → { guestId: string, guestName: string | null }
        - Uses a simple cookie ("guest_id") with nanoid value, 30-day expiry
        - Guest name stored in separate cookie ("guest_name"), set when user provides name
        - In worker.tsx session middleware: if no ctx.user, populate ctx.guest from cookies
        - Extend DefaultAppContext with guest: { id: string; name: string | null } | null
        - Modify WS upgrade handler: if no ctx.user but ctx.guest exists, allow connection
        - Set X-User-Id to guest.id, X-Username to guest.name or "Guest", X-Is-Admin to "false"
        - Add isGuest boolean to SocketAttachment in types.ts
        - Create server function setGuestName(name: string) that sets the guest_name cookie
      </steps>
      <test_steps>
        1. Visit /live/:slug without logging in — verify guest_id cookie is set
        2. Connect to WebSocket as guest — verify connection succeeds (no 401)
        3. Send chat message as guest — verify broadcast includes guest username
        4. Set guest name via prompt — verify cookie updated, subsequent messages use new name
        5. Revisit page — verify same guest_id cookie (stable identity)
        6. Verify logged-in users still use their real user identity (guest path not triggered)
      </test_steps>
      <review></review>
    </task>

    <task id="db-migration-recording" priority="1" category="infrastructure">
      <title>DB Migration: Recording Columns + Slug Constraint</title>
      <description>
        Add recording_key and recording_status columns to the auctions table for stream recording support.
        Add unique constraint on slug column. Auto-generate slug on auction creation.
      </description>
      <steps>
        - Create D1 migration: ALTER TABLE auctions ADD COLUMN recording_key TEXT
        - ALTER TABLE auctions ADD COLUMN recording_status TEXT DEFAULT 'none'
        - recording_status enum: 'none' | 'recording' | 'uploading' | 'ready' | 'failed'
        - Add unique constraint on slug column (CREATE UNIQUE INDEX IF NOT EXISTS idx_auctions_slug ON auctions(slug))
        - Auto-generate unique slug on auction creation: slugified title + random 6-char suffix (nanoid)
        - Manual slug editing deferred to future iteration
        - Update AuctionsTable type in src/db/index.ts with new columns
        - Run migration against dev/staging/prod D1 databases
      </steps>
      <test_steps>
        1. Run migration — verify no errors
        2. Query existing auction rows — verify new columns default to NULL/none
        3. Update an auction's recording_status — verify write succeeds
        4. Create auction — verify slug is auto-generated and unique
        5. Attempt duplicate slug insert — verify unique constraint rejects it
      </test_steps>
      <review></review>
    </task>

    <task id="stream-recording" priority="2" category="functional">
      <title>Stream Recording (MediaRecorder + R2 Chunked Upload)</title>
      <description>
        Record the auctioneer's stream via MediaRecorder API on their browser.
        Upload chunks periodically to R2 (every 30-60s). Store reference in D1 auctions table.
        Handles tab close / network drop gracefully (partial recording preserved).
        Depends on: db-migration-recording.
      </description>
      <steps>
        - Create src/lib/stream/recording.ts: startRecording(stream: MediaStream) → { stop: () => Promise&lt;void&gt; }
        - Codec negotiation: try `video/webm;codecs=vp8,opus` first, fall back to `video/mp4;codecs=avc1` for Safari via MediaRecorder.isTypeSupported()
        - Use MediaRecorder with `timeslice` param (30000ms) for periodic ondataavailable chunks
        - On each ondataavailable: upload chunk to R2 at `recordings/{auctionId}/{timestamp}-{chunkIndex}.webm`
        - Add POST /api/recordings/:auctionId/chunk route in worker.tsx (requireEmployee auth)
        - On stream end: upload final chunk, update auctions row: recording_status = 'ready'
        - In AuctioneerConsole: start MediaRecorder when WHIP stream starts
        - On "End Stream": stop recorder, upload final chunk, show "Recording saved" toast
        - Handle upload failure gracefully: set recording_status = 'failed', show error toast
        - On tab close (beforeunload): attempt to upload any remaining data via sendBeacon or navigator.sendBeacon
      </steps>
      <test_steps>
        1. Start stream in auctioneer console — verify MediaRecorder initializes (no errors)
        2. Stream for 60+ seconds — verify chunks uploaded to R2 periodically
        3. Verify R2 objects exist at expected keys (recordings/{auctionId}/{timestamp}-{chunkIndex})
        4. End stream — verify final chunk uploaded, recording_status = 'ready'
        5. Download recording chunks from R2 — verify playable video with audio
        6. Test on Safari — verify fallback codec works
        7. Simulate tab close mid-stream — verify partial recording preserved in R2
      </test_steps>
      <review></review>
    </task>

    <task id="live-layout" priority="1" category="functional">
      <title>LiveLayout Shell</title>
      <description>
        Minimal layout for /live/* routes. No sidebar, no nav, no header. Dark background.
        Stream-focused, full viewport. Follows DESIGN.md constraints.
      </description>
      <steps>
        - Create src/layouts/LiveLayout.tsx (RSC): passes guest context to client
        - Create src/layouts/LiveLayoutClient.tsx (client): dark bg, min-h-dvh, flex column, renders children
        - No navigation elements. No sidebar. No header bar.
        - Background: bg-zinc-950 or bg-black
        - Toaster component included for notifications
      </steps>
      <test_steps>
        1. Render layout — verify full viewport dark background, no nav/sidebar
        2. Inspect DOM — verify no extraneous elements, just content wrapper
        3. Check mobile and desktop — verify fills viewport in both
      </test_steps>
      <review></review>
    </task>

    <task id="live-route" priority="1" category="functional">
      <title>/live/:slug Route + Server Page</title>
      <description>
        Anonymous entry point. Look up auction by slug, render live viewer.
        No auth interruptor. Depends on: live-layout, guest-identity.
        Includes CSP headers for media and WebSocket on /live/* routes.
      </description>
      <steps>
        - Create src/app/pages/live/LivePage.tsx (RSC): lookup auction by slug from D1, return 404 if not found
        - Create src/app/pages/live/server-functions/live.ts: getAuctionBySlug(slug) — public, no auth check
        - If auction not found or not live/scheduled: show "Auction not found" or "Coming soon" state
        - Pass auction data + guest context to LiveViewerClient
        - Register route in worker.tsx: route("/live/:slug", [LivePage]) inside layout(LiveLayout, [...])
        - Ensure no auth interruptor on this route
        - Add CSP headers for /live/* routes: media-src for WHEP playback, connect-src for WebSocket connections
      </steps>
      <test_steps>
        1. Visit /live/valid-slug — verify page loads without login
        2. Visit /live/nonexistent — verify 404 or "not found" message
        3. Visit /live/valid-slug while logged in — verify works (uses real identity, not guest)
        4. Check page source — verify auction data passed to client component
        5. Inspect response headers — verify CSP includes media-src and connect-src directives
      </test_steps>
      <review></review>
    </task>

    <task id="live-viewer-stream" priority="1" category="functional">
      <title>Live Viewer: Stream Player + Unmute + Error State</title>
      <description>
        WHEP video player for /live/:slug. Full-width video, muted autoplay,
        large "Tap to hear audio" overlay. Depends on: live-route.
        Core of the viewing experience. Includes explicit error state UI.
      </description>
      <steps>
        - Create src/app/pages/live/LiveViewerClient.tsx with WHEP player section
        - Reuse WHEP connection pattern from AuctionRoomClient (RTCPeerConnection, recvonly transceivers, SDP handshake)
        - Video element: muted autoplay, playsInline, object-fit cover
        - Unmute overlay: full-screen tap target, "Tap to hear audio" in 18px+ text, high contrast white on semi-transparent dark
        - On tap: video.muted = false, hide overlay
        - Stream status states: connecting, live, waiting (not started yet), ended, error
        - "Waiting" state: show "Stream starting soon..." with auction title
        - "Ended" state: show "Auction has ended" message
        - "Error" state: show "Something went wrong. Try refreshing." with a "Retry" button (plain language per DESIGN.md)
        - Reconnect on disconnect with exponential backoff (reuse pattern)
        - Video fills top portion of viewport (flex-1 on mobile)
        - On WS connect, read initial state message from DO to set correct UI state (live/waiting/ended)
      </steps>
      <test_steps>
        1. Visit /live/:slug while stream is active — verify video plays (muted)
        2. Tap unmute overlay — verify audio plays, overlay disappears
        3. Visit before stream starts — verify "starting soon" state
        4. Disconnect network briefly — verify auto-reconnect
        5. Simulate stream error — verify error state with "Try refreshing" message and Retry button
        6. Check mobile — verify video fills available space
        7. Check desktop — verify video fills left portion (70% width)
        8. Connect mid-auction — verify initial state message sets correct UI (live/waiting/ended)
      </test_steps>
      <review></review>
    </task>

    <task id="live-viewer-chat" priority="1" category="functional" depends_on="chat-persistence">
      <title>Live Viewer: Chat Display + Input</title>
      <description>
        Chat panel with scrolling messages, bid highlighting, and text input.
        Integrates with WebSocket. Depends on: live-viewer-stream, guest-identity, chat-persistence.
        DO tracks viewer count and broadcasts on connect/disconnect.
        Desktop layout: video 70% / chat 30%.
      </description>
      <steps>
        - Add WebSocket connection to LiveViewerClient (reuse pattern, connect to /ws/auction/:id)
        - Guest WS: connects using guest identity (no auth required per guest-identity task)
        - On WS connect, DO sends current state message: auction status, current lot, current bid, viewer count
        - DO tracks connected socket count, broadcasts `viewer_count` message on connect/disconnect
        - Client displays viewer count in status bar from WS messages
        - Chat message list: scrollable, auto-scroll, pause on manual scroll-up
        - "↓ New messages" button when scrolled up and new messages arrive
        - Messages: 18px font, white on dark, username bold, timestamp subtle
        - Bid messages: highlighted with ★ prefix, distinct background (amber/gold tint), font-semibold
        - Chat input: h-12 text-lg, visible border
        - Before name is set: chat input disabled with placeholder "Enter your name to chat"
        - Tapping disabled chat input triggers guest name prompt
        - If guest has name: input is active, placeholder "Type a message...", sends chat message on Enter
        - Mobile: chat panel below video, ~35-40% of viewport, scrollable independently
        - Desktop (md+): video 70% width, chat panel 30% width, flex column to the right
        - Status bar between video and chat: "LIVE · {count} watching" or status text
      </steps>
      <test_steps>
        1. Connect as guest — verify WebSocket connects, viewer count updates
        2. Verify initial state message received (auction status, current bid, viewer count)
        3. Connect second client — verify viewer count increments for both
        4. Disconnect client — verify viewer count decrements
        5. Send chat message — verify appears in chat for all viewers
        6. Without name set — verify chat input is disabled with "Enter your name to chat" placeholder
        7. Tap disabled input — verify name prompt triggers
        8. Scroll up in chat — verify auto-scroll pauses, "new messages" button appears
        9. Tap "new messages" — verify scrolls to bottom, auto-scroll resumes
        10. Verify bid messages have ★ prefix and highlight
        11. Check 18px font size on all chat text
        12. Check mobile layout — chat below video, scrollable
        13. Check desktop layout — video 70%, chat 30% beside video
      </test_steps>
      <review></review>
    </task>

    <task id="live-viewer-guest-prompt" priority="1" category="functional">
      <title>Live Viewer: Guest Name Prompt</title>
      <description>
        When anonymous viewer first tries to chat or bid, prompt for first name.
        Name is mandatory for chat and bidding — no "Just watch" bypass for those actions.
        Viewers can still watch the stream without providing a name.
        Depends on: live-viewer-chat, guest-identity.
      </description>
      <steps>
        - Trigger: user taps disabled chat input or bid button and has no guest_name cookie
        - Show inline card (not modal, not blocking video): "What's your name?"
        - Single input field: h-12 text-lg, placeholder "Your first name"
        - Single button: "Join Chat" — h-12, full width, prominent
        - On submit: await setGuestName() server function response (ensures cookie is set before next step)
        - After cookie confirmed set: close prompt, reconnect WebSocket with new name in headers
        - Race condition fix: WS reconnect must wait for setGuestName() to complete so cookie is present on WS upgrade
        - Input auto-focuses when prompt appears
        - No "Just watch" dismiss option — name is required for chat/bid participation
        - Stream continues playing during prompt (not blocked)
        - No timeout — prompt stays until user submits
      </steps>
      <test_steps>
        1. Visit as new guest — verify chat input disabled with "Enter your name to chat" placeholder
        2. Tap disabled chat input — verify name prompt appears
        3. Verify stream continues playing during prompt
        4. Enter name, tap "Join Chat" — verify prompt closes, name cookie set
        5. Verify WS reconnects only after cookie is confirmed set (no race condition)
        6. Send message — verify username shows in chat
        7. Refresh page — verify name persists (cookie), no re-prompt, chat input enabled
        8. Try to bid without name — verify name prompt appears first
      </test_steps>
      <review></review>
    </task>

    <task id="live-viewer-bid" priority="2" category="functional">
      <title>Live Viewer: Bid Button + Confirmation</title>
      <description>
        Bid entry for viewers. "$" button next to chat input opens bid amount entry.
        Confirmation before submission. Requires guest name before bidding.
        Depends on: live-viewer-chat.
      </description>
      <steps>
        - "$" button next to chat input: h-12 w-12, visible, labeled with "$" text
        - If no guest name: tapping "$" triggers guest name prompt first (same as chat)
        - On tap (with name): replace chat input with bid amount input (numeric, h-12 text-lg)
        - Show current high bid as reference: "Current: $50 — Minimum: $55"
        - On submit: show confirmation overlay "Bid $55?" with [Yes] and [No] buttons
        - Both buttons: h-12, large text, clear labels, high contrast
        - On confirm: send bid via WebSocket (type: "bid", lotId, amountCents, idempotencyKey)
        - On bid_accepted: toast "Your bid of $55 was placed!"
        - On bid_rejected: toast with rejection reason in plain language
        - "Cancel" or tap outside to return to chat input
        - If no active lot: bid button disabled with "No active item" tooltip
      </steps>
      <test_steps>
        1. Try to bid without name — verify name prompt appears first
        2. Tap "$" button (with name) — verify bid input appears with current bid reference
        3. Enter amount, submit — verify confirmation dialog with [Yes] [No]
        4. Confirm bid — verify bid_accepted toast, bid appears in chat as highlighted
        5. Submit bid below minimum — verify bid_rejected with clear reason
        6. Cancel bid — verify returns to chat input
        7. Check button sizes — verify 48px minimum on all interactive elements
        8. Test with no active lot — verify bid button disabled
      </test_steps>
      <review></review>
    </task>

    <task id="go-live-enhancement" priority="2" category="functional">
      <title>Auctioneer GO LIVE Button Enhancement</title>
      <description>
        Make the go-live flow more prominent in AuctioneerConsole. Big button, camera preview,
        simplified pre-stream state. Integrates stream-recording auto-start.
        Depends on: stream-recording.
      </description>
      <steps>
        - Before stream: show centered GO LIVE button (full-width, red bg, white text, text-xl, h-16+)
        - Camera preview: show getUserMedia preview before going live (so auctioneer can check framing)
        - On GO LIVE tap: start WHIP stream + start MediaRecorder
        - Transition to live state: camera view expands, minimal control strip below
        - Hide lot management cruft until explicitly opened (collapse panel)
        - Show viewer count prominently during stream
        - Show chat feed during stream
      </steps>
      <test_steps>
        1. Open auctioneer console — verify GO LIVE button is prominent and centered
        2. Verify camera preview shows before going live
        3. Tap GO LIVE — verify stream starts and recording begins
        4. Verify lot controls are collapsed/hidden initially
        5. Verify viewer count and chat visible during stream
      </test_steps>
      <review></review>
    </task>

    <task id="share-link" priority="2" category="functional">
      <title>Share Link Flow</title>
      <description>
        Easy way for auctioneer to share the /live/:slug URL. Copy, QR, native share.
        Shown in auctioneer console when live or preparing.
      </description>
      <steps>
        - Add share section to AuctioneerConsole (visible when auction exists)
        - Copy link button: copies https://{domain}/live/{slug} to clipboard, toast confirmation
        - QR code: generate via canvas or small library (e.g., qrcode-generator, no heavy deps)
        - Display QR inline, or in a dialog for easy phone scanning
        - Native share on mobile: navigator.share({ title, url }) with clipboard fallback
        - Share URL is the /live/:slug path (not the admin URL)
      </steps>
      <test_steps>
        1. Click copy link — verify URL in clipboard matches /live/:slug format
        2. Verify QR code renders and is scannable
        3. On mobile: verify native share sheet opens
        4. On desktop: verify clipboard fallback works
      </test_steps>
      <review></review>
    </task>

    <task id="end-stream-flow" priority="2" category="functional">
      <title>End Stream + Recording Upload</title>
      <description>
        Clean stream termination with recording upload. Confirmation before ending.
        Depends on: stream-recording, go-live-enhancement.
      </description>
      <steps>
        - "End Stream" button: visible during live state, red/destructive variant
        - Confirmation: "End the live stream?" [End Stream] [Cancel] — prevent accidental end
        - On confirm: stop WHIP stream (DELETE /ingest/:id), stop MediaRecorder
        - Show upload progress: "Saving recording..." with progress indicator
        - On upload complete: "Stream ended. Recording saved." toast
        - Show post-stream summary: duration, peak viewers (if tracked)
        - Offer: [Share Replay] (future, disabled for now) + [Copy Auction Link for Next Time]
        - Handle upload failure: "Recording failed to save" error toast, offer retry
      </steps>
      <test_steps>
        1. Tap "End Stream" — verify confirmation dialog
        2. Confirm — verify stream stops, recording uploads
        3. Verify "Recording saved" toast on success
        4. Verify auction recording_status updated in D1
        5. Cancel end stream — verify stream continues
      </test_steps>
      <review></review>
    </task>

    <task id="recording-playback" priority="3" category="functional">
      <title>Recording Playback Page</title>
      <description>
        Admin page to review recorded streams with chat replay.
        Depends on: stream-recording, chat-persistence.
      </description>
      <steps>
        - Create src/app/pages/admin/auctions/RecordingPage.tsx (RSC): load auction + recording URL
        - Create src/app/pages/admin/auctions/RecordingClient.tsx: video player + chat timeline
        - Register route: /admin/auctions/:id/recording (requireEmployee)
        - Video player: HTML5 video element with R2 URL (served via /images/* or new /recordings/* route)
        - Chat timeline: load chat_messages for auction from D1, display in time order alongside video
        - Basic controls: play/pause, seek bar, playback speed (1x, 1.5x, 2x)
        - If no recording: show "No recording available" message
        - Link to this page from admin auctions list (if recording_status = 'ready')
      </steps>
      <test_steps>
        1. Navigate to /admin/auctions/:id/recording — verify video loads
        2. Play video — verify audio and video work
        3. Verify chat messages display in chronological order
        4. Change playback speed — verify video speed changes
        5. Visit for auction with no recording — verify appropriate message
      </test_steps>
      <review></review>
    </task>
  </tasks>

  <success_criteria>
    - Anonymous user can tap a link and watch a live stream with zero registration
    - Guest can set a first name and chat/bid without creating an account
    - Chat input disabled until name provided; stream viewable without name
    - Auctioneer can go live with a single tap and share the link easily
    - All streams are recorded via chunked upload (partial recordings survive failures)
    - All chat messages persisted to D1 for review; last 50 available to new joiners
    - Viewer count tracked and displayed in real-time
    - Mobile experience is accessible for 20-85 year olds (18px font, 48px targets, plain language)
    - Desktop layout: video 70% / chat 30%
    - Error states use plain language with retry options
    - No changes to existing admin/management app surfaces
  </success_criteria>

</project_specification>
