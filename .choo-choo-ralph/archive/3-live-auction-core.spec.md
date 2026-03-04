---
title: "Live Auction Core"
created: 2026-02-26
poured:
  - auction-platform-mol-788
  - auction-platform-mol-atk
  - auction-platform-mol-10x
  - auction-platform-mol-y07
  - auction-platform-mol-25c
  - auction-platform-mol-72n
  - auction-platform-mol-8hh
  - auction-platform-mol-522
  - auction-platform-mol-vp7
  - auction-platform-mol-iav
  - auction-platform-mol-9q9
  - auction-platform-mol-67k
  - auction-platform-mol-96g
  - auction-platform-mol-fu3
  - auction-platform-mol-fqo
  - auction-platform-mol-qfp
  - auction-platform-mol-cwx
  - auction-platform-mol-5mp
  - auction-platform-mol-7c8
  - auction-platform-mol-5u1
  - auction-platform-mol-0pj
  - auction-platform-mol-x9v
  - auction-platform-mol-dfp
  - auction-platform-mol-ao8
  - auction-platform-mol-uf9
iteration: 1
auto_discovery: false
auto_learnings: false
---
<project_specification>
<project_name>Live Auction Core</project_name>

  <overview>
    Real-time auction system: WebSocket bidding engine via Durable Object, auctioneer console,
    customer auction room, "Go Live Now" fast path, Cloudflare Stream integration, and bid
    event persistence via Queues. Replaces current multi-step admin flow with a Zoom-like
    live experience while keeping existing pre-planned auction workflow intact.
  </overview>

  <context>
    <existing_patterns>
      - RSC pattern: `FooPage.tsx` (server, fetches data) → `FooClient.tsx` ("use client", receives props)
      - Server functions: `"use server"`, access `requestInfo.ctx` for org/user, use module-level `db` (Kysely)
      - Queue handlers: own Kysely instance from `env.DB` (not module-level), `message.ack()`/`message.retry()`
      - Optimistic concurrency: all mutable tables have `version INTEGER`, WHERE version=N, bump version+1
      - Audit logging: `logAudit("entity", id, "action", changes)` after every mutation
      - UI: shadcn/radix components under `@/app/components/ui/` (button, card, badge, dialog, sheet, tabs, dropdown-menu, sonner toast, etc.)
      - Navigation: `window.location.href = "..."` after mutations (not client-side routing)
      - Admin dropdown: `DropdownMenuContent` with Edit/Lots/Clone/transitions/Delete per auction row
      - DO already registered: `AUCTION_ROOM` binding, `new_sqlite_classes: ["AuctionRoomDO"]`, stub returns 200
    </existing_patterns>
    <integration_points>
      - `src/auction/types.ts` — ClientMessage, ServerMessage, AdminMessage already defined; add AuctionRoomState, LotState, BufferedBidEvent
      - `src/auction/state-machine.ts` — `canTransitionLot()`, `assertLotTransition()` for lot status validation
      - `src/auction/increments.ts` — `resolveIncrement()`, `validateBidAmount()` for bid validation
      - `src/auction/durableObject.ts` — stub AuctionRoomDO extends DurableObject, full rewrite needed
      - `src/worker.tsx` — middleware chain (headers → R2 → session → render), queue handler switch on body.type
      - `src/app/pages/admin/auctions/AdminAuctionsClient.tsx` — add Go Live button + Control Room link
      - `src/app/headers.ts` — CSP: already has frame-src for cloudflarestream.com, needs connect-src for WS + media-src for camera
      - D1 tables: auctions (slug, status, streamProviderId, streamUrl), lots (currentBidCents, currentBidderId, bidCount, status, version), bid_events (idempotencyKey UNIQUE, sequence), chat_messages, auction_summaries (viewerCount, activeLotNumber, totalBids, totalRevenueCents), stream_providers (providerType, config), orders
      - Queue pattern: `wrangler.jsonc` producers[] + consumers[], handler in worker.tsx queue() export
    </integration_points>
    <new_technologies>
      - CF Durable Objects WebSocket Hibernation: `ctx.acceptWebSocket(ws, tags)`, `ws.serializeAttachment()`, handlers `webSocketMessage/Close/Error`, `ctx.getWebSockets(tag?)` for broadcast, `ctx.storage.setAlarm()` for timers, `setWebSocketAutoResponse()` for ping/pong
      - Gotcha: `webSocketClose()` must call `ws.close(code, reason)` to complete handshake
      - Gotcha: constructor runs on every wake-from-hibernation — restore state from `ctx.getWebSockets()`
      - Gotcha: max 2048 bytes per attachment, max 10 tags per socket
      - CF Stream WHIP/WHEP: POST `/accounts/{id}/stream/live_inputs` → returns `webRTC.url` (WHIP publish, secret) + `webRTCPlayback.url` (WHEP play, public)
      - WHIP client: `@eyevinn/whip-web-client` or ~50 lines SDP negotiation
      - WHEP client: `@eyevinn/webrtc-player` or native RTCPeerConnection
      - WHIP URL is secret (grants publish access); WHEP URL uses input uid only (safe for viewers)
      - CF Queues: `env.QUEUE.send(body)`, `env.QUEUE.sendBatch([...])`, consumer gets `MessageBatch`, per-message `ack()`/`retry({delaySeconds})`, `message.attempts` starts at 1
    </new_technologies>
    <conventions>
      - File naming: PascalCase for components, kebab-case or camelCase for server-functions/
      - Server function files: `src/app/pages/.../server-functions/name.ts`
      - Route params via `RequestInfo`: `{ ctx, params }` destructured in RSC
      - DO access: `env.AUCTION_ROOM.idFromName(auctionId)` → `.get(id)` → `.fetch(request)`
      - Queue consumer: create own Kysely from env.DB, not module-level db
      - Lucide icons imported at top of client components
    </conventions>
  </context>

  <tasks>
    <task id="infra-types" priority="0" category="infrastructure">
      <title>Queue binding and type additions</title>
      <description>
        Add BID_EVENTS_QUEUE producer + consumer to wrangler.jsonc (both prod and staging).
        Extend src/auction/types.ts with AuctionRoomState, LotState, BufferedBidEvent interfaces
        and quick_add_lot admin message type. Run npx wrangler types to regenerate.
      </description>
      <steps>
        - wrangler.jsonc: add BID_EVENTS_QUEUE in queues.producers[] (binding: "BID_EVENTS_QUEUE", queue: "auction-bid-events")
        - wrangler.jsonc: add consumer entry for "auction-bid-events" (max_batch_size: 50, max_batch_timeout: 5, max_retries: 5)
        - Mirror in staging env block
        - Create the queue: npx wrangler queues create auction-bid-events
        - src/auction/types.ts: add AuctionRoomState interface (auctionId, organizationId, status, lots: Map of LotState, currentLotId, viewerCount, connectedUsers)
        - src/auction/types.ts: add LotState interface (id, lotNumber, title, description, imageUrl, startingPriceCents, currentBidCents, currentBidderId, currentBidderName, bidCount, incrementCents, status, sequence)
        - src/auction/types.ts: add BufferedBidEvent interface (auctionId, lotId, userId, type, amountCents, previousHighCents, previousHighUserId, onBehalfOfName, placedByUserId, idempotencyKey, sequence, createdAt)
        - src/auction/types.ts: add quick_add_lot to AdminMessage union (type: "quick_add_lot", title: string, startingPriceCents: number)
        - Run npx wrangler types
      </steps>
      <test_steps>
        1. npx wrangler types completes without errors
        2. TypeScript compiles with new types (npx tsc --noEmit)
        3. Queue exists: npx wrangler queues list shows auction-bid-events
      </test_steps>
      <review></review>
    </task>

    <task id="do-rewrite" priority="0" category="functional">
      <title>AuctionRoomDO full rewrite — WebSocket Hibernation bidding engine</title>
      <description>
        Rewrite src/auction/durableObject.ts from stub to complete WebSocket Hibernation API
        Durable Object implementing: WS upgrade with user metadata, bid engine, lot state machine
        with alarm-based countdown, anti-snipe, floor bids, quick-add lot, chat, viewer count,
        and buffered event flushing to BID_EVENTS_QUEUE.
      </description>
      <steps>
        - Constructor: extend DurableObject, store ctx/env, init empty AuctionRoomState
        - fetch(): handle HTTP routes:
          - POST /init — load auction + lots from D1, populate AuctionRoomState, return OK
          - POST /add-lot — create lot in D1, add to state, broadcast lot_update
          - GET with Upgrade:websocket — accept WS, attach {userId, username, isAdmin} via serializeAttachment, tag with "room:{auctionId}" and "admin" if applicable, broadcast viewer_count, send current state snapshot
        - webSocketMessage(): parse JSON, route by type:
          - ClientMessage "bid": validate lot is active/going_once/going_twice, validate amount via validateBidAmount()+resolveIncrement(), check idempotencyKey Set, update LotState (currentBidCents, currentBidderId, currentBidderName, bidCount++, sequence++), buffer event, broadcast bid_accepted to sender + lot_update to all, anti-snipe: if lot in going_once/going_twice reset to active + cancel alarm
          - ClientMessage "chat": rate limit (Map of userId→lastChatMs, 2s minimum), broadcast chat_message to all
          - ClientMessage "ping": handled by setWebSocketAutoResponse
          - AdminMessage "advance_lot": set current lot to passed/sold if done, activate next pending lot, broadcast lot_update + auction_update
          - AdminMessage "going_once": transition lot active→going_once via canTransitionLot(), set alarm 5s, broadcast lot_update
          - AdminMessage "going_twice": transition going_once→going_twice, set alarm 5s, broadcast lot_update
          - AdminMessage "sold": transition →sold, record winner, flush buffer, broadcast lot_update
          - AdminMessage "pass": transition →passed, flush buffer, broadcast lot_update
          - AdminMessage "withdraw": transition →withdrawn, flush buffer, broadcast lot_update
          - AdminMessage "floor_bid": like bid but with onBehalfOfName + placedByUserId, broadcast with "(floor)" label
          - AdminMessage "quick_add_lot": insert lot to D1, add to state.lots, optionally activate, broadcast lot_update + auction_update
          - AdminMessage "start_auction" / "close_auction": update auction status in D1, broadcast auction_update
        - webSocketClose(): call ws.close(code, reason), decrement viewerCount, broadcast viewer_count
        - webSocketError(): remove socket, decrement viewerCount
        - alarm(): check current lot status — going_once→going_twice (set 5s alarm), going_twice→sold (record winner, flush buffer), broadcast lot_update
        - Anti-snipe logic: any bid during going_once/going_twice → reset lot to active, cancel alarm via ctx.storage.deleteAlarm()
        - Buffer: array of BufferedBidEvent, flush to env.BID_EVENTS_QUEUE.sendBatch() every 10 events or on lot close (sold/passed)
        - Chat rate limit: Map<userId, lastTimestamp>, reject if < 2000ms since last
        - setWebSocketAutoResponse for ping/pong in constructor
        - Helper: broadcast(msg, tag?) — JSON.stringify + iterate ctx.getWebSockets(tag)
        - Helper: sendToSocket(ws, msg) — try/catch send, close on error
        - State recovery on hibernation wake: constructor rebuilds connectedUsers from ctx.getWebSockets(), restore state from ctx.storage (persist critical state with storage.put/get)
      </steps>
      <test_steps>
        1. Deploy, POST /init to DO with auction ID — returns 200, state populated
        2. Connect WebSocket to DO — receive state snapshot + viewer_count=1
        3. Send bid message — receive bid_accepted, lot_update with new price
        4. Send bid with wrong amount — receive bid_rejected
        5. Send duplicate idempotencyKey — receive bid_rejected
        6. Admin sends going_once — lot transitions, 5s later auto-advances to going_twice
        7. Bid during going_once — lot resets to active (anti-snipe)
        8. Admin sends sold — lot closes, winner recorded
        9. Admin sends quick_add_lot — new lot appears in state
        10. Send chat — broadcast to all, rate limit blocks rapid messages
        11. Second WS connects — viewer_count=2 broadcast
        12. Disconnect WS — viewer_count decrements
      </test_steps>
      <review></review>
    </task>

    <task id="ws-route" priority="0" category="infrastructure">
      <title>WebSocket route middleware in worker.tsx</title>
      <description>
        Add middleware before render() in worker.tsx that intercepts /ws/auction/:id requests
        with Upgrade:websocket header. Load session from cookie (already in middleware chain),
        build attachment, forward to AuctionRoomDO.
      </description>
      <steps>
        - In worker.tsx, after session middleware but before render(): check if request URL matches /ws/auction/:id AND has Upgrade:websocket header
        - Extract auction ID from URL path
        - Require authenticated session (ctx.user must exist), return 401 if not
        - Determine isAdmin from ctx.membership role (super_admin, admin, or auctioneer)
        - Build request with headers: X-User-Id, X-Username, X-Is-Admin
        - Forward to env.AUCTION_ROOM.get(env.AUCTION_ROOM.idFromName(auctionId)).fetch(request)
        - Return the DO's response (contains WebSocket pair)
        - Add /admin/auctions/:id/auctioneer route → AuctioneerPage (requireEmployee)
        - Add /auctions/:slug/live route → AuctionRoomPage (requireAuth)
        - Add /auctions route → AuctionsListPage (requireAuth, replace Placeholder)
        - Queue consumer wiring handled in bid-queue-consumer task
      </steps>
      <test_steps>
        1. Unauthenticated WS upgrade to /ws/auction/123 → 401
        2. Authenticated WS upgrade → 101 switching protocols, connection established
        3. /admin/auctions/:id/auctioneer renders auctioneer page for employees
        4. /auctions/:slug/live renders auction room for authenticated users
        5. /auctions shows auction list
      </test_steps>
      <review></review>
    </task>

    <task id="go-live" priority="1" category="functional">
      <title>"Go Live Now" fast path — server function and button</title>
      <description>
        Create quickGoLive() server function that creates an auction with smart defaults and
        immediately sets it live. Add prominent "Go Live Now" button to AdminAuctionsClient.tsx
        and "Control Room" dropdown link for live auctions.
      </description>
      <steps>
        - Create src/app/pages/admin/auctions/server-functions/go-live.ts
        - quickGoLive(): "use server", creates auction with: title="Live Auction - {formatted datetime}", type=live_consumer, defaultIncrementCents=100, status=live, actualStartAt=now, slug=auto-generated, auctioneerId=current user
        - After D1 insert: POST to AuctionRoomDO /init endpoint to initialize room state
        - Return { auctionId } for redirect
        - AdminAuctionsClient.tsx: add "Go Live Now" button (prominent, red/primary, with Radio icon) next to "New Auction" button in header area
        - On click: call quickGoLive(), redirect to /admin/auctions/{id}/auctioneer
        - Add "Control Room" DropdownMenuItem for auctions with status === "live": links to /admin/auctions/{id}/auctioneer, uses Radio icon
        - Add isPending/useTransition for loading state on Go Live button
      </steps>
      <test_steps>
        1. Click "Go Live Now" → auction created with smart defaults, status=live
        2. Redirected to /admin/auctions/:id/auctioneer
        3. Auction appears in list with "live" badge
        4. Live auction's dropdown shows "Control Room" link
        5. Control Room link navigates to auctioneer console
        6. Non-live auctions don't show Control Room link
      </test_steps>
      <review></review>
    </task>

    <task id="auctioneer-console" priority="1" category="functional">
      <title>Auctioneer console — RSC page and client component</title>
      <description>
        Build the auctioneer's live control panel at /admin/auctions/:id/auctioneer.
        RSC fetches auction + lots, client component manages WebSocket connection and
        provides controls for running the auction.
      </description>
      <steps>
        - Create src/app/pages/admin/auctions/AuctioneerPage.tsx (RSC):
          - Fetch auction by ID (with org scoping), 404 if not found
          - Fetch lots for auction
          - Render AuctioneerConsole with auction, lots, wsUrl props
        - Create src/app/pages/admin/auctions/AuctioneerConsole.tsx ("use client"):
          - WebSocket connection to /ws/auction/{id} with reconnect logic
          - Layout: header (auction title, live indicator, viewer count) + main grid
          - Current lot card: image, title, current bid (large), bid count, bidder name, lot status badge
          - Bid feed: scrolling list of recent bids (amount, bidder, timestamp), floor bids show "(floor)" label
          - Controls panel:
            - "Going Once" button (when lot is active) → sends going_once AdminMessage
            - "Going Twice" button (when going_once) → sends going_twice
            - "Sold!" button (any countdown state) → sends sold
            - "Pass" button → sends pass
            - "Next Item" button → sends advance_lot
            - "Withdraw" button → sends withdraw (removes lot from auction)
            - Visual countdown indicator for going_once/going_twice states
          - Quick-add form: title input + starting price input + "Add & Go" button → sends quick_add_lot, auto-activates (bare lot — no product/lot_items association, just title + price)
          - Floor bid form: amount input + bidder name input + "Place Floor Bid" button → sends floor_bid
          - Lot queue sidebar: list of upcoming lots (pending status), current lot highlighted
          - Stream preview section: placeholder for camera feed (getUserMedia integration in stream task)
          - Connection status indicator (connected/reconnecting/disconnected)
          - Toast notifications for bid_accepted, errors
        - Handle all ServerMessage types: bid_accepted, bid_rejected, lot_update, auction_update, chat_message, viewer_count, error
        - lot_update: update current lot card, bid feed, lot queue
        - auction_update: update header status
      </steps>
      <test_steps>
        1. Navigate to /admin/auctions/:id/auctioneer — page loads with auction data
        2. WebSocket connects, viewer count shows
        3. Click "Going Once" → lot transitions, countdown visible
        4. Click "Sold!" → lot closes, winner displayed
        5. Quick-add "Blue Towels" + "$5" → new lot created and active
        6. Floor bid "$10" for "Phone Bidder" → bid appears in feed with "(floor)" label
        7. Click "Next Item" → advances to next pending lot
        8. Disconnect/reconnect → connection recovers, state syncs
      </test_steps>
      <review></review>
    </task>

    <task id="customer-room" priority="1" category="functional">
      <title>Customer auction room and auctions list page</title>
      <description>
        Build the customer-facing live auction view at /auctions/:slug/live (mobile-first
        bidding interface) and /auctions listing page replacing the Placeholder.
      </description>
      <steps>
        - Create src/app/pages/auctions/server-functions/browsing.ts:
          - listLiveAuctions(): query auctions with status in (live, scheduled, preview) joined with auction_summaries for viewer count
          - getAuctionBySlug(slug): fetch auction + active lot + upcoming lots
        - Create src/app/pages/auctions/AuctionsListPage.tsx (RSC):
          - Fetch live/upcoming auctions via listLiveAuctions()
          - Render cards: title, status badge, viewer count, thumbnail, "Join" button linking to /auctions/{slug}/live
          - Empty state: "No live auctions right now"
        - Create src/app/pages/auctions/AuctionRoomPage.tsx (RSC):
          - Fetch auction by slug, 404 if not found
          - Fetch current user for WS auth
          - Render AuctionRoomClient with auction data + wsUrl
        - Create src/app/pages/auctions/AuctionRoomClient.tsx ("use client"):
          - WebSocket connection to /ws/auction/{id}
          - Mobile-first layout (top to bottom):
            - Stream area (top ~40%): placeholder for video player (stream task adds WHEP)
            - Current lot card: image, title, description, current bid (large prominent), bid count, status
            - Going once / going twice / sold overlays (animated, full-width banners)
            - Sticky bottom bid bar: "Bid ${nextValidAmount}" button (full width, large tap target)
          - One-tap bid: button shows next valid amount (currentBid + increment), tap sends bid ClientMessage with generated idempotencyKey (crypto.randomUUID())
          - Bid button states: enabled (can bid), disabled (you're high bidder / lot not active), loading (bid in flight)
          - Outbid toast: when lot_update shows different currentBidderId and user was previous high bidder → sonner toast "You've been outbid!"
          - Chat panel: collapsible sheet/drawer from bottom, message list + input, sends chat ClientMessage
          - Upcoming lots: horizontal scroll preview of next lots (thumbnail + title + starting price)
          - Handle all ServerMessage types
          - Connection status indicator
          - Viewer count display
        - Desktop layout: side-by-side (stream left, lot+bid right, chat in sidebar)
      </steps>
      <test_steps>
        1. /auctions shows list of live/upcoming auctions with viewer counts
        2. Click "Join" → navigates to /auctions/:slug/live
        3. Auction room loads with current lot, stream placeholder, bid button
        4. Tap bid button → bid sent, price updates, button shows new next amount
        5. Another user bids → lot_update received, price updates, outbid toast if applicable
        6. Going once/twice/sold overlays animate on lot transitions
        7. Chat: open panel, send message, see it broadcast
        8. Mobile layout: stream on top, lot card middle, sticky bid bar bottom
        9. When lot not active (pending/sold/passed) → bid button disabled
        10. Viewer count updates on connect/disconnect
      </test_steps>
      <review></review>
    </task>

    <task id="stream-integration" priority="2" category="functional">
      <title>Cloudflare Stream WHIP/WHEP integration</title>
      <description>
        Integrate Cloudflare Stream for live video: API client for live input management,
        WHIP push from auctioneer browser, WHEP playback in customer room, CSP updates.
      </description>
      <steps>
        - Create src/lib/stream/cloudflare-stream.ts:
          - createLiveInput(name): POST to CF Stream API → returns { uid, whipUrl, whepUrl }
          - getLiveInput(uid): GET status + URLs
          - deleteLiveInput(uid): DELETE cleanup
          - Uses env.CF_STREAM_API_TOKEN + env.CF_STREAM_ACCOUNT_ID
        - Add secrets to wrangler.jsonc as vars (or use wrangler secret put for tokens)
        - Update go-live.ts quickGoLive(): after auction creation, call createLiveInput(), store uid in stream_providers table, link to auction via streamProviderId, save whipUrl
        - Update AuctioneerConsole.tsx:
          - Camera preview: getUserMedia({ video: true, audio: true }) → local video element
          - Start stream button: fetch WHIP URL from server, create WHIPClient (or manual SDP: create RTCPeerConnection, createOffer, POST to WHIP URL with SDP, setRemoteDescription from response)
          - Stop stream button: close RTCPeerConnection
          - Stream status indicator (not started / connecting / live / error)
        - Update AuctionRoomClient.tsx:
          - Video player area: create RTCPeerConnection, fetch WHEP URL, POST SDP offer to WHEP URL, play remote stream in video element
          - Fallback: if WebRTC fails, show "Stream unavailable" message
          - Auto-play handling: muted autoplay, tap to unmute
        - Update src/app/headers.ts CSP:
          - Add connect-src: 'self' wss: https://customer-*.cloudflarestream.com
          - Add media-src: 'self' https://customer-*.cloudflarestream.com blob:
          - Ensure frame-src already includes https://customer-*.cloudflarestream.com (it does)
        - Add Permissions-Policy: camera=self, microphone=self (auctioneer pages only, or globally)
      </steps>
      <test_steps>
        1. Go Live Now → stream_providers record created, WHIP URL stored
        2. Auctioneer console: camera preview shows local video
        3. Click "Start Stream" → WHIP connection established, status shows "Live"
        4. Customer room: WHEP connection established, video plays with sub-second latency
        5. Stop stream → RTCPeerConnection closed, status updated
        6. CSP headers allow Stream domains without console errors
        7. Camera permission prompt appears correctly
      </test_steps>
      <review></review>
    </task>

    <task id="bid-queue-consumer" priority="1" category="infrastructure">
      <title>Bid events queue consumer for D1 persistence</title>
      <description>
        Queue consumer that batch-inserts buffered bid events from BID_EVENTS_QUEUE into D1,
        updates lots denormalized fields, and updates auction_summaries.
      </description>
      <steps>
        - Create src/queue/bid-events.ts:
          - processBidEvents(messages: BufferedBidEvent[], env): create own Kysely from env.DB
          - Batch insert into bid_events table (id=crypto.randomUUID(), map BufferedBidEvent fields to columns)
          - For each unique lotId in batch: UPDATE lots SET currentBidCents, currentBidderId, bidCount, version=version+1 WHERE id=lotId (use latest bid in batch for that lot)
          - For each unique auctionId: UPDATE auction_summaries SET totalBids=totalBids+count, totalRevenueCents where applicable
          - Handle idempotencyKey conflicts gracefully (INSERT OR IGNORE or catch unique constraint)
          - Log errors, message.retry() on failure with exponential backoff
        - Wire into worker.tsx queue() handler:
          - Check body.type === "bid-events" (or structure of batch — queue sends arrays via sendBatch)
          - Call processBidEvents, ack on success, retry on error
        - Handle the "lot close" flush: when DO flushes on sold/passed, the batch includes all remaining buffered events + a synthetic "lot_closed" marker that triggers final lot UPDATE (winnerUserId, winnerAmountCents, status)
      </steps>
      <test_steps>
        1. Place bids via WS → buffer fills → events appear in bid_events table
        2. Lot closes → remaining events flushed, lot record updated with winner
        3. auction_summaries totalBids incremented correctly
        4. Duplicate idempotencyKey → no error, event skipped
        5. Consumer error → message retried with backoff
        6. Multiple lots in same batch → each lot's denormalized fields updated independently
      </test_steps>
      <review></review>
    </task>
  </tasks>

  <success_criteria>
    - Admin clicks "Go Live Now" → auction created, redirected to auctioneer console
    - Auctioneer quick-adds "Blue Towels" + "$5" → lot created, broadcast to viewers
    - Customer opens /auctions/:slug/live → sees stream + current lot + bid button
    - Customer taps bid → DO validates, broadcasts, both screens update in real-time
    - Auctioneer clicks "Sold!" → lot closes, winner recorded, next item flow
    - Floor bid from auctioneer → bid feed shows "(floor)" label
    - Pre-planned auctions still work: existing form → lots → transition → console
    - Bid events persisted to D1 via queue consumer
    - Stream: auctioneer pushes camera via WHIP, customers watch via WHEP
  </success_criteria>

</project_specification>
