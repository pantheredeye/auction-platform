---
title: "Stripe Connect + Tiered Bidder Registration"
created: 2026-03-10
poured:
  - auction-platform-mol-rzig
  - auction-platform-mol-2bi8
  - auction-platform-mol-1qdj
  - auction-platform-mol-73tf
  - auction-platform-mol-fffx
  - auction-platform-mol-8tv5
  - auction-platform-mol-adwr
  - auction-platform-mol-mz0q
  - auction-platform-mol-qo0d
  - auction-platform-mol-i5ma
  - auction-platform-mol-5iyq
  - auction-platform-mol-vf54
  - auction-platform-mol-rq7l
  - auction-platform-mol-u4hz
  - auction-platform-mol-h5ux
  - auction-platform-mol-lvmv
  - auction-platform-mol-9udg
  - auction-platform-mol-g63z
  - auction-platform-mol-tnkc
  - auction-platform-mol-27nu
  - auction-platform-mol-4mi1
  - auction-platform-mol-o73v
  - auction-platform-mol-9ro9
  - auction-platform-mol-dlt6
iteration: 1
auto_discovery: false
auto_learnings: false
---
<project_specification>
<project_name>Stripe Connect + Tiered Bidder Registration</project_name>

  <overview>
    Add configurable bidder registration requirements (guest / registered / card_on_file) per org
    with per-auction overrides. Integrate Stripe Connect for card storage via Setup Intents, enabling
    future automated payments and charge-on-demand. Gate both chat and bidding based on tier.
    Viewing remains zero-friction. Registration happens via a slide-up panel at chat/bid time,
    with optional pre-registration banner. Returning users skip registration via guest cookie linkage.
    First client's Stripe Connected Account created manually; onboarding UI deferred.
  </overview>

  <context>
    <existing_patterns>
      - Server functions: `"use server"` directive, access `requestInfo.ctx`, throw Error for validation, return typed objects
      - Client components: `"use client"`, `useState` + `useTransition`, `startTransition(async () => { await serverFn() })`, error state via catch
      - Admin pages: RSC Page fetches data → passes to Client component as props (e.g., AdminAuctionsPage → AdminAuctionsClient)
      - Migrations: `NNNN_description.sql`, TEXT for IDs/dates, INTEGER for cents/booleans, version column for optimistic locking
      - WebSocket messages: union types in `src/auction/types.ts` (ClientMessage | ServerMessage | AdminMessage), handler dispatch in `webSocketMessage()`
      - DO error pattern: `this.sendToSocket(ws, { type: "error", message: "..." })` or `{ type: "bid_rejected", reason: "..." }`
      - Guest identity: cookie-based `guest_id` (nanoid) + `guest_name`, 30-day expiry, `getOrCreateGuestId()` in `src/app/lib/guest.ts`
      - Live viewer name prompt: inline state in LiveViewerClient, `showNamePrompt` → text input → `setGuestName()` server function
      - Money utilities: `formatCents()`, `dollarsToCents()`, `centsToDollars()`, `calculatePercentage()` in `src/lib/money.ts`
      - CSP: separate `setLiveCSP()` for live pages (no Turnstile), `setCommonHeaders()` for admin
      - Form pattern: client-side validation first, then `startTransition` wrapping server function call, error in Alert
    </existing_patterns>

    <integration_points>
      - `src/worker.tsx` (line ~175): WS upgrade handler sets X-User-Id, X-Username, X-Is-Admin, X-Is-Guest headers before forwarding to DO — add X-Bidder-Status + X-Bidder-Requirement
      - `src/auction/durableObject.ts`: SocketAttachment interface (line 27), handleChat/handleBid/handleClaim methods — add bidderStatus check
      - `src/auction/types.ts`: ServerMessage union — add registration_required type
      - `src/app/pages/live/LiveViewerClient.tsx`: GuestInfo prop, name prompt state — replace with RegistrationPanel
      - `src/app/pages/live/LivePage.tsx`: passes auction + guest to LiveViewerClient — add bidderRequirement + existingRegistration
      - `src/app/pages/live/server-functions/live.ts`: getAuctionBySlug() — join org for bidderRequirement, query bidder_registrations
      - `src/app/pages/live/server-functions/guest.ts`: setGuestName() — extend for registration cookie linking
      - `src/app/headers.ts`: setLiveCSP() — add Stripe domains
      - `src/db/index.ts`: all table interfaces — add new tables + columns
      - `src/app/pages/admin/auctions/AdminAuctionFormClient.tsx`: auction form — add bidderRequirement override dropdown
      - `src/app/pages/admin/auctions/server-functions/auctions.ts`: createAuction/updateAuction — add bidderRequirement field
      - `worker-configuration.d.ts`: Env interface — add STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET
      - `wrangler.jsonc`: vars section — add STRIPE_PUBLISHABLE_KEY
      - Existing invoices table has `stripePaymentLinkId` + `stripePaymentLinkUrl` stubs — future Connect integration point
      - `stripe` ^17.5.0 already in package.json — no install needed for server SDK
    </integration_points>

    <new_technologies>
      - Stripe SDK on CF Workers: `new Stripe(key, { httpClient: Stripe.createFetchHttpClient() })` — fetch-based, no Node APIs
      - Stripe Setup Intents: `stripe.setupIntents.create({ customer, usage: 'off_session', automatic_payment_methods: { enabled: true } })` → returns clientSecret
      - Stripe Payment Element (React): `@stripe/react-stripe-js` + `@stripe/stripe-js` — `<Elements options={{ clientSecret }}>` → `<PaymentElement />` → `stripe.confirmSetup({ elements, redirect: 'if_required' })`
      - Apple Pay/Google Pay: Payment Element auto-renders wallet buttons when available. Apple Pay requires domain verification (register in Stripe Dashboard + serve `/.well-known/apple-developer-merchantid-domain-association`). Google Pay must be enabled in Dashboard settings
      - Stripe Connect controller properties (replaces legacy account types): `controller: { stripe_dashboard: { type: 'express' }, fees: { payer: 'application' }, losses: { payments: 'application' }, requirement_collection: 'stripe' }`
      - Webhook verification on Workers: `Stripe.webhooks.constructEventAsync(body, sig, secret, undefined, Stripe.createSubtleCryptoProvider())` — must use async version + SubtleCrypto provider. Read request body with `request.text()` once
      - Stripe Link: one-tap payment for users who have saved credentials across Stripe merchants — auto-available in Payment Element
    </new_technologies>

    <conventions>
      - IDs: UUIDv4 via crypto.randomUUID() (TEXT primary key)
      - Money: integer cents (INTEGER columns)
      - Dates: ISO text strings (TEXT columns)
      - Optimistic locking: version column on mutable entities
      - Path alias: @/* → ./src/*
      - Server functions in subdirs: `src/**/server-functions/*.ts` with `"use server"` directive
      - Org isolation: always `.where("organizationId", "=", orgId)` in queries
      - Error handling: throw Error("message") in server functions, catch in client startTransition
    </conventions>
  </context>

  <technology_stack>
    <frontend>React 19 RSC (RWSDK), Tailwind 4, shadcn/ui, @stripe/react-stripe-js, @stripe/stripe-js</frontend>
    <backend>Cloudflare Workers, D1 (Kysely), Durable Objects, Stripe Connect (stripe ^17.5.0)</backend>
  </technology_stack>

  <tasks>
    <task id="schema-migration" priority="0" category="infrastructure">
      <title>Migration 0017 — Bidder Registration + Stripe Columns</title>
      <description>
        Add bidderRequirement + stripeConnectAccountId to organizations, bidderRequirement override to auctions,
        stripeCustomerId to users. Create payment_methods and bidder_registrations tables.
      </description>
      <steps>
        - Create `migrations/0017_bidder_registration_stripe.sql`
        - ALTER organizations: add bidderRequirement TEXT NOT NULL DEFAULT 'guest', stripeConnectAccountId TEXT
        - ALTER auctions: add bidderRequirement TEXT (nullable override)
        - ALTER users: add stripeCustomerId TEXT
        - CREATE payment_methods: id, userId, stripePaymentMethodId (UNIQUE), last4, brand, expMonth, expYear, isDefault, status (valid values: 'active' | 'detached' | 'expired'), createdAt, updatedAt
        - CREATE bidder_registrations: id, guestId, userId, createdAt — with index on guestId and unique on (guestId, userId)
        - CREATE terms_acceptances: id, userId, termsType TEXT NOT NULL ('platform' | 'org'), termsVersion TEXT NOT NULL, organizationId TEXT (null for platform terms), acceptedAt TEXT NOT NULL, ipAddress TEXT — with index on userId
        - Update `src/db/index.ts`: add PaymentMethodsTable, BidderRegistrationsTable, TermsAcceptancesTable interfaces, add new columns to OrganizationsTable, AuctionsTable, UsersTable
        - Update `worker-configuration.d.ts`: add STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET to Env
        - NOTE: users.username is TEXT NOT NULL UNIQUE — bidder users use email as username (duplicate email reuse handles collisions)
        - NOTE: set displayName = name when creating bidder users so WS X-Username header picks up their name correctly
      </steps>
      <test_steps>
        1. Run `npx wrangler d1 migrations apply auction-platform-db --local` — verify no errors
        2. Query `PRAGMA table_info(organizations)` — verify bidderRequirement and stripeConnectAccountId columns
        3. Query `PRAGMA table_info(payment_methods)` — verify table exists with all columns
        4. Query `PRAGMA table_info(bidder_registrations)` — verify table exists
        5. TypeScript compiles with no errors after db/index.ts changes
      </test_steps>
      <review></review>
    </task>

    <task id="stripe-client" priority="0" category="infrastructure">
      <title>Stripe SDK Client for Cloudflare Workers</title>
      <description>
        Create Stripe SDK initialization module using fetch-based HTTP client for CF Workers compatibility.
        Install client-side Stripe deps.
      </description>
      <steps>
        - Create `src/stripe/client.ts` — export `getStripe(secretKey)` using `Stripe.createFetchHttpClient()`
        - Also export `getCryptoProvider()` returning `Stripe.createSubtleCryptoProvider()` for webhook verification
        - Run `npm install @stripe/stripe-js @stripe/react-stripe-js`
        - Add STRIPE_PUBLISHABLE_KEY to `[vars]` in wrangler.jsonc (not a secret — needed client-side)
      </steps>
      <test_steps>
        1. Import getStripe in a test server function, call `stripe.customers.list({ limit: 1 })` — verify Stripe API connectivity
        2. Verify @stripe/stripe-js and @stripe/react-stripe-js in node_modules
        3. TypeScript compiles cleanly
      </test_steps>
      <review></review>
    </task>

    <task id="stripe-server-functions" priority="1" category="functional">
      <title>Stripe Server Functions — Customer, SetupIntent, PaymentMethod</title>
      <description>
        Server functions for bidder registration with Stripe. Creates lightweight user (authMethod: 'bidder'),
        Stripe Customer, SetupIntent for card storage, and saves PaymentMethod details after successful setup.
      </description>
      <steps>
        - Create `src/stripe/server-functions/setup.ts` with "use server" directive
        - `createBidder({ name, email, guestId })`: for 'registered' tier — create user row (authMethod: 'bidder', username: email, displayName: name), insert bidder_registrations linking guestId → userId, return { userId, userName }
        - `createBidderAndSetupIntent({ name, email, guestId })`: for 'card_on_file' tier — same as createBidder + create Stripe Customer (email, name, metadata: { userId, guestId }), create SetupIntent (customer, usage: 'off_session', automatic_payment_methods: enabled), return { userId, clientSecret, publishableKey: env.STRIPE_PUBLISHABLE_KEY }
        - `savePaymentMethod({ userId, stripePaymentMethodId })`: call stripe.paymentMethods.retrieve(id), extract last4/brand/expMonth/expYear, insert into payment_methods table, return { success: true }
        - `getBidderStatus(guestId)`: query bidder_registrations by guestId, if found check payment_methods for userId, return { registered: bool, hasCard: bool, userId?, userName?, userEmail? }
        - Handle duplicate email: if user with email already exists and is a 'bidder', reuse that user (update name/displayName if different, create new bidder_registration linking guestId). If full user exists, also reuse
        - Rate limiting: max 3 registration attempts per guestId per hour — track via simple in-memory map or D1 query on bidder_registrations.createdAt count
        - Auth flow safety: update `checkUsername()` in `src/auth/functions.ts` to handle authMethod 'bidder' — return descriptive error or redirect to account upgrade (defer upgrade UI, just prevent confusion)
      </steps>
      <test_steps>
        1. Call createBidderAndSetupIntent with test data — verify user created in D1, Stripe Customer created, SetupIntent returned with clientSecret
        2. Call getBidderStatus with the guestId — verify { registered: true, hasCard: false }
        3. After completing SetupIntent in Stripe test mode, call savePaymentMethod — verify payment_methods row created
        4. Call getBidderStatus again — verify { registered: true, hasCard: true }
        5. Call createBidderAndSetupIntent with same email — verify reuses existing user, creates new bidder_registration
      </test_steps>
      <review></review>
    </task>

    <task id="bidder-requirement-resolution" priority="1" category="functional">
      <title>Bidder Requirement Resolution Logic</title>
      <description>
        Utility to resolve effective bidder requirement from org default + auction override.
        Used by both WS upgrade handler and LivePage RSC.
      </description>
      <steps>
        - Create `src/lib/bidder-requirement.ts`
        - Export type `BidderRequirement = 'guest' | 'registered' | 'card_on_file'`
        - Export `resolveRequirement(orgDefault: BidderRequirement, auctionOverride: BidderRequirement | null): BidderRequirement` — returns override if non-null, else org default
        - Export `meetsRequirement(status: BidderRequirement, requirement: BidderRequirement): boolean` — checks if status >= requirement (guest < registered < card_on_file)
      </steps>
      <test_steps>
        1. resolveRequirement('guest', null) → 'guest'
        2. resolveRequirement('guest', 'card_on_file') → 'card_on_file'
        3. meetsRequirement('card_on_file', 'registered') → true
        4. meetsRequirement('guest', 'card_on_file') → false
        5. meetsRequirement('registered', 'registered') → true
      </test_steps>
      <review></review>
    </task>

    <task id="ws-upgrade-gating" priority="1" category="functional">
      <title>WebSocket Upgrade — Bidder Status Headers</title>
      <description>
        Modify the WS upgrade handler in worker.tsx to look up bidder status and effective requirement,
        passing both as headers to the Durable Object.
      </description>
      <steps>
        - In `src/worker.tsx` WS upgrade handler (~line 175), after guest identity resolution:
        - For non-admin guests: query bidder_registrations by guestId, if found query payment_methods for that userId
        - Determine bidder status: 'card_on_file' if has active payment method, 'registered' if has bidder_registration, else 'guest'
        - Set header `X-Bidder-Status` on doRequest
        - Look up auction's bidderRequirement + org's bidderRequirement, resolve effective requirement
        - Set header `X-Bidder-Requirement` on doRequest
        - For authenticated users (non-guest): set X-Bidder-Status based on their payment_methods, X-Bidder-Requirement same way
      </steps>
      <test_steps>
        1. Connect as unregistered guest — verify X-Bidder-Status: guest in DO
        2. Register as bidder (no card) — reconnect — verify X-Bidder-Status: registered
        3. Add card — reconnect — verify X-Bidder-Status: card_on_file
        4. Set auction override to 'card_on_file' — verify X-Bidder-Requirement reflects override not org default
      </test_steps>
      <review></review>
    </task>

    <task id="do-gating" priority="1" category="functional">
      <title>Durable Object — Chat/Bid Gating by Bidder Status</title>
      <description>
        Add bidder requirement to DO state and gate chat/bid/claim based on socket attachment's bidder status.
        Send typed rejection message so client can show appropriate registration flow.
      </description>
      <steps>
        - In `src/auction/types.ts`: add `| { type: "registration_required"; requirement: BidderRequirement }` to ServerMessage union
        - In `src/auction/durableObject.ts` SocketAttachment: add `bidderStatus: string` field
        - In webSocketOpen (or wherever attachment is created from headers): read X-Bidder-Status and X-Bidder-Requirement, store in attachment
        - In StoredState: add `bidderRequirement: string`, set from X-Bidder-Requirement during first connection (or handleInit)
        - Add private `checkBidderRequirement(ws): boolean` method: reads attachment bidderStatus, compares against state bidderRequirement using meetsRequirement(), sends registration_required if not met, returns false
        - Call checkBidderRequirement at top of handleChat, handleBid, handleClaim — return early if false
        - Import BidderRequirement type and meetsRequirement from `@/lib/bidder-requirement`
      </steps>
      <test_steps>
        1. Set org to card_on_file, connect as guest → send chat → receive registration_required with requirement: 'card_on_file'
        2. Set org to card_on_file, connect as registered (no card) → send bid → receive registration_required
        3. Set org to card_on_file, connect with card_on_file status → send chat → message goes through
        4. Set org to guest → all users can chat/bid regardless of status
        5. Set org to registered → guest gets rejected, registered user passes
      </test_steps>
      <review></review>
    </task>

    <task id="live-page-data" priority="1" category="functional">
      <title>LivePage — Fetch Bidder Requirement + Registration Status</title>
      <description>
        Modify LivePage RSC and its server function to fetch the effective bidder requirement and
        check if the current guest is already registered. Pass both to LiveViewerClient.
      </description>
      <steps>
        - In `src/app/pages/live/server-functions/live.ts`: modify getAuctionBySlug to join organizations table, select org.bidderRequirement and auction.bidderRequirement
        - Add `getGuestRegistrationStatus(guestId: string)` function: query bidder_registrations by guestId, if found check payment_methods for userId, return { registered, hasCard, userId, userName }
        - In `src/app/pages/live/LivePage.tsx`: call getGuestRegistrationStatus with ctx.guest.id, resolve effective bidder requirement, pass `bidderRequirement` and `existingRegistration` to LiveViewerClient
        - Update LiveAuctionData interface in LiveViewerClient to include bidderRequirement
        - Add ExistingRegistration type: { registered: boolean, hasCard: boolean, userId?: string, userName?: string }
      </steps>
      <test_steps>
        1. Visit /live/:slug — verify bidderRequirement prop matches org setting
        2. Set auction override — verify bidderRequirement reflects override
        3. As returning registered guest — verify existingRegistration.registered = true
        4. As new guest — verify existingRegistration.registered = false
      </test_steps>
      <review></review>
    </task>

    <task id="csp-stripe" priority="1" category="infrastructure">
      <title>CSP Headers — Add Stripe Domains for Live Pages</title>
      <description>
        Update setLiveCSP() to allow Stripe JS, API, and iframe domains so Payment Element loads on live pages.
      </description>
      <steps>
        - In `src/app/headers.ts` setLiveCSP():
        - Add `https://js.stripe.com` to script-src
        - Add `https://js.stripe.com` to frame-src
        - Add `https://api.stripe.com` to connect-src
        - Add `https://r.stripe.com` to connect-src (Stripe analytics/fraud detection)
      </steps>
      <test_steps>
        1. Load /live/:slug — verify no CSP errors in console
        2. Mount Stripe Payment Element — verify iframe loads without CSP block
        3. Complete a test SetupIntent — verify API calls to stripe.com succeed
      </test_steps>
      <review></review>
    </task>

    <task id="registration-panel" priority="1" category="functional">
      <title>Registration Slide-Up Panel Component</title>
      <description>
        "use client" component that replaces the current name prompt in LiveViewerClient. Three variants
        based on bidder requirement tier. For card_on_file, integrates Stripe Payment Element with
        Apple Pay / Google Pay support.
      </description>
      <steps>
        - Create `src/app/pages/live/RegistrationPanel.tsx` ("use client")
        - Props: `{ requirement: BidderRequirement, onComplete: (registration: CompletedRegistration) => void, onCancel: () => void, guestId: string }`
        - Guest tier: simple name input + "Join" button (extracted from current LiveViewerClient name prompt logic)
        - Registered tier: name + email inputs + "Register" button → calls createBidder (no Stripe step) → onComplete
        - Card_on_file tier: two-step flow in single panel:
          - Step 1: name + email → "Continue" → calls createBidderAndSetupIntent → receives clientSecret
          - Step 2: mount `<Elements>` with clientSecret → `<PaymentElement />` → "Save Card" → confirmSetup → savePaymentMethod → onComplete
        - Use `loadStripe(publishableKey)` at module level (cached)
        - Slide-up animation: fixed bottom, slide up with transition, backdrop overlay
        - Mobile-friendly: 48px touch targets, 18px base font per DESIGN.md
        - Loading states: disable buttons during server calls, show spinner
        - Error states: show inline errors for validation, toast for server errors
      </steps>
      <test_steps>
        1. Render with requirement='guest' — verify name-only form
        2. Render with requirement='registered' — verify name + email form, submit creates bidder
        3. Render with requirement='card_on_file' — verify two-step flow: name/email → Stripe Payment Element
        4. Complete card_on_file flow with test card 4242... — verify onComplete called with registration data
        5. Test Apple Pay button appears on Safari (Stripe test mode)
        6. Test validation: empty name → error, invalid email → error
        7. Test cancel: backdrop tap or X button → onCancel called
        8. Verify mobile layout: touch targets, font sizes, no horizontal scroll
      </test_steps>
      <review></review>
    </task>

    <task id="live-viewer-integration" priority="2" category="functional">
      <title>LiveViewerClient — Integrate Registration Panel + Reconnect</title>
      <description>
        Replace the inline name prompt with RegistrationPanel. Handle DO registration_required messages.
        Reconnect WebSocket after registration with updated bidder status. Add pre-registration banner.
      </description>
      <steps>
        - In `src/app/pages/live/LiveViewerClient.tsx`:
        - Add props: `bidderRequirement: BidderRequirement`, `existingRegistration: ExistingRegistration | null`
        - Remove inline name prompt logic (showNamePrompt state, name input JSX)
        - Add state: `showRegistration: boolean`, `registrationComplete: boolean`
        - If existingRegistration.registered and (existingRegistration.hasCard or requirement != card_on_file): set registrationComplete=true, skip registration
        - On chat input tap or bid button: if !registrationComplete, setShowRegistration(true)
        - On DO message type "registration_required": setShowRegistration(true)
        - Render `<RegistrationPanel>` when showRegistration=true
        - On registration complete: update guest cookie/name, increment WS reconnect trigger (existing pattern), setRegistrationComplete(true), setShowRegistration(false)
        - Add "Register to Bid" banner: shown when bidderRequirement > 'guest' and !registrationComplete, positioned above chat, subtle styling, clicking opens registration panel
        - Set guest name cookie after registration via setGuestName server function
      </steps>
      <test_steps>
        1. Load live page with org set to 'guest' — verify current behavior unchanged (name prompt on chat)
        2. Load with org set to 'card_on_file' — tap chat → registration panel opens with card form
        3. Complete registration → verify WS reconnects → verify can now chat
        4. Refresh page → verify returning user skips registration (cookie linkage)
        5. Verify "Register to Bid" banner shown for card_on_file, hidden for guest tier
        6. Click banner → registration panel opens
        7. After registration, banner disappears
      </test_steps>
      <review></review>
    </task>

    <task id="admin-settings" priority="2" category="functional">
      <title>Admin Settings Page — Org Bidder Requirement</title>
      <description>
        Build the admin settings page (currently placeholder) with bidder requirement dropdown.
        Show Stripe Connect status (connected or not). Route already wired to Placeholder.
      </description>
      <steps>
        - Create `src/app/pages/admin/settings/server-functions/settings.ts` ("use server"): getOrgSettings(orgId) returns { bidderRequirement, stripeConnectAccountId }, updateOrgSettings(orgId, { bidderRequirement }) updates org — reject if any auction in org is currently live/closing (prevent mid-auction tier change)
        - Create `src/app/pages/admin/settings/AdminSettingsPage.tsx` (RSC): fetch org settings, pass to client
        - Create `src/app/pages/admin/settings/AdminSettingsClient.tsx` ("use client"): form with bidderRequirement select (Guest / Registered / Card on File), Stripe status display, save button with useTransition
        - Update `src/worker.tsx`: replace Placeholder with AdminSettingsPage for /admin/settings route
        - Use existing admin page patterns: Card wrapper, form layout, Alert for errors, Button with isPending disabled
      </steps>
      <test_steps>
        1. Navigate to /admin/settings — verify page loads with current org bidderRequirement
        2. Change to 'card_on_file' → save → refresh → verify persisted
        3. Change to 'guest' → save → verify persisted
        4. Verify Stripe Connect status shows correctly (will show "not connected" until manual setup)
        5. Non-admin user cannot access settings page (requireAdmin interceptor)
      </test_steps>
      <review></review>
    </task>

    <task id="auction-form-override" priority="2" category="functional">
      <title>Auction Form — Bidder Requirement Override Dropdown</title>
      <description>
        Add a bidder requirement override dropdown to the auction create/edit form. Options: "Use Org Default" (null),
        Guest, Registered, Card on File. Persisted in auctions.bidderRequirement column.
      </description>
      <steps>
        - In `src/app/pages/admin/auctions/AdminAuctionFormClient.tsx`:
        - Add bidderRequirement state, initialize from auction prop (null for new)
        - Add Select dropdown in Bidding section: label "Bidder Requirement", options: "Org Default" (value: ""), Guest, Registered, Card on File
        - Pass bidderRequirement to create/update server function (convert "" to null)
        - In `src/app/pages/admin/auctions/server-functions/auctions.ts`:
        - Add bidderRequirement to createAuction and updateAuction data types and DB insert/update
      </steps>
      <test_steps>
        1. Create new auction — verify "Org Default" selected by default
        2. Set to "Card on File" → save → edit → verify persisted
        3. Set to "Org Default" → save → verify null in DB
        4. Visit /live/:slug for auction with override — verify effective requirement matches auction override
      </test_steps>
      <review></review>
    </task>

    <task id="stripe-webhook" priority="3" category="infrastructure">
      <title>Stripe Webhook Handler — Payment Method Sync</title>
      <description>
        Webhook endpoint to keep payment_methods table in sync with Stripe events.
        Handles card updates and detachment. Light touch — just data sync for now.
      </description>
      <steps>
        - Create `src/stripe/webhook.ts`: export `handleStripeWebhook(request: Request): Promise<Response>`
        - Read body with `request.text()` (once), get stripe-signature header
        - Verify with `stripe.webhooks.constructEventAsync(body, sig, env.STRIPE_WEBHOOK_SECRET, undefined, cryptoProvider)`
        - Handle `payment_method.updated`: update last4, brand, expMonth, expYear in payment_methods table by stripePaymentMethodId
        - Handle `payment_method.detached`: update status to 'detached' in payment_methods table
        - Return 200 for handled events, 200 for unhandled (don't retry)
        - In `src/worker.tsx`: add pre-render interceptor checking `POST /api/stripe/webhook` → call handleStripeWebhook, return response before render pipeline
      </steps>
      <test_steps>
        1. Send test webhook from Stripe CLI: `stripe trigger payment_method.updated` — verify payment_methods row updated
        2. Send `payment_method.detached` — verify status changed to 'detached'
        3. Send invalid signature — verify 400 response
        4. Send unhandled event type — verify 200 response (no error)
        5. Verify endpoint accessible at POST /api/stripe/webhook
      </test_steps>
      <review></review>
    </task>

    <task id="terms-acceptance" priority="2" category="functional">
      <title>Terms Acceptance in Registration Flow</title>
      <description>
        Add terms acceptance checkbox to RegistrationPanel for registered and card_on_file tiers.
        Record acceptance in terms_acceptances table. Platform terms required for all bidders.
        Per-org terms deferred (schema supports it, UI later).
      </description>
      <steps>
        - In RegistrationPanel: add "I agree to the Terms of Service" checkbox with link, required before submit (for registered + card_on_file tiers only)
        - In createBidder and createBidderAndSetupIntent: accept `acceptedTermsVersion` param, insert terms_acceptances row (termsType: 'platform', organizationId: null, ipAddress from request)
        - Create `src/app/pages/terms.tsx` or static route for platform terms page (placeholder content for now)
        - Terms version: use a constant like CURRENT_PLATFORM_TERMS_VERSION = '2026-03-01' — bump when terms change
        - Per-org terms: schema supports organizationId on terms_acceptances, but UI deferred. Org admins can add their terms text later
      </steps>
      <test_steps>
        1. Register as card_on_file — verify checkbox required, cannot submit without it
        2. After registration — verify terms_acceptances row created with correct version and IP
        3. Guest tier — verify no terms checkbox shown (name-only prompt)
        4. Terms link — verify opens terms page
      </test_steps>
      <review></review>
    </task>

    <task id="apple-pay-domain" priority="3" category="infrastructure">
      <title>Apple Pay Domain Verification</title>
      <description>
        Serve the Apple Pay domain verification file and register domains in Stripe Dashboard
        so Apple Pay appears in the Payment Element on Safari/iOS.
      </description>
      <steps>
        - Use Stripe API to register domains programmatically: `stripe.applePayDomains.create({ domain_name: '...' })` — call once per domain as a setup step (server function or one-off script)
        - Stripe API registration handles both the domain verification file serving AND the domain registration in one step — no manual Dashboard work needed
        - Register both prod (auction.digitalglue.dev) and staging (staging-auction.digitalglue.dev)
        - In `src/worker.tsx`: add pre-render interceptor for `GET /.well-known/apple-developer-merchantid-domain-association` — serve the verification file content (Stripe provides this after domain registration via API)
        - Store verification file content as a constant or env var — it's account-specific but static once generated
      </steps>
      <test_steps>
        1. GET /.well-known/apple-developer-merchantid-domain-association — verify returns verification content
        2. Check Stripe Dashboard — verify domains registered
        3. Load Payment Element on Safari — verify Apple Pay button appears (Stripe test mode)
      </test_steps>
      <review></review>
    </task>
  </tasks>

  <implementation_notes>
    <note id="username-strategy">
      users.username is TEXT NOT NULL UNIQUE. Bidder users use email as username.
      Duplicate email → reuse existing user (already in spec). This avoids schema changes
      to the auth-critical username column.
    </note>
    <note id="displayname">
      Set displayName = name when creating bidder users. The WS upgrade handler reads
      displayName for X-Username header — without this, bidder users show as "Guest" in chat.
    </note>
    <note id="mid-auction-tier-change">
      Deny org bidderRequirement changes while any auction in that org has status 'live' or 'closing'.
      Simple guard in updateOrgSettings — query auctions table, throw if any are active.
      Per-auction override changes also denied while that auction is live/closing.
    </note>
    <note id="email-verification">
      No email verification for v1. Card-on-file requirement is the primary fraud deterrent
      (Stripe verifies cardholder). Email verification is a future enhancement.
      Known risk: duplicate email reuse means someone could claim another's bidder account
      by entering their email. Mitigated by: card_on_file tier requires Stripe card anyway,
      and registered tier is low-stakes (name + email only).
    </note>
    <note id="rate-limiting">
      Registration attempts rate-limited: 3 per guestId per hour.
      Prevents Stripe Customer spam. Implement via D1 query counting recent
      bidder_registrations.createdAt for the guestId.
    </note>
    <note id="auth-flow-safety">
      checkUsername() in src/auth/functions.ts must handle authMethod 'bidder'.
      If a bidder user tries admin login, show "This account was created for bidding.
      Contact support to upgrade." Prevents confusing error states.
    </note>
    <note id="payment-method-status">
      payment_methods.status valid values: 'active' (default), 'detached' (card removed from Stripe),
      'expired' (card past expiry date). Webhook handles 'detached'. 'expired' can be set
      via webhook (payment_method.updated with expired data) or periodic check.
    </note>
    <note id="ws-upgrade-latency">
      WS upgrade path gains 2 D1 queries (bidder_registrations + payment_methods lookup).
      Adds ~5-20ms. Acceptable for v1. Can cache in cookie later if bottleneck.
    </note>
  </implementation_notes>

  <success_criteria>
    - Org admin can set bidder requirement to guest/registered/card_on_file in settings
    - Per-auction override works (null = org default, specific value overrides)
    - Live viewer: stream loads instantly with no registration wall
    - Chat/bid gated by effective requirement: guest sees name prompt, registered sees name+email, card_on_file sees name+email+Stripe form
    - Stripe Payment Element renders with Apple Pay / Google Pay when available
    - Card successfully stored via SetupIntent, payment_methods row created
    - Returning registered user skips registration (guest cookie → bidder_registration lookup)
    - DO rejects chat/bid with typed registration_required message when requirements not met
    - Webhook keeps payment_methods in sync with Stripe events
    - No regression to existing zero-friction viewing experience
  </success_criteria>
</project_specification>
