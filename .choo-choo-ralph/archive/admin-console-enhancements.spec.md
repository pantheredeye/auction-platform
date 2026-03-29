---
title: "Admin Console — Connected User List + SHARE/BID FEED Separation"
created: 2026-03-29
poured:
  - auction-platform-mol-lbn0
  - auction-platform-mol-7l4k
  - auction-platform-mol-gbhn
  - auction-platform-mol-3kpw
  - auction-platform-mol-bh12
  - auction-platform-mol-k2bv
  - auction-platform-mol-yr2w
  - auction-platform-mol-khc2
iteration: 1
auto_discovery: false
auto_learnings: false
---
<project_specification>
<project_name>Admin Console — Connected User List + SHARE/BID FEED Separation</project_name>

  <overview>
    Two admin console enhancements for go-live v1 chat-bidding workflow: (1) real-time connected user list so auctioneer can verify who's watching and their registration status, (2) move SHARE section out of center column into right sidebar so BID FEED gets full space when live.
  </overview>

  <context>
    <existing_patterns>
      - `ServerMessage` union type in `src/auction/types.ts` (line 143) — add new variants to this union
      - `broadcast(msg, tag?)` in DO (line 1301) — already supports tag-filtered sends (e.g. `"admin"`)
      - `SocketAttachment` (lines 29-34) stores userId, username, isAdmin, isGuest, bidderStatus per socket
      - `sendStateSnapshot(ws)` (line 1327) sends full state to newly connected socket — extend for admin
      - `getWebSockets(tag?)` returns sockets filtered by tag — used for viewer count, reuse for user list
      - Collapsible sections pattern in AuctioneerConsole — lots and chat both use state toggle + chevron
      - Right sidebar: `<aside className="hidden md:block border-l overflow-y-auto p-3">` (line 1064)
      - Mobile collapsible chat: `md:hidden` toggle block (lines 1046-1061)
    </existing_patterns>
    <integration_points>
      - `src/auction/types.ts` — new `ConnectedUserInfo` interface, 3 new `ServerMessage` variants
      - `src/auction/durableObject.ts` — new helper + broadcasts at connect/disconnect/snapshot
      - `src/app/pages/admin/auctions/AuctioneerConsole.tsx` — state, message handler, UI for both features
      - `BidderRequirement` type from `src/lib/bidder-requirement.ts` — reuse in `ConnectedUserInfo`
    </integration_points>
    <new_technologies>
      - None — all existing stack (DO WebSockets, React state, Tailwind)
    </new_technologies>
    <conventions>
      - Message handler is a switch statement in `handleServerMessage` (lines 460-559)
      - Sub-components extracted at bottom of AuctioneerConsole (e.g. `BidFeedPanel`)
      - Header uses `text-sm text-muted-foreground` for metadata like viewer count
      - Section headers use `text-xs font-medium text-muted-foreground uppercase tracking-wide`
      - `isStreamingLive` (line 666) gates UI between setup and live modes
    </conventions>
  </context>

  <tasks>
    <task id="types" priority="1" category="infrastructure">
      <title>Add connected-user message types</title>
      <description>
        Add `ConnectedUserInfo` interface and three new `ServerMessage` variants (`user_list`, `user_joined`, `user_left`) to `src/auction/types.ts`. Pure additive, no breaking changes.
      </description>
      <steps>
        - Add `ConnectedUserInfo` interface: `{ userId, username, bidderStatus }`
        - Add `user_list` variant: `{ type: "user_list"; users: ConnectedUserInfo[] }`
        - Add `user_joined` variant: `{ type: "user_joined"; user: ConnectedUserInfo }`
        - Add `user_left` variant: `{ type: "user_left"; userId: string }`
      </steps>
      <test_steps>
        1. `npx tsc --noEmit` — no type errors
      </test_steps>
      <review></review>
    </task>

    <task id="do-user-list" priority="1" category="functional">
      <title>Broadcast user list from Durable Object</title>
      <description>
        Add `getConnectedUserList()` helper to DO that derives user info from live socket attachments (not from `connectedUsers` Set which only has IDs). Broadcast user events to admin-tagged sockets only at three points: admin connect, user connect, user disconnect. Multi-tab dedup via `getWebSockets(userId).length` check.
      </description>
      <steps>
        - Add `getConnectedUserList()` private method — iterate `ctx.getWebSockets()`, deserialize attachments, dedup by userId, exclude admins
        - In `sendStateSnapshot`: if connecting socket is admin, send `{ type: "user_list" }` with full list
        - In `handleWebSocketUpgrade`: after viewer_count broadcast, if non-admin AND first socket for this userId (`getWebSockets(userId).length === 1`), broadcast `user_joined` to `"admin"` tag
        - In `webSocketClose`: if non-admin AND no remaining sockets for userId (`getWebSockets(userId).length === 0`), broadcast `user_left` to `"admin"` tag
        - Same pattern in `webSocketError`
      </steps>
      <test_steps>
        1. Open admin console + viewer in separate browser windows
        2. DevTools WS inspector on admin — verify `user_list` arrives on connect
        3. Open viewer — verify `user_joined` arrives on admin socket
        4. Close viewer — verify `user_left` arrives on admin socket
        5. Open two viewer tabs for same user, close one — verify NO `user_left` sent
        6. Close second tab — verify `user_left` sent
        7. Verify viewer socket does NOT receive any user_list/joined/left messages
      </test_steps>
      <review></review>
    </task>

    <task id="admin-user-list-ui" priority="2" category="functional">
      <title>Connected users dropdown in admin header</title>
      <description>
        Add state + message handler for user list in AuctioneerConsole. Make viewer count in header clickable to toggle a dropdown showing connected users with name and registration status badge. Extract as `ConnectedUsersList` sub-component.
      </description>
      <steps>
        - Add `connectedUsers` state (`ConnectedUserInfo[]`)
        - Add 3 cases to message handler switch: `user_list` (replace), `user_joined` (append with dedup), `user_left` (filter)
        - Make viewer count in header a clickable button with chevron
        - Render dropdown panel (absolutely positioned below header) when expanded
        - Each row: username + small badge for bidderStatus (gray=guest, blue=registered, green=card_on_file)
        - Extract `ConnectedUsersList` sub-component at bottom of file
      </steps>
      <test_steps>
        1. Click viewer count in header — dropdown appears
        2. List shows connected non-admin users with correct names
        3. Badge colors match registration status
        4. New viewer connects — list updates without re-clicking
        5. Viewer disconnects — removed from list
        6. Click again or click outside — dropdown closes
      </test_steps>
      <review></review>
    </task>

    <task id="share-to-sidebar" priority="2" category="functional">
      <title>Move SHARE section to right sidebar</title>
      <description>
        Remove SHARE card from center `<main>` column. Add collapsible SHARE section to right sidebar above CHAT. Defaults open pre-live, auto-collapses when stream goes live. QR code shrinks from 160px to 120px to fit sidebar. Add same collapsible SHARE to mobile `md:hidden` section.
      </description>
      <steps>
        - Add `shareOpen` state, default `true`, auto-collapse via `useEffect` when `isStreamingLive` becomes true
        - Remove SHARE card (lines ~1010-1044) from center column
        - Add collapsible SHARE section to top of right sidebar `<aside>`: toggle header ("Share" + chevron), share URL (mono, select-all, break-all), QR code (120px), copy link button
        - Separate from CHAT below with `border-t`
        - Add same collapsible SHARE into `md:hidden` mobile section above the chat collapsible
      </steps>
      <test_steps>
        1. Pre-live: SHARE section visible in right sidebar, expanded by default
        2. QR code renders at 120px, URL is selectable
        3. Copy link button works (clipboard or share API)
        4. Go live — SHARE auto-collapses
        5. Can manually re-expand SHARE while live
        6. Center column: BID FEED has full remaining space, no SHARE card
        7. Mobile: SHARE accessible via collapsible toggle above chat
      </test_steps>
      <review></review>
    </task>
  </tasks>

  <success_criteria>
    - Auctioneer can see who's connected and their registration status at a glance
    - User list updates in real-time (join/leave) without page refresh
    - User data only sent to admin sockets, never to viewer sockets
    - Multi-tab users appear once and only disappear when all tabs close
    - SHARE section accessible but not competing with BID FEED for space
    - No regressions to mobile layout or existing admin functionality
  </success_criteria>
</project_specification>
