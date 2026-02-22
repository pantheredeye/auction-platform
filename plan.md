# Auction Platform — Phase 1 Plan (Updated)

## Context

Live auction platform for M&M Auctions (Senatobia, MS) — liquidation/overstock house selling food, household items, cleaning supplies. Kody (auctioneer) runs consumer + dealer auctions with Shopify inventory. Whatnot-inspired, mobile-first, live-stream bidding. Owner retains code, may market to other auction houses (multi-tenant from day one).

Revenue model: hammer fee (1.5-3% per sale, paid by auction house to platform, default 3%) configured per org by platform admin. Buyer's premium (schema-ready, disabled Phase 1). App is system of record; Shopify is downstream sync target.

Phase 1 scope: Consumer live auctions only (UI), but schema + engine designed for all three types (live consumer, dealer bulk, buy-now). Passkey + password auth. Stripe basic (payment links). Shopify catalog import. Local pickup scheduling.

---

## Architecture (Clarified)

| Concern | Service |
|---|---|
| Persistent relational data (users, orgs, products, auctions, bids, invoices, orders) | **D1** (Kysely) |
| Live auction real-time state (bids, timers, WebSocket) | **AuctionRoomDO** (in-memory + alarms) |
| Auth sessions | **SessionDO** (or KV — decide during build) |
| Images, media | **R2** |
| Async jobs (bid flush, post-auction, Shopify import) | **Queues** |
| Video streaming | **Cloudflare Stream** (Phase 1 only; Zoom fallback deferred) |
| Bot protection | **Turnstile** |
| Scheduled auction transitions | **Cron Triggers** |
| Edge rendering | **Workers + RWSDK (RSC)** |

**Key departure from template:** Template uses a Database DO with SQLite for all persistent data. We replace that with D1 — proper serverless SQL, accessible from any worker, supports migrations, better for multi-tenant queries and admin/reporting. AuctionRoomDO keeps its own in-memory state for hot real-time auction data, then flushes events to D1 via Queue.

---

## 1. Repo Setup

Source: Fork `/home/ptre/code/github/templates/rwsdk-multi-tenant-starter`

- Rename in package.json, wrangler.jsonc
- **Replace Database DO pattern with D1** — swap Kysely DO-SQLite adapter for `kysely-d1`
- Update branding (app name, RP ID, org defaults)
- Remove DigitalGlueFooter.tsx
- Add deps: date-fns, stripe
- Add theme-color + apple-mobile-web-app-capable meta in Document.tsx
- Update CSP in headers.ts for Cloudflare Stream iframes
- Deploy: `pnpm release` (no CI/CD pipeline needed)

Template provides (keep):
- RWSDK + Cloudflare Workers + Vite + React 19 RSC
- WebAuthn passkey auth + session DO
- Multi-tenant: users, orgs, memberships, credentials
- shadcn (new-york) + Tailwind 4 + Radix + Lucide
- Interruptors, server function patterns

Reuse from quality-garden:
- Password auth pattern
- Audit log pattern
- User management/approval pattern
- Role-based authorization checks

---

## 2. Wrangler Config

```jsonc
{
  "name": "auction-platform",
  "d1_databases": [
    { "binding": "DB", "database_name": "auction-platform-db", "database_id": "..." }
  ],
  "durable_objects": {
    "bindings": [
      { "name": "SESSION_DURABLE_OBJECT", "class_name": "SessionDurableObject" },
      { "name": "AUCTION_ROOM", "class_name": "AuctionRoomDO" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["SessionDurableObject"] },
    { "tag": "v2", "new_classes": ["AuctionRoomDO"] }
  ],
  "r2_buckets": [
    { "binding": "IMAGES_BUCKET", "bucket_name": "auction-platform-images" }
  ],
  "queues": {
    "producers": [
      { "queue": "bid-events", "binding": "BID_EVENTS_QUEUE" },
      { "queue": "post-auction", "binding": "POST_AUCTION_QUEUE" },
      { "queue": "shopify-import", "binding": "SHOPIFY_IMPORT_QUEUE" }
    ],
    "consumers": [
      { "queue": "bid-events", "max_batch_size": 50, "max_batch_timeout": 5 },
      { "queue": "post-auction", "max_batch_size": 10, "max_batch_timeout": 10 },
      { "queue": "shopify-import", "max_batch_size": 5, "max_batch_timeout": 30 }
    ]
  },
  "triggers": {
    "crons": ["*/1 * * * *"]
  }
}
```

Secrets: STRIPE_SECRET_KEY, SHOPIFY_API_TOKEN, CLOUDFLARE_STREAM_API_TOKEN, CLOUDFLARE_STREAM_ACCOUNT_ID

Turnstile: TURNSTILE_SITE_KEY (var), TURNSTILE_SECRET_KEY (secret)

---

## 3. Schema (D1 Migrations)

Extends template's existing tables (users, credentials, organizations, memberships). All new tables get organizationId + index. Money as integer cents. IDs as UUIDv4. Soft deletes where appropriate. Optimistic locking (version column) on mutable entities.

### Migration 002: User Profile Extension + Password Auth + Roles

```sql
-- Add to users
ALTER TABLE users ADD COLUMN displayName TEXT;
ALTER TABLE users ADD COLUMN avatarUrl TEXT;
ALTER TABLE users ADD COLUMN addressLine1 TEXT;
ALTER TABLE users ADD COLUMN addressLine2 TEXT;
ALTER TABLE users ADD COLUMN city TEXT;
ALTER TABLE users ADD COLUMN state TEXT;
ALTER TABLE users ADD COLUMN zip TEXT;
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN passwordHash TEXT;
ALTER TABLE users ADD COLUMN authMethod TEXT NOT NULL DEFAULT 'passkey'; -- passkey|password|both
ALTER TABLE users ADD COLUMN failedLoginAttempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN lockoutUntil TEXT;
ALTER TABLE users ADD COLUMN isPlatformAdmin INTEGER NOT NULL DEFAULT 0; -- hardcode for app owner

-- Add hammer fee to organizations (platform revenue — per-org, set by platform admin)
ALTER TABLE organizations ADD COLUMN hammerFeePct INTEGER NOT NULL DEFAULT 300; -- 300 = 3.0%, range 150-300

-- Add role to memberships (replaces flat userType)
ALTER TABLE memberships ADD COLUMN role TEXT NOT NULL DEFAULT 'consumer';
-- roles: super_admin, admin, auctioneer, catalog_manager, customer_service, shipping, dealer, consumer
ALTER TABLE memberships ADD COLUMN isApproved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memberships ADD COLUMN approvedAt TEXT;
ALTER TABLE memberships ADD COLUMN approvedByUserId TEXT;
```

### Migration 003: Dealer Profiles

```sql
CREATE TABLE dealer_profiles (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  companyName TEXT,
  taxId TEXT,
  resaleCertificateUrl TEXT, -- R2 key
  tier TEXT NOT NULL DEFAULT 'standard', -- standard|silver|gold|platinum
  creditTerms TEXT, -- 'net-30' etc — Kody's offline arrangement, not platform-managed
  depositRequiredCents INTEGER,
  totalPurchasesCents INTEGER NOT NULL DEFAULT 0,
  totalAuctionsParticipated INTEGER NOT NULL DEFAULT 0,
  standing TEXT NOT NULL DEFAULT 'good', -- good|warning|suspended
  notes TEXT, -- internal admin notes
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_dealer_profiles_org ON dealer_profiles(organizationId);
CREATE UNIQUE INDEX idx_dealer_profiles_user ON dealer_profiles(userId);
```

### Migration 004: Audit Log

```sql
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  userId TEXT,
  entityType TEXT NOT NULL,
  entityId TEXT NOT NULL,
  action TEXT NOT NULL,
  changes TEXT, -- JSON
  createdAt TEXT NOT NULL
);
CREATE INDEX idx_audit_logs_org ON audit_logs(organizationId);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entityType, entityId);
```

### Migration 005: Categories + Products (with perishable fields)

```sql
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  parentId TEXT REFERENCES categories(id),
  sortOrder INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);
CREATE INDEX idx_categories_org ON categories(organizationId);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  categoryId TEXT REFERENCES categories(id),
  sku TEXT,
  title TEXT NOT NULL,
  description TEXT,
  conditionType TEXT, -- new|like_new|good|fair|damaged
  retailPriceCents INTEGER,
  quantity INTEGER NOT NULL DEFAULT 1,
  quantityAvailable INTEGER NOT NULL DEFAULT 1,
  -- Perishable fields (first-class for food auctions)
  isPerishable INTEGER NOT NULL DEFAULT 0,
  expiryDate TEXT,
  coldChainRequired INTEGER NOT NULL DEFAULT 0,
  storageTemp TEXT, -- 'frozen|refrigerated|room_temp'
  handlingInstructions TEXT,
  -- Images
  imageUrls TEXT, -- JSON array of R2 keys
  thumbnailUrl TEXT,
  -- Shopify link
  shopifyProductId TEXT,
  shopifyVariantId TEXT,
  -- Metadata
  tags TEXT, -- JSON array
  metadata TEXT, -- JSON
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_products_org ON products(organizationId);
CREATE INDEX idx_products_shopify ON products(shopifyProductId);
CREATE INDEX idx_products_perishable ON products(organizationId, isPerishable, expiryDate);
```

### Migration 006: Auctions + Lots + State Machine + Lot Grouping

```sql
CREATE TABLE auctions (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- live_consumer|dealer_bulk|buy_now
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  -- lifecycle: draft|scheduled|preview|live|closing|closed|settled|archived
  scheduledStartAt TEXT,
  actualStartAt TEXT,
  actualEndAt TEXT,
  -- Config
  defaultIncrementCents INTEGER NOT NULL DEFAULT 100, -- $1 default
  incrementRules TEXT, -- JSON: tiered rules e.g. [{"upTo":5000,"increment":100},{"upTo":25000,"increment":500}]
  buyerPremiumPct INTEGER NOT NULL DEFAULT 0, -- stored as whole number, e.g. 10 = 10%. Disabled Phase 1 (schema-ready)
  extensionSeconds INTEGER NOT NULL DEFAULT 15,
  -- Stream
  streamProviderId TEXT,
  streamUrl TEXT,
  -- Auctioneer
  auctioneerId TEXT REFERENCES users(id),
  createdByUserId TEXT NOT NULL REFERENCES users(id),
  -- Clone source
  clonedFromAuctionId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_auctions_org_status ON auctions(organizationId, status);
CREATE UNIQUE INDEX idx_auctions_slug ON auctions(organizationId, slug);

CREATE TABLE auction_state_transitions (
  id TEXT PRIMARY KEY,
  auctionId TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  fromStatus TEXT,
  toStatus TEXT NOT NULL,
  triggeredByUserId TEXT,
  reason TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX idx_ast_auction ON auction_state_transitions(auctionId);

CREATE TABLE lots (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  auctionId TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  lotNumber INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  -- Pricing
  startingPriceCents INTEGER NOT NULL DEFAULT 100,
  reservePriceCents INTEGER,
  buyNowPriceCents INTEGER,
  incrementCents INTEGER, -- per-lot override, null = use auction default
  -- State
  currentBidCents INTEGER,
  currentBidderId TEXT,
  bidCount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending|active|going_once|going_twice|sold|passed|withdrawn
  quantity INTEGER NOT NULL DEFAULT 1,
  extensionSeconds INTEGER, -- per-lot override
  closesAt TEXT,
  -- Winner
  winnerUserId TEXT,
  winnerAmountCents INTEGER,
  -- Image (can override product images)
  imageUrls TEXT, -- JSON
  thumbnailUrl TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_lots_auction ON lots(auctionId, lotNumber);

-- Lot grouping: a lot can contain multiple products
CREATE TABLE lot_items (
  id TEXT PRIMARY KEY,
  lotId TEXT NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  productId TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  sortOrder INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_lot_items_lot ON lot_items(lotId);
```

### Migration 007: Bid Events (Event Sourcing)

```sql
CREATE TABLE bid_events (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  auctionId TEXT NOT NULL,
  lotId TEXT NOT NULL,
  userId TEXT NOT NULL,
  type TEXT NOT NULL, -- bid|auto_bid|retract|system_extend|floor_bid
  amountCents INTEGER NOT NULL,
  previousHighCents INTEGER,
  previousHighUserId TEXT,
  -- floor_bid: placed by auctioneer on behalf of phone/in-person bidder
  onBehalfOfName TEXT, -- nullable, for floor bids
  placedByUserId TEXT, -- the auctioneer who placed it (for floor_bid type)
  idempotencyKey TEXT NOT NULL UNIQUE,
  sequence INTEGER NOT NULL, -- per-lot monotonic
  metadata TEXT, -- JSON
  createdAt TEXT NOT NULL
);
CREATE INDEX idx_bid_events_lot_seq ON bid_events(lotId, sequence);
CREATE INDEX idx_bid_events_auction ON bid_events(auctionId);
CREATE INDEX idx_bid_events_user ON bid_events(userId);
```

### Migration 008: Chat Messages

```sql
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  auctionId TEXT NOT NULL,
  userId TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'message', -- message|reaction|system
  content TEXT NOT NULL, -- text for messages, emoji code for reactions
  isModerated INTEGER NOT NULL DEFAULT 0,
  moderatedByUserId TEXT,
  moderatedAt TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX idx_chat_auction ON chat_messages(auctionId, createdAt);
```

### Migration 009: Fee Configurations

```sql
CREATE TABLE fee_configurations (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  feeType TEXT NOT NULL, -- buyer_premium|shipping|pickup|dealer_discount
  calculationType TEXT NOT NULL, -- percentage|flat|tiered
  value INTEGER, -- cents for flat, whole number for pct (10 = 10%)
  tieredRules TEXT, -- JSON
  appliesToRole TEXT, -- null = all, or 'consumer'|'dealer'
  appliesToAuctionType TEXT, -- null = all, or 'live_consumer'|'dealer_bulk'
  isActive INTEGER NOT NULL DEFAULT 1,
  effectiveDate TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_fee_config_org ON fee_configurations(organizationId, isActive);
```

### Migration 010: Orders + Invoices

```sql
-- Orders represent individual won lots
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  auctionId TEXT NOT NULL,
  lotId TEXT NOT NULL,
  userId TEXT NOT NULL, -- winner
  amountCents INTEGER NOT NULL,
  premiumCents INTEGER NOT NULL, -- buyer's premium (disabled Phase 1, will be 0)
  platformFeeCents INTEGER NOT NULL DEFAULT 0, -- hammer fee owed to platform
  status TEXT NOT NULL DEFAULT 'won',
  -- won|invoiced|paid|packed|picked_up|shipped|delivered|refunded|disputed
  invoiceId TEXT, -- linked after invoice generation
  idempotencyKey TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_orders_user ON orders(userId, status);
CREATE INDEX idx_orders_auction ON orders(auctionId);
CREATE INDEX idx_orders_invoice ON orders(invoiceId);

-- Invoices aggregate orders per user per auction
CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  userId TEXT NOT NULL,
  auctionId TEXT NOT NULL,
  invoiceNumber TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending|sent|paid|fulfilled|refunded
  subtotalCents INTEGER NOT NULL,
  buyerPremiumCents INTEGER NOT NULL,
  taxCents INTEGER NOT NULL DEFAULT 0,
  totalCents INTEGER NOT NULL,
  stripePaymentLinkId TEXT,
  stripePaymentLinkUrl TEXT,
  paidAt TEXT,
  dueAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_invoices_user ON invoices(userId);
CREATE INDEX idx_invoices_org_status ON invoices(organizationId, status);

CREATE TABLE invoice_line_items (
  id TEXT PRIMARY KEY,
  invoiceId TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  orderId TEXT NOT NULL REFERENCES orders(id),
  lotId TEXT NOT NULL,
  description TEXT NOT NULL,
  amountCents INTEGER NOT NULL,
  buyerPremiumCents INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_invoice_items ON invoice_line_items(invoiceId);
```

### Migration 011: Pickup Scheduling

```sql
CREATE TABLE pickup_slots (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  startTime TEXT NOT NULL,
  endTime TEXT NOT NULL,
  maxCapacity INTEGER NOT NULL,
  currentBookings INTEGER NOT NULL DEFAULT 0,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_pickup_slots_org_date ON pickup_slots(organizationId, date);

CREATE TABLE pickup_reservations (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pickupSlotId TEXT NOT NULL REFERENCES pickup_slots(id),
  invoiceId TEXT NOT NULL REFERENCES invoices(id),
  userId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',
  -- reserved|confirmed|picked_up|no_show|cancelled
  idempotencyKey TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_pickup_res_slot ON pickup_reservations(pickupSlotId);
CREATE INDEX idx_pickup_res_user ON pickup_reservations(userId);
```

### Migration 012: Stream Providers + Import Jobs

```sql
CREATE TABLE stream_providers (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  providerType TEXT NOT NULL DEFAULT 'cloudflare_stream',
  name TEXT NOT NULL,
  config TEXT, -- JSON (API keys, account IDs)
  isDefault INTEGER NOT NULL DEFAULT 1,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source TEXT NOT NULL, -- shopify|csv
  status TEXT NOT NULL DEFAULT 'pending', -- pending|running|completed|failed
  totalItems INTEGER NOT NULL DEFAULT 0,
  processedItems INTEGER NOT NULL DEFAULT 0,
  failedItems INTEGER NOT NULL DEFAULT 0,
  errorLog TEXT, -- JSON
  config TEXT, -- JSON
  createdByUserId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
```

### Migration 013: Denormalized Read Models

```sql
CREATE TABLE auction_summaries (
  auctionId TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  totalLots INTEGER NOT NULL DEFAULT 0,
  activeLotNumber INTEGER,
  totalBids INTEGER NOT NULL DEFAULT 0,
  totalRevenueCents INTEGER NOT NULL DEFAULT 0,
  viewerCount INTEGER NOT NULL DEFAULT 0,
  scheduledStartAt TEXT,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_auction_summaries_org ON auction_summaries(organizationId, status);
```

---

## 4. AuctionRoomDO (Durable Object)

One DO instance per live auction. Uses WebSocket Hibernation API. Instance ID: `env.AUCTION_ROOM.idFromName(auctionId)`.

**In-memory state:** auctionId, orgId, status, currentLot (price, bidder, bidCount, timers, increment), bidSequence counter, pending bid event buffer, viewer count, connected bidder set.

**WebSocket protocol (JSON):**

Client -> Server:
- `bid` — place bid (amountCents, idempotencyKey)
- `auto_bid` — set max auto-bid (maxCents)
- `chat` — send chat message (content)
- `reaction` — send emoji reaction (emoji)
- `ping`

Server -> Client:
- `bid_accepted` — bid confirmed
- `bid_rejected` — bid rejected (reason)
- `new_high_bid` — broadcast new high bid (amount, bidder display name, bid count)
- `outbid` — targeted to previous high bidder
- `lot_changed` — new active lot
- `lot_status` — going_once / going_twice / sold / passed
- `auction_status` — auction state changes
- `viewer_count` — periodic broadcast
- `countdown` — timer updates
- `stream_url` — video stream URL
- `chat_message` — broadcast chat message
- `reaction_burst` — batched emoji reactions
- `error` / `pong`

Admin -> Server:
- `admin_start_lot` — activate next lot
- `admin_pass_lot` — skip/pass current lot
- `admin_pause` / `admin_resume`
- `admin_set_stream_url` — update stream URL
- `admin_retract_bid` — remove a bid
- `admin_floor_bid` — place bid on behalf of phone/in-person bidder (amountCents, bidderName)
- `admin_going_once` / `admin_going_twice` / `admin_sold` — manual auctioneer controls

**Bid increments:** Resolved per-bid from lot.incrementCents (override) -> auction.incrementRules (tiered JSON) -> auction.defaultIncrementCents (flat fallback). Bid validation: `newBid >= currentBid + effectiveIncrement`.

**Anti-snipe:** If bid arrives within extensionSeconds of closesAt, extend timer and broadcast new countdown.

**Timers:** DO alarms for going_once -> going_twice -> sold transitions. Configurable duration. Auctioneer can also trigger these manually.

**Floor bids:** Auctioneer console sends `admin_floor_bid` with bidder name + amount. Creates a bid_event with type=floor_bid, onBehalfOfName populated. Displayed differently in bid feed ("Floor: $25 — John (phone)").

**Chat:** Messages broadcast to all connected clients. Basic moderation: admin can delete messages (removes from broadcast, flags in D1). Rate limit: max 1 message per 2 seconds per user. No profanity filter in Phase 1 — admin moderation only.

**Outbox pattern:** Buffer bid events + chat messages, flush to BID_EVENTS_QUEUE every 10 events, every 5s, or on lot close. Queue consumer writes to D1 + updates denormalized tables.

---

## 5. Cron Trigger

Runs every minute. Checks D1 for auctions where:
- `status = 'scheduled'` AND `scheduledStartAt <= now()` -> transition to `preview`
- `status = 'preview'` AND `scheduledStartAt + previewDuration <= now()` -> transition to `live` (optional auto-go-live)

**Note:** Auctioneer will typically go live manually via the console. Cron handles the scheduled->preview transition so bidders can browse lots before start. The preview->live auto-transition is configurable (can be disabled per auction if auctioneer wants manual control).

---

## 6. Queue Handlers

Export `queue()` handler alongside `fetch` in worker.tsx:

- **bid-events:** Batch insert bid_events to D1, update lots denormalized fields (currentBidCents, currentBidderId, bidCount), update auction_summaries. Also insert chat_messages.
- **post-auction:** Generate orders (one per winning lot per user), calculate platformFeeCents per order (hammerPrice * org.hammerFeePct / 10000), aggregate into invoices (buyer's premium disabled Phase 1 — premiumCents=0), create Stripe payment links, update auction_summaries.
- **shopify-import:** Paginate Shopify REST API, map products to schema, download images to R2, track progress in import_jobs. Dedup by shopifyProductId.

---

## 7. Stripe Basic (Payment Links)

Phase 1 approach: generate Stripe Payment Links for invoices.

Flow:
1. Auction closes -> post-auction queue generates orders + invoices
2. For each invoice, call `stripe.paymentLinks.create()` with line items
3. Store stripePaymentLinkUrl on invoice
4. User sees "Pay Invoice" button linking to Stripe hosted page
5. Stripe webhook (checkout.session.completed) -> mark invoice as paid, update related orders to `paid`

Scales to card-on-file + pre-auth in Phase 2 — additive, not a rewrite.

---

## 8. Cloudflare Stream (Phase 1 Only)

Single provider for Phase 1: Cloudflare Stream.

- RTMPS ingest URL for auctioneer (OBS, phone camera app, or browser-based)
- HLS/WebRTC low-latency playback for bidders
- Admin configures stream provider in org settings
- AuctionRoomDO broadcasts stream URL to connected clients
- Stream status indicator in auction room UI (live/offline/starting soon)

**Zoom fallback deferred.** StreamProvider interface still exists in code (good architecture) but only CloudflareStreamProvider is implemented. Zoom implementation is Phase 4+ if needed.

---

## 9. Shopify Catalog Import

Queue-based paginated import:
1. Admin enters Shopify store URL + API token
2. Server function validates credentials, creates import_job, enqueues first page
3. Queue consumer fetches 250 products/page, maps fields, downloads images to R2, inserts to products table
4. Deduplication by shopifyProductId — re-import updates, doesn't duplicate
5. Admin polls job status for progress

App is system of record. One-way pull for Phase 1. Bidirectional sync (push results back) is Phase 5.

---

## 10. Local Pickup Scheduling

Admin: create pickup slots (date, time window, capacity) on calendar view. Bulk create for recurring schedules.

Consumer: after invoice paid, select available slot. Capacity enforced atomically via `WHERE currentBookings < maxCapacity` in UPDATE.

Admin pickup day: view reservations per slot, mark picked_up or no_show.

---

## 11. Turnstile

Add Cloudflare Turnstile to:
- Registration form
- Login form
- Public bid page (if allowing anonymous browsing)

Lightweight — just a widget + server-side verification call.

---

## 12. Route Structure

```
/                           Landing (public, redirect if auth'd)
/auth/login                 Login (passkey + password)
/auth/register              Registration
/auth/logout                Clear session
/auctions                   Auction list (public browsing)
/auctions/:slug             Auction detail / preview
/auctions/:slug/live        Live auction room (auth required)

/dashboard                  User home (summary cards)
/my/bids                    My bid history
/my/invoices                My invoices
/my/invoices/:id            Invoice detail + pay + schedule pickup
/my/pickups                 My pickup reservations
/my/profile                 Edit profile

/admin                      Admin dashboard
/admin/auctions             Auction CRUD list
/admin/auctions/new         Create auction
/admin/auctions/:id/edit    Edit auction
/admin/auctions/:id/clone   Clone auction as new draft
/admin/auctions/:id/lots    Manage lots (drag reorder, lot grouping)
/admin/auctions/:id/auctioneer  Auctioneer console (live controls)
/admin/catalog              Product list
/admin/catalog/import       Shopify import
/admin/catalog/products/new Create product
/admin/catalog/products/:id Edit product
/admin/pickups              Pickup slot management
/admin/invoices             All invoices
/admin/orders               All orders (fulfillment view)
/admin/users                User/dealer management
/admin/users/:id            User detail (bid history, purchase history, notes)
/admin/settings             Org settings
/admin/settings/fees        Fee configuration
/admin/settings/stream      Stream provider config

/platform                   Platform admin dashboard (isPlatformAdmin only)
/platform/orgs              Manage tenant organizations
/platform/orgs/:id          Org detail — set hammer fee, status, notes
/platform/revenue           Platform revenue overview (hammer fees across orgs)
```

Interruptors: requireAuth, requirePlatformAdmin (isPlatformAdmin flag), requireAdmin (super_admin|admin), requireEmployee (auctioneer|catalog_manager|customer_service|shipping), requireDealer.

---

## 13. Mobile-First UI Shell

**Mobile (default):**
- Fixed bottom nav (5 tabs: Home, Auctions, My Bids, Invoices, Profile)
- Sticky top bar (logo, notification bell)
- Full-screen auction room (hides bottom nav): video stream top ~40%, current lot card + lot items list, sticky bid bar at bottom, lot queue as slide-in sheet, chat overlay on stream

**Desktop (md+):** Sidebar nav, wider content, multi-column admin layouts.

**Auction room UX:**
- One-tap bid buttons (increment-based: +$1, +$5, +$10, custom)
- Real-time price + countdown animation
- "Going Once / Going Twice / SOLD" visual overlays
- Chat panel (collapsible, overlays stream on mobile, side panel on desktop)
- Emoji reactions (floating overlay — fire, clap, wow, laugh)
- Lot queue: upcoming items, swipeable on mobile
- Bid confirmation toast
- Outbid alert

**Auctioneer console:**
- Same video feed + current lot + live bid feed
- Control buttons: Next Lot, Going Once, Going Twice, Sold, Pass, Pause
- Floor bid panel: enter amount + bidder name, submit
- Viewer/bidder count
- Chat moderation: delete messages inline
- Lot items displayed for current lot (for grouped lots)

**shadcn components to add:** dialog, sheet, tabs, badge, avatar, select, textarea, switch, toast/sonner, skeleton, table, dropdown-menu, alert, progress, calendar, popover

---

## 14. Directory Structure

```
src/
  worker.tsx                    # App entry, routing, queue handler, cron handler
  client.tsx                    # Client init
  db/
    index.ts                    # D1 Kysely setup + types
    migrations/                 # Numbered migration files
  session/                      # Session DO (from template)
  auth/                         # Passkey + password auth
  auction/
    durableObject.ts            # AuctionRoomDO
    types.ts                    # WebSocket message types, state interfaces
    state-machine.ts            # Auction/lot status transitions
    increments.ts               # Bid increment resolution logic
  lib/
    audit.ts                    # Audit log helper
    idempotency.ts              # Idempotency key check/store
    money.ts                    # Cents formatting/calculation
    pagination.ts               # Cursor-based pagination
    turnstile.ts                # Turnstile verification
    stream/
      types.ts                  # StreamProvider interface
      cloudflare-stream.ts      # CF Stream implementation
      factory.ts                # Provider factory
    stripe.ts                   # Payment link creation, webhook handler
    shopify.ts                  # Shopify API client
  queues/
    bid-events.ts
    post-auction.ts
    shopify-import.ts
  cron/
    auction-scheduler.ts        # Scheduled -> Preview transitions
  layouts/
    PublicLayout.tsx
    AuthenticatedLayout.tsx
    AdminLayout.tsx
    MobileNav.tsx
  app/
    Document.tsx
    styles.css
    headers.ts
    interruptors.ts             # requireAuth, requireAdmin, requireEmployee, requireDealer
    components/ui/              # shadcn
    pages/
      Landing.tsx
      Dashboard.tsx
      auctions/
        AuctionListPage.tsx
        AuctionDetailPage.tsx
        AuctionRoomPage.tsx     # Live bidding + chat + stream
        server-functions/
          browsing.ts
          bidding.ts
      my/
        MyBidsPage.tsx
        MyInvoicesPage.tsx
        InvoiceDetailPage.tsx
        MyPickupsPage.tsx
        ProfilePage.tsx
        server-functions/
          profile.ts
          invoices.ts
          pickups.ts
          bids.ts
      admin/
        AdminDashboard.tsx
        auctions/
          AdminAuctionsPage.tsx
          AdminAuctionForm.tsx
          AdminLotsPage.tsx      # Lot CRUD + grouping (lot_items)
          AuctioneerConsolePage.tsx
          CloneAuctionPage.tsx
          server-functions/
            auctions.ts
            lots.ts
            clone.ts
        catalog/
          AdminCatalogPage.tsx
          AdminProductForm.tsx
          AdminImportPage.tsx
          server-functions/
            catalog.ts
            import.ts
        pickups/
          AdminPickupSlotsPage.tsx
          server-functions/pickups.ts
        invoices/
          AdminInvoicesPage.tsx
          server-functions/invoices.ts
        orders/
          AdminOrdersPage.tsx
          server-functions/orders.ts
        users/
          AdminUsersPage.tsx
          AdminUserDetailPage.tsx  # bid history, purchases, dealer profile, notes
          server-functions/users.ts
        settings/
          AdminSettingsPage.tsx
          AdminFeeConfigPage.tsx
          AdminStreamConfigPage.tsx
          server-functions/
            fees.ts
            stream.ts
            settings.ts
      auth/
        routes.ts
        LoginPage.tsx
        RegisterPage.tsx
      platform/
        PlatformDashboard.tsx
        PlatformOrgsPage.tsx
        PlatformOrgDetailPage.tsx   # set hammer fee, status, notes
        PlatformRevenuePage.tsx
        server-functions/
          orgs.ts
          revenue.ts
```

---

## 15. Build Sequence

1. Repo setup + D1 migration from template's DO SQLite pattern
2. Password auth (port from quality-garden)
3. Migrations 002-013 (full schema)
4. Shared utilities (audit, idempotency, money, state machine, increments, pagination, turnstile)
5. Interruptors (requirePlatformAdmin, requireAdmin, requireEmployee, requireDealer)
6. Mobile UI shell (layouts, bottom nav, responsive structure)
7. Catalog: products + categories CRUD (admin, with perishable fields)
8. Shopify import (queue consumer + admin UI + R2 image upload)
9. Auction CRUD + state machine + clone (admin pages, transitions)
10. Lot management (admin CRUD, reorder, lot grouping via lot_items)
11. AuctionRoomDO (WebSocket, bid engine, increments, timers, anti-snipe, floor bids, chat, outbox)
12. Auction room UI (mobile bidder view + chat + reactions + auctioneer console)
13. Cloudflare Stream integration
14. Cron trigger (scheduled auction transitions)
15. Post-auction: orders + invoices + Stripe payment links
16. Pickup scheduling (slot management + reservation)
17. Fee configuration (admin UI + invoice calculation — buyer's premium disabled Phase 1, hammer fee active)
18. Platform admin section (org management, hammer fee per org, revenue overview)
19. Dealer profiles + dealer management (admin CRUD, approval flow, tier/standing)
20. User detail page (admin: bid history, purchases, notes)

---

## 16. Verification

- `pnpm dev` — app starts, landing page renders
- Register via passkey and password
- Admin: create categories, products manually (with perishable fields)
- Admin: run Shopify import, verify products + R2 images
- Admin: create auction with increment rules, add lots (including grouped lots)
- Admin: clone an auction as new draft
- Admin: transition auction draft -> scheduled -> (cron) -> preview -> (auctioneer) -> live
- Open auction room on two devices — verify WebSocket, viewer count, chat
- Place bids from both — verify real-time updates, increment enforcement, anti-snipe
- Auctioneer console: place floor bid, advance lots, going once/twice/sold
- Verify bid events + chat messages flushed to D1
- Verify orders generated post-auction with platformFeeCents calculated from org.hammerFeePct
- Verify invoices generated (premiumCents=0, buyer's premium disabled Phase 1)
- Verify Stripe payment link on invoice
- Consumer: schedule pickup slot
- Admin: view pickup reservations, mark picked up
- Admin: view dealer profiles, approve dealer applications, adjust tier
- Admin: user detail page with bid/purchase history
- Platform admin: manage orgs, set hammer fee per org, view revenue
- Test Cloudflare Stream embed

---

## Deferred

- Dealer bulk auction UI — Phase 3 (schema ready now)
- Buy-now UI — Phase 3 (schema ready now)
- Stripe pre-auth / card-on-file — Phase 2
- Bidirectional Shopify sync — Phase 5
- SMS/email notifications — Phase 2
- Zoom stream fallback — Phase 4+
- Stream recording/replay — Phase 4+
- Chat profanity filter — Phase 2 (admin moderation only in Phase 1)
- Analytics/BI dashboard — Phase 6
- Fraud detection — Phase 6
- PWA/offline — Phase 6
- Buyer's premium activation — Phase 2 (schema + columns exist, calculation disabled, premiumCents=0)
- Sales tax calculation logic — Phase 2 (taxCents column exists, manual entry for now)

## Unresolved

- D1 + Kysely adapter: need to verify `kysely-d1` works smoothly with RWSDK worker setup. May need thin wrapper.
- WebSocket route handling: RWSDK's `defineApp` returns a fetch handler. WebSocket upgrade needs to be handled before `render()`. Need to verify composition.
- Queue + cron handler export: RWSDK worker.tsx exports `fetch`. Need to confirm we can also export `queue()` and `scheduled()` alongside it, or if we need a wrapper.
- Cloudflare Stream low-latency: need to test with actual CF account whether WebRTC low-latency mode is available, or if standard HLS (10-20s delay) requires auctioneer to pace around stream delay.
