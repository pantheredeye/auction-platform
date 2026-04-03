---
title: "A/B Test: Overlay Live Viewer"
created: 2026-03-22
poured:
  - auction-platform-mol-fqff
  - auction-platform-mol-a6c2
  - auction-platform-mol-gpc0
  - auction-platform-mol-4ljq
  - auction-platform-mol-jehk
  - auction-platform-mol-g6am
iteration: 2
auto_discovery: false
auto_learnings: false
---
<project_specification>
<project_name>A/B Test: Overlay Live Viewer</project_name>

  <overview>
    Add a Whatnot-style overlay layout as an alternative to the current split-panel live viewer.
    Beta client can test both with users via query param: `/live/:slug` (current) vs `/live/:slug?view=overlay` (new).
    View preference persists via localStorage so returning users stay on chosen layout.
    Requires extracting shared logic from the 905-line monolithic LiveViewerClient.tsx into reusable hooks,
    then building a second layout that consumes the same hooks with full-bleed video + overlaid chat/bid UI.

    Key UX improvement: currently chat is mostly used for bidding (bid messages dominate the feed).
    The overlay layout separates bidding from chat — bids are a dedicated bar at the bottom,
    chat becomes a social/conversation channel overlaid on video. This declutters both surfaces.

    Focus is streaming + chat + user registration experience, not lot management.
    No lot thumbnails or detailed lot info in this iteration.
  </overview>

  <context>
    <existing_patterns>
      - LiveViewerClient.tsx (905 lines) is a monolithic "use client" component with 13 useState, 7 useRef, 5 useEffect, 11 useCallback
      - WHEP video via RTCPeerConnection with exponential backoff reconnect (1s→10s, 15 attempts)
      - WebSocket to DO at /ws/auction/{id} with 30s ping heartbeat, auto-reconnect (max 15s backoff)
      - Server message dispatch handles: auction_update, stream_ended, viewer_count, lot_update, chat_history, chat_message, stream_paused, bid_accepted, bid_rejected, registration_required, pong
      - Nested sub-components inline: ChatPanel, ChatInput, BidInput, BidButton
      - AuctionRoomClient.tsx duplicates similar WS/WHEP/chat/bid patterns (authenticated route)
      - StreamSlate.tsx handles stream status overlays (connecting, waiting, paused, ended, error, unmute)
      - RegistrationPanel.tsx (576 lines) handles guest/registered/card-on-file tiers as slide-up overlay
    </existing_patterns>
    <integration_points>
      - LivePage.tsx server component: loads auction data, guest, registration status; renders LiveViewerClient
      - Worker routing: `prefix("/live", layout(LiveLayout, [route("/:slug", [setLiveCSP(), LivePage])]))`
      - RequestInfo provides `request` for URL/query param access (already used elsewhere in worker.tsx)
      - LiveViewerClientProps interface: { auction, guest, bidderRequirement, existingRegistration }
      - Types from @/auction/types: ServerMessage, AuctionStatus, LotStatus, ChatMessage
      - Utilities: formatCents, dollarsToCents from @/lib/money; nanoid for idempotency keys
    </integration_points>
    <new_technologies>
      - No new tech. Overlay is pure CSS/layout change using existing Tailwind utilities
      - pointer-events passthrough pattern for chat overlay (pointer-events-none container, pointer-events-auto on interactive elements)
      - CSS text-shadow for readability over variable video backgrounds
    </new_technologies>
    <conventions>
      - "use client" directive at top of client components
      - Server functions in server-functions/ subdirs with "use server"
      - DESIGN.md: 18px base font (text-lg), 48px touch targets (h-12), no icons without labels, no swipe gestures, high contrast, safe areas
      - Mobile-first Tailwind (base=mobile, md:=tablet+, lg:=desktop)
      - Dynamic viewport units (dvh) for keyboard-aware layouts
      - Safe area insets: pb-[max(0.5rem,env(safe-area-inset-bottom))]
    </conventions>
  </context>

  <tasks>
    <task id="hook-stream-status" priority="1" category="infrastructure">
      <title>Extract useStreamStatus hook</title>
      <description>
        Extract auctionStatusToStreamStatus helper + auctionStatus/viewerCount/currentLot state from LiveViewerClient into a reusable hook.
        Expose updater functions (handleAuctionUpdate, handleLotUpdate, handleViewerCount) that the WS message handler will call.
        Include the StreamStatus type, CurrentLotData interface, and formatTime helper.
      </description>
      <steps>
        - Create src/app/pages/live/hooks/useStreamStatus.ts
        - Move auctionStatusToStreamStatus function (lines 80-96)
        - Move StreamStatus type, CurrentLotData interface
        - Move formatTime helper (lines 100-106)
        - Move useState for auctionStatus, viewerCount, currentLot
        - Expose updater functions for WS message dispatch
      </steps>
      <test_steps>
        1. Hook exports StreamStatus type and CurrentLotData interface
        2. auctionStatusToStreamStatus maps all AuctionStatus values correctly
        3. handleAuctionUpdate returns correct StreamStatus for each auction state
        4. handleLotUpdate correctly tracks lot status transitions (active → going_once → sold)
        5. handleViewerCount updates viewer count state
      </test_steps>
      <review></review>
    </task>

    <task id="hook-whep" priority="1" category="infrastructure">
      <title>Extract useWhepConnection hook</title>
      <description>
        Extract WHEP RTCPeerConnection logic from LiveViewerClient (lines 478-682) into a reusable hook.
        Handles SDP offer/answer exchange via /play/{auctionId}, track events, mute/stale detection,
        and exponential backoff reconnect (1s→10s max, 15 attempts).
        Also owns the `muted` audio state + `toggleMute` handler — muted is tied to the video element
        and StreamSlate's "Tap to hear audio" overlay depends on it.
        Takes streamStatus as input to decide when to connect.
        Returns videoRef, muted, toggleMute, streamStale, cleanupWhep, setStreamStale, retry, whepConnectedRef.
      </description>
      <steps>
        - Create src/app/pages/live/hooks/useWhepConnection.ts
        - Move RTCPeerConnection setup, SDP exchange, track handling
        - Move reconnect scheduling with exponential backoff
        - Move mute/stale detection (onmute, onended handlers)
        - Move cleanupConnection logic
        - Move videoRef, pcRef, reconnectTimer, reconnectAttempt, mountedRef, whepConnectedRef refs
        - Move muted useState + toggleMute handler (controls video element muted prop)
        - Accept auctionId + streamStatus as params
        - Expose setters for WS handler to drive stream_ended/stream_paused transitions
      </steps>
      <test_steps>
        1. Hook creates RTCPeerConnection and sends SDP offer to /play/{auctionId}
        2. On successful SDP answer, remote description is set and tracks flow to videoRef
        3. On track mute/ended, streamStale becomes true
        4. cleanupWhep tears down connection and clears video srcObject
        5. Reconnect fires with exponential backoff (1s, 2s, 4s... up to 10s)
        6. Max 15 reconnect attempts before stopping
        7. Hook cleans up on unmount (closes PC, clears timers)
        8. Does not attempt WHEP connection when streamStatus is "waiting" or "ended"
        9. muted state starts true, toggleMute flips it
        10. muted prop correctly controls video element audio
      </test_steps>
      <review></review>
    </task>

    <task id="hook-websocket" priority="1" category="infrastructure">
      <title>Extract useAuctionWebSocket hook</title>
      <description>
        Extract WebSocket connect/reconnect/ping logic from LiveViewerClient (lines 739-796) into a reusable hook.
        Takes auctionId + onMessage callback + reconnectTrigger. Returns send function.
        Handles 30s heartbeat ping, auto-reconnect with exponential backoff (max 15s).
      </description>
      <steps>
        - Create src/app/pages/live/hooks/useAuctionWebSocket.ts
        - Move WebSocket connection lifecycle (open, message, close, error handlers)
        - Move ping heartbeat interval (30s)
        - Move reconnect with exponential backoff
        - Move wsRef
        - Accept auctionId, onMessage callback, reconnectTrigger as params
        - Return send function for outgoing messages
      </steps>
      <test_steps>
        1. Opens WebSocket to wss://{host}/ws/auction/{auctionId}
        2. Calls onMessage for each received message (parsed JSON)
        3. Sends ping every 30s while connected
        4. Auto-reconnects on close with exponential backoff
        5. send() transmits JSON-stringified message over WS
        6. Incrementing reconnectTrigger forces immediate reconnect
        7. Cleans up WS and timers on unmount
      </test_steps>
      <review></review>
    </task>

    <task id="hook-chat" priority="1" category="infrastructure">
      <title>Extract useChat hook</title>
      <description>
        Extract chat message state management from LiveViewerClient into a reusable hook.
        Manages messages array, setChatHistory (bulk replace), addMessage (append single).
        Does NOT include scroll behavior — that's layout-specific. Both layouts manage their own scroll refs.
      </description>
      <steps>
        - Create src/app/pages/live/hooks/useChat.ts
        - Move chatMessages useState
        - Create setChatHistory (for chat_history server message)
        - Create addMessage (for chat_message server message)
        - Create sendChat that sends via WS send function
        - Export ChatMessage type re-export for convenience
      </steps>
      <test_steps>
        1. messages starts as empty array
        2. setChatHistory replaces entire messages array
        3. addMessage appends to existing messages
        4. sendChat calls WS send with correct message format
      </test_steps>
      <review></review>
    </task>

    <task id="hook-bidding" priority="1" category="infrastructure">
      <title>Extract useBidding hook</title>
      <description>
        Extract bid mode state, confirmation flow, and bid send logic from LiveViewerClient into a reusable hook.
        Manages bidMode, confirmingBidCents state. Provides handleBidTap, handleBidSubmit, handleBidCancel,
        handleBidConfirm (sends via WS with idempotencyKey), onBidAccepted (toast + clear), onBidRejected (toast).
      </description>
      <steps>
        - Create src/app/pages/live/hooks/useBidding.ts
        - Move bidMode, confirmingBidCents useState
        - Move handleBidTap, handleBidSubmit, handleBidCancel callbacks
        - Move sendBid logic (generates nanoid idempotencyKey, includes currentLot context)
        - Move bid_accepted handler (toast success, clear bidMode + confirmingBidCents)
        - Move bid_rejected handler (toast error)
        - Accept currentLot + WS send as params
      </steps>
      <test_steps>
        1. bidMode starts false, handleBidTap sets it true
        2. handleBidSubmit sets confirmingBidCents
        3. handleBidCancel clears confirmingBidCents
        4. handleBidConfirm sends bid via WS with idempotencyKey and lot context
        5. onBidAccepted clears bidMode + confirmingBidCents and shows success toast
        6. onBidRejected shows error toast
      </test_steps>
      <review></review>
    </task>

    <task id="hook-registration" priority="1" category="infrastructure">
      <title>Extract useRegistration hook</title>
      <description>
        Extract registration state management from LiveViewerClient into a reusable hook.
        Both layouts manage identical state: showRegistration, registrationComplete, guest (mutable),
        wsReconnectTrigger, handleRegistrationGate, handleRegistrationComplete.
        Without this hook, registration logic would be copy-pasted between both layout components.
      </description>
      <steps>
        - Create src/app/pages/live/hooks/useRegistration.ts
        - Move showRegistration, registrationComplete useState
        - Move guest useState (mutable — name gets set after registration)
        - Move wsReconnectTrigger useState (incremented after registration to force WS reconnect with new identity)
        - Move handleRegistrationGate (shows panel if not registered)
        - Move handleRegistrationComplete (updates guest name, sets registrationComplete, increments reconnectTrigger)
        - Accept initial guest, bidderRequirement, existingRegistration as params
        - Derive initial registrationComplete from existingRegistration
      </steps>
      <test_steps>
        1. registrationComplete derives correctly from existingRegistration (guest tier = has name, registered tier = registered flag, card tier = hasCard flag)
        2. handleRegistrationGate shows panel when not registered, no-ops when registered
        3. handleRegistrationComplete updates guest name, sets registrationComplete true, increments wsReconnectTrigger
        4. wsReconnectTrigger starts at 0 and increments on each registration completion
        5. showRegistration toggles the registration panel visibility
      </test_steps>
      <review></review>
    </task>

    <task id="hook-message-dispatch" priority="1" category="infrastructure">
      <title>Extract useServerMessageDispatch hook</title>
      <description>
        Extract the ~50-line handleServerMessage switch/case into a reusable hook.
        Takes all hook updaters as params, returns the onMessage callback for useAuctionWebSocket.
        Without this, both LiveViewerClient and LiveViewerOverlayClient would have identical
        message dispatch logic copy-pasted. Dispatches to: useStreamStatus (auction_update, lot_update,
        viewer_count), useWhepConnection (stream_ended, stream_paused), useChat (chat_history, chat_message),
        useBidding (bid_accepted, bid_rejected), useRegistration (registration_required).
      </description>
      <steps>
        - Create src/app/pages/live/hooks/useServerMessageDispatch.ts
        - Accept updater functions from all other hooks as params
        - Build and return handleServerMessage callback
        - Handle all message types: auction_update, stream_ended, viewer_count, lot_update, chat_history, chat_message, stream_paused, bid_accepted, bid_rejected, registration_required, pong
        - Each case delegates to the appropriate hook's updater function
      </steps>
      <test_steps>
        1. auction_update dispatches to useStreamStatus.handleAuctionUpdate + derives streamStatus for useWhepConnection
        2. stream_ended calls useWhepConnection.cleanupWhep
        3. viewer_count calls useStreamStatus.handleViewerCount
        4. lot_update calls useStreamStatus.handleLotUpdate
        5. chat_history calls useChat.setChatHistory
        6. chat_message calls useChat.addMessage
        7. stream_paused calls useWhepConnection.setStreamStale(true)
        8. bid_accepted calls useBidding.onBidAccepted
        9. bid_rejected calls useBidding.onBidRejected
        10. registration_required calls useRegistration.showRegistration
        11. pong is a no-op
      </test_steps>
      <review></review>
    </task>

    <task id="wire-hooks" priority="1" category="functional">
      <title>Wire hooks into LiveViewerClient</title>
      <description>
        Refactor LiveViewerClient.tsx to use the 7 extracted hooks instead of inline state/effects.
        useServerMessageDispatch provides the onMessage callback — no manual dispatch in component.
        useRegistration handles all registration state. JSX remains unchanged.
        Component should drop from ~905 lines to ~250 (layout + sub-components only).
        This is a pure refactor — zero visual changes.
      </description>
      <steps>
        - Import all 7 hooks (useStreamStatus, useWhepConnection, useAuctionWebSocket, useChat, useBidding, useRegistration, useServerMessageDispatch)
        - Replace inline useState/useRef/useEffect/useCallback with hook calls
        - Wire useServerMessageDispatch with updaters from all hooks → pass its callback to useAuctionWebSocket
        - Wire useRegistration for registration state + wsReconnectTrigger → pass trigger to useAuctionWebSocket
        - Keep ChatPanel, ChatInput, BidInput, BidButton sub-components as-is (they receive data via props)
        - Remove dead code (functions/state now in hooks)
      </steps>
      <test_steps>
        1. Visit /live/{slug} — layout renders identically to pre-refactor
        2. WebSocket connects and receives auction_update/viewer_count
        3. Chat messages appear and auto-scroll works
        4. Sending a chat message works (registered user)
        5. Bid flow works: tap $ → enter amount → confirm → bid_accepted toast
        6. Video stream connects via WHEP and plays
        7. StreamSlate shows correct states (connecting, live, paused, ended)
        8. Registration panel triggers when unregistered user tries to bid/chat
        9. Stale stream detection works (stream_paused message)
        10. WS reconnect works after disconnect
        11. WHEP reconnect works after connection drop
      </test_steps>
      <review></review>
    </task>

    <task id="overlay-header" priority="2" category="functional">
      <title>Build OverlayHeader component</title>
      <description>
        Thin translucent header bar for the overlay layout. Fixed at top of viewport.
        Shows lot title (left, truncated), viewer count + LIVE badge (right).
        Follows DESIGN.md: h-12 (48px target), text-lg (18px font).
        Fades to transparent when no lot is active.
      </description>
      <steps>
        - Create src/app/pages/live/OverlayHeader.tsx as "use client" component
        - Fixed position: top-0, full width, z-20
        - bg-black/40 backdrop-blur-sm for translucent look
        - Lot title left-aligned, truncated with text-ellipsis
        - Viewer count + LIVE badge right-aligned
        - Transition opacity to 0 when no active lot (motion-safe: transition, instant if prefers-reduced-motion)
        - Desktop: md:px-8 for wider padding on large screens
        - Safe area: pt-[env(safe-area-inset-top)] for notched devices
      </steps>
      <test_steps>
        1. Header visible at top of screen with translucent background
        2. Lot title displays and truncates on narrow screens
        3. Viewer count updates in real-time
        4. LIVE badge shows when stream is live
        5. Header fades when no lot is active
        6. Text is 18px+ and legible over video content
      </test_steps>
      <review></review>
    </task>

    <task id="overlay-chat" priority="2" category="functional">
      <title>Build OverlayChatPanel component</title>
      <description>
        Chat overlay for the Whatnot-style layout. In this layout, chat is separated from bidding —
        chat is a social/conversation channel, while bids get their own dedicated bar (OverlayBidBar).
        Bid system messages still appear inline in chat (for social proof) but the chat input is
        purely for conversation, not bid entry.

        Messages render as semi-transparent dark pills overlaid on video in the bottom-left area.
        Older messages fade in opacity. Container uses pointer-events-none so users can tap through
        to video (for unmute etc); interactive elements (chat input) get pointer-events-auto.
        Uses useChat hook for message state; manages own scroll refs.
        Includes visualViewport resize handler for mobile keyboard.
      </description>
      <steps>
        - Create src/app/pages/live/OverlayChatPanel.tsx as "use client" component
        - Position: fixed left-0 w-[70%] max-h-[40dvh] z-10
        - Bottom offset adapts to bid bar: bottom-20 when lot active (bid bar visible), bottom-0 when no lot (bid bar hidden). Accept `hasActiveLot` prop.
        - Desktop: md:w-[40%] md:max-h-[50dvh] — narrower relative to wide screen, taller since there's room
        - Container: pointer-events-none, overflow-y-auto
        - Message pills: bg-black/60 backdrop-blur-sm rounded-full px-4 py-2 text-lg
        - Text shadow: [text-shadow:0_1px_3px_rgba(0,0,0,0.8)] for readability
        - Opacity fade: older messages reduce opacity (Math.max(0.3, 1 - idx * 0.12) applied to last N visible). Use motion-safe: for fade transitions; skip animation if prefers-reduced-motion.
        - Bid system messages: bg-amber-900/60 pill + star prefix (social proof, not input)
        - Chat input area: pointer-events-auto, transparent bg, below messages — chat only, no bid entry
        - Auto-scroll with same bottom-detection pattern as current ChatPanel
        - visualViewport resize handler for mobile keyboard
        - Unregistered users see "Tap to join chat" button (triggers registration gate)
      </steps>
      <test_steps>
        1. Chat messages appear as dark semi-transparent pills over video
        2. Older messages fade in opacity
        3. Tapping through message area reaches video (pointer-events passthrough)
        4. Chat input is interactive (pointer-events-auto)
        5. Sending a chat message works (conversation, not bids)
        6. Bid system messages appear inline with amber styling (social proof)
        7. Chat input does NOT have bid entry — bidding is in OverlayBidBar
        8. Auto-scroll follows new messages
        9. Scrolling up pauses auto-scroll, "New messages" indicator appears
        10. Mobile keyboard opens without breaking layout
        11. Text is legible over both dark and bright video content
        12. Unregistered user sees "Tap to join chat" gate
      </test_steps>
      <review></review>
    </task>

    <task id="overlay-bid-bar" priority="2" category="functional">
      <title>Build OverlayBidBar component</title>
      <description>
        Dedicated bidding surface fixed at bottom of viewport — the key UX improvement in the overlay layout.
        In the current split-panel, bids and chat share the same input, making chat mostly bid noise.
        Here, bidding is fully separated: a near-opaque bar shows current bid + "Place Bid" button.
        No lot thumbnail — focus is on the streaming + bidding action, not lot details.
        Transforms inline to bid amount input when in bid mode. Hides when no active lot.
        Uses useBidding hook. Includes bid confirmation modal.
        Safe area aware for devices with home indicators.
      </description>
      <steps>
        - Create src/app/pages/live/OverlayBidBar.tsx as "use client" component
        - Position: fixed bottom-0 w-full z-20
        - Padding: pb-[max(0.5rem,env(safe-area-inset-bottom))]
        - Background: bg-zinc-900/95 backdrop-blur-sm
        - Default: current bid amount + lot status text (going_once → "Going once!", going_twice → "Going twice!", sold → "Sold!") + "Place Bid" button (h-12, text-lg)
        - Desktop: md:max-w-lg md:mx-auto md:rounded-t-xl — centered card on wide screens, not full-width bar
        - Bid mode: inline transform to amount input + confirm/cancel
        - Bid confirmation modal positioned above bar
        - Hidden (translate-y-full + motion-safe:transition) when no active lot. Instant hide if prefers-reduced-motion.
        - Registration gate: if unregistered, "Place Bid" triggers registration
      </steps>
      <test_steps>
        1. Bid bar visible at bottom when a lot is active
        2. Shows current bid amount clearly
        3. "Place Bid" button has 48px+ touch target
        4. Tapping "Place Bid" switches to bid input mode
        5. Entering amount and confirming sends bid
        6. Bid accepted clears input and shows success toast
        7. Bid rejected shows error toast
        8. Bar hides with animation when no lot active
        9. Safe area padding works on notched devices
        10. Registration triggers for unregistered users tapping "Place Bid"
      </test_steps>
      <review></review>
    </task>

    <task id="overlay-client" priority="2" category="functional">
      <title>Build LiveViewerOverlayClient</title>
      <description>
        Main overlay layout component. Uses all 7 hooks. Full-bleed video fills viewport,
        overlay components layered on top. Reuses StreamSlate and RegistrationPanel as-is.
        useRegistration handles all registration state. useServerMessageDispatch handles all message routing.
        Accepts same LiveViewerClientProps as LiveViewerClient.
        Thin component — mostly hook wiring + JSX layout.
      </description>
      <steps>
        - Create src/app/pages/live/LiveViewerOverlayClient.tsx as "use client" component
        - Import and use all 7 hooks
        - Import OverlayHeader, OverlayChatPanel, OverlayBidBar, StreamSlate, RegistrationPanel
        - Full-bleed video: relative w-full h-dvh bg-black overflow-hidden
        - Video element: absolute inset-0 w-full h-full object-cover autoPlay playsInline
        - Z-order: video (base) → StreamSlate (z-10, pointer-events-auto for unmute tap) → OverlayChatPanel (z-10, pointer-events-none) → OverlayHeader (z-20) → OverlayBidBar (z-20) → RegistrationPanel (z-50)
        - StreamSlate must have pointer-events-auto so "Tap to hear audio" is tappable above the pointer-events-none chat layer
        - Pass hasActiveLot to OverlayChatPanel for bottom offset adaptation
        - Wire hooks: useServerMessageDispatch provides onMessage → useAuctionWebSocket; useRegistration provides wsReconnectTrigger → useAuctionWebSocket
      </steps>
      <test_steps>
        1. Full-bleed video fills viewport in any orientation
        2. All overlay components render in correct z-order
        3. WebSocket connects and receives messages
        4. Chat messages appear as overlay pills
        5. Bid bar shows when lot is active
        6. Bid flow works end-to-end
        7. Stream states display correctly via StreamSlate
        8. Registration panel slides up when triggered
        9. After registration, chat/bid becomes functional
        10. Works on mobile portrait (primary target)
        11. Works on mobile landscape (video fills naturally)
        12. Works on desktop (video fills, overlays positioned correctly)
      </test_steps>
      <review></review>
    </task>

    <task id="query-param-routing" priority="1" category="functional">
      <title>Add query param routing + localStorage persistence in LivePage</title>
      <description>
        Modify LivePage.tsx server component to read ?view=overlay query param and pass viewMode as a prop.
        Add `request` to RequestInfo destructuring.
        Export LiveViewerClientProps from LiveViewerClient so overlay can import it.
        Both client components receive a `viewMode` prop. A thin client wrapper handles localStorage:
        - If ?view= param present: use it, save to localStorage
        - If no param: read from localStorage
        - Default: split-panel (current)
        This way returning users get the same layout without needing the query param.
      </description>
      <steps>
        - Add `request` to LivePage destructured params
        - Read viewMode from new URL(request.url).searchParams.get("view")
        - Pass viewMode to a LiveViewerSwitch client component
        - LiveViewerSwitch: if viewMode from server, use it + save to localStorage("live-view-mode")
        - LiveViewerSwitch: if no viewMode from server, read localStorage("live-view-mode")
        - LiveViewerSwitch: use React.lazy() + Suspense to dynamically import only the active layout component (avoids shipping both bundles to client)
        - Suspense fallback: minimal loading state (black bg + spinner, matches stream connecting state)
        - Export LiveViewerClientProps interface from LiveViewerClient
      </steps>
      <test_steps>
        1. /live/{slug} renders split-panel by default (first visit)
        2. /live/{slug}?view=overlay renders overlay layout
        3. After visiting ?view=overlay, returning to /live/{slug} (no param) still shows overlay
        4. /live/{slug}?view=split explicitly switches back to split-panel
        5. Preference survives page refresh
        6. Both layouts receive identical props
        7. Both layouts functional simultaneously in separate browser tabs
      </test_steps>
      <review></review>
    </task>
  </tasks>

  <success_criteria>
    - Current split-panel layout at /live/:slug works identically to pre-refactor
    - New overlay layout at /live/:slug?view=overlay is fully functional (streaming, chat, bid, registration)
    - Overlay cleanly separates bidding (dedicated bar) from chat (social conversation overlay)
    - Both layouts can be tested simultaneously during a live auction
    - View preference persists via localStorage for returning users
    - Overlay follows DESIGN.md (18px font, 48px targets, no icons without labels, high contrast, safe areas)
    - Overlay respects prefers-reduced-motion (no animations when user prefers reduced motion)
    - Desktop overlay has reasonable md: adaptations (centered bid card, narrower chat, wider padding)
    - Only the active layout's JS is loaded (React.lazy bundle split)
    - Shared hooks (7 total) are clean abstractions with zero duplication between layouts
  </success_criteria>
</project_specification>
