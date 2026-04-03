# Auction Platform Launch Roadmap

> Living document. Each section is both a todo list and expandable design area.
> Items marked `[?]` need input from Stan or team decision.

---

## Phase 0: Merge & Stabilize

- [ ] Merge `chunk-3-live-auction-core` → `main`
- [ ] Security posture review (GitHub issue opened)
- [ ] Enable stream recording (Cloudflare Stream supports WHIP recording)
- [ ] Clean up auctioneer console — remove unused lot/bid UI cruft
- [ ] Mobile layout: sticky camera view at top, scrollable controls beneath

---

## Phase 1: Day 1 Zero-Friction Entry (MVP Launch)

**Goal:** Stan shares a link. Customer clicks it. They're watching. No account needed.

### Anonymous Viewer Mode
- [ ] New route: `/watch/:auctionId` — no auth required
- [ ] Stream playback (WHEP) works without session/login
- [ ] Temporary identity: auto-assigned nickname (Guest-XXXX) stored in cookie
- [ ] Chat participation with nickname (no registration wall)
- [ ] [?] Anonymous bidding allowed? Or require soft-reg before first bid?
  - If anon bidding: bids tied to cookie identity, resolved at pickup
  - If soft-reg required: prompt registration card on first bid attempt

### Auctioneer Start Stream
- [ ] Big prominent "Go Live" button — primary action, can't miss it
- [ ] Press → camera starts → stream begins (existing WHIP flow, simplified UI)
- [ ] Optional guided setup (camera select, mic check) — skippable
- [ ] [?] Voice-activated start stream — future nice-to-have, park for now
- [ ] Post-start: minimal overlay — camera dominant, small control strip

### Share Link Flow
- [ ] Copy-to-clipboard button for auction link
- [ ] Native share API on mobile (share to SMS, WhatsApp, etc.)
- [ ] QR code generation for in-person sharing
- [ ] Shareable from both mobile and desktop

---

## Phase 2: Soft Registration & Identity Capture

**Goal:** Capture identity with minimal friction, at natural moments.

### Soft Registration Prompt
- [ ] Trigger: after first bid attempt, OR after X minutes watching (configurable)
- [ ] Slide-up card (not modal, not blocking)
- [ ] Fields: name + phone or email (minimal)
- [ ] "Save your spot — get notified for next auction"
- [ ] Admin setting: require registration before bidding vs allow anonymous
- [ ] Dismissable — user can keep watching without registering

### Post-Auction Identity Binding
- [ ] At pickup: "Complete your registration to claim items"
- [ ] QR code scan at pickup location → opens registration form
- [ ] Or: auctioneer shares registration link from app
- [ ] Ties cookie/guest identity to real account + transaction history
- [ ] This is where passkey/WebAuthn gets created for future sessions

### AI-Assisted Registration (Explore)
- [ ] Voice-prompted registration: AI reads fields, user speaks answers
- [ ] Real-time speech-to-text into form fields (Web Speech API or server-side)
- [ ] Confidence indicators: AI confirms back uncertain fields
- [ ] AI adapts questions based on context (e.g., skips fields already captured)
- [ ] Fallback: manual text entry always available

---

## Phase 3: Notifications & Returning Users

**Goal:** Once we have contact info, keep them coming back.

### Pre-Live Notifications
- [ ] Notification preferences captured at soft-reg (SMS, email, push)
- [ ] Alert schedule: 30min, 5min, LIVE (configurable per auction)
- [ ] Infrastructure: Cloudflare Queues → SMS provider (Twilio?) / email
- [ ] [?] SMS vs email vs push? SMS most reliable for current demographic

### Day 1 Contact Import (Temporary)
- [ ] Script to import Stan's existing contact list (CSV/JSON)
- [ ] Send manual notifications to existing audience
- [ ] Optional: create platform accounts from imported contacts
- [ ] This bridges the Facebook/Zoom audience to the new platform

### Returning Users
- [ ] Cookie recognition: "Welcome back, [name]" — no login needed for viewing
- [ ] Passkey login for bidding/account actions (already have WebAuthn infra)
- [ ] One-tap re-auth for returning registered users

---

## Phase 4: AI Stream Processing (Explore & Research)

**Goal:** Extract value from live stream data. Research-phase items.

### Stream Recording
- [ ] Record all streams via Cloudflare Stream recording
- [ ] Playback UI for auctioneer review
- [ ] Shareable replay links for team review
- [ ] Archive storage (R2) for long-term retention

### Audio Intelligence
- [ ] **Voice Activity Detection (VAD):** detect speech segments, skip silence
  - Client-side VAD possible: `@ricky0123/vad-web` or WebRTC built-in
  - Only send speech segments to AI → massive cost reduction
  - Do NOT send continuous stream with silence to model
- [ ] Audio extraction from stream (separate audio track from WHIP)
- [ ] Server-side transcription (Whisper API / Cloudflare Workers AI)
- [ ] Bid detection from auctioneer speech (pattern: "sold to [name] for [amount]")
- [ ] Real-time caption overlay option

### On-Device AI (Browser)
- [ ] Web Speech API: built-in browser STT — free, works now, decent quality
- [ ] Chrome Built-in AI / WebNN: emerging, not reliable enough yet
- [ ] Strategy: use Web Speech API for client-side, server-side for accuracy
- [ ] Hybrid: client-side VAD (detect speech) → send segments to server AI

### AI Processing Cost Model
- [ ] A 2-hour auction ~= 60-90 min of actual speech (with VAD filtering)
- [ ] Whisper API: ~$0.36/hr of audio (at $0.006/min)
- [ ] Real-time processing needs chunked streaming (5-10 sec segments)
- [ ] Batch processing (post-auction) much cheaper, good for review use case

---

## Phase 5: Payment Integration (Pending Stan Input)

- [ ] [?] How does Stan currently handle payments? Cash? Shopify? Venmo?
- [ ] [?] Digital payment flow needed or all at pickup?
- [ ] If Shopify: potential integration for checkout post-auction
- [ ] Invoice generation from bid history
- [ ] Payment status tracking per buyer

---

## Open Questions (Ask Stan)

1. **Anonymous bidding?** Can people bid without identifying themselves, or need name first?
2. **Payment flow?** How does he handle payments now? Digital needed?
3. **Identity verification?** How does he currently verify who bid on what?
4. **Notification preference?** SMS vs email for his audience?
5. **Trial run?** When does he want to do a test auction on the platform?

---

## Technical Debt & Infrastructure

- [ ] Security review (see GitHub issue)
- [ ] Staging environment validation
- [ ] Error monitoring / logging for live auctions
- [ ] Mobile responsiveness audit (auctioneer + viewer)
- [ ] Load testing: concurrent viewers on WHEP
