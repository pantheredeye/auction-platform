
  1. Read chunks.md → see what's next
  2. Read plan.md → get the detail for those build steps
  3. Read prior spec(s) → know what's already built
  4. Run /choo-choo-ralph:spec → generate

---

# Auction Platform

Live auction platform for M&M Auctions. Whatnot-inspired, mobile-first, live-stream bidding. Multi-tenant architecture.

Built on Cloudflare Workers + RWSDK (React Server Components), D1, Durable Objects, R2, Queues, and Cloudflare Calls.

---

## Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [pnpm](https://pnpm.io/) v9+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) v4+ — `npm i -g wrangler`
- A Cloudflare account with Workers Paid plan (required for Durable Objects and Queues)

---

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Authenticate with Cloudflare

```bash
wrangler login
```

### 3. Create Cloudflare resources

These must exist in your Cloudflare account before deploying. Create them via the dashboard or CLI:

**D1 databases**

```bash
wrangler d1 create auction-platform-db
wrangler d1 create auction-platform-db-staging   # staging only
```

Update the `database_id` values in `wrangler.jsonc` with the IDs returned.

**R2 buckets**

```bash
wrangler r2 bucket create auction-platform-images
wrangler r2 bucket create auction-platform-images-staging   # staging only
```

**Queues**

```bash
wrangler queues create auction-bid-events
wrangler queues create auction-import-queue
wrangler queues create auction-bid-events-staging           # staging only
wrangler queues create auction-import-queue-staging         # staging only
```

**Cloudflare Calls app**

In the [Cloudflare dashboard](https://dash.cloudflare.com) go to **Calls** and create a new app. Copy the App ID into `CALLS_APP_ID` in `wrangler.jsonc` (under `vars`), and store the App Secret as a secret:

```bash
wrangler secret put CALLS_APP_SECRET
```

Durable Objects (`SessionDurableObject`, `AuctionRoomDO`, `LiveStore`) are declared in `wrangler.jsonc` and provisioned automatically on first deploy.

### 4. Run database migrations

```bash
# Local development
pnpm migrate:local

# Production
pnpm migrate:remote

# Staging
pnpm migrate:staging
```

### 5. Set secrets

```bash
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put STRIPE_SECRET_KEY          # when Stripe integration is active
wrangler secret put SHOPIFY_API_TOKEN          # when Shopify import is active
```

For staging, add `--env staging` to each command.

### 6. Generate TypeScript types

```bash
pnpm generate
```

---

## Development

```bash
pnpm dev
```

Runs a local Cloudflare Workers dev server via Vite + Wrangler. D1, Durable Objects, R2, and Queues are simulated locally.

---

## Deployment

```bash
# Production
pnpm release

# Staging
pnpm release:staging
```

Both commands run `clean → build → wrangler deploy`.

---

## Environment Variables

### Vars (set in `wrangler.jsonc`)

| Variable | Description |
|---|---|
| `WEBAUTHN_RP_ID` | Relying party ID for WebAuthn/passkeys — must match the hostname (e.g. `auction.digitalglue.dev`) |
| `WEBAUTHN_APP_NAME` | Display name shown in passkey prompts |
| `CALLS_APP_ID` | Cloudflare Calls application ID for WebRTC |
| `CALLS_API` | Cloudflare Calls API base URL (`https://rtc.live.cloudflare.com`) |
| `TURNSTILE_SITE_KEY` | Public Turnstile site key (add to `wrangler.jsonc` `vars` when enabling bot protection) |

### Secrets (set via `wrangler secret put`)

| Secret | Description |
|---|---|
| `CALLS_APP_SECRET` | Cloudflare Calls API secret for WebRTC signaling |
| `TURNSTILE_SECRET_KEY` | Server-side Turnstile verification key |
| `STRIPE_SECRET_KEY` | Stripe secret key for payment link generation |
| `SHOPIFY_API_TOKEN` | Shopify Admin API token for catalog import |

---

## External Services

### Cloudflare (required)

| Service | Purpose |
|---|---|
| **D1** | Primary relational database (users, orgs, auctions, bids, invoices, orders) |
| **Durable Objects** | `SessionDurableObject` — auth sessions; `AuctionRoomDO` — live auction real-time state + WebSocket; `LiveStore` — Cloudflare Calls live store |
| **R2** | Product and lot image storage |
| **Queues** | `auction-bid-events` — flush bid events from DO to D1; `auction-import-queue` — paginated Shopify catalog import |
| **Cloudflare Calls** | WHIP/WHEP WebRTC streaming — auctioneer pushes camera via WHIP (browser-based, no OBS required), viewers pull via WHEP. Requires a Calls app (see setup above). |
| **Cloudflare Stream** | In schema (`streamProviderId`, `streamUrl`) but not yet wired up — current streaming runs through Cloudflare Calls SFU. Planned for a future phase. |
| **Turnstile** | Bot protection on login, registration, and public bid pages |

### Stripe (payment links)

Used to generate hosted payment pages for auction invoices. Requires a Stripe account and a configured webhook endpoint pointing at `/api/stripe/webhook` to mark invoices as paid on `checkout.session.completed`.

Dashboard: [dashboard.stripe.com](https://dashboard.stripe.com)

### Shopify (catalog import)

One-way pull import of products from a Shopify store into the platform catalog. Requires a Shopify Admin API token with `read_products` scope. Configured per-org in the admin UI at `/admin/catalog/import`.

---

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Local dev server |
| `pnpm build` | Production build |
| `pnpm release` | Build + deploy to production |
| `pnpm release:staging` | Build + deploy to staging |
| `pnpm migrate:local` | Apply D1 migrations locally |
| `pnpm migrate:remote` | Apply D1 migrations to production |
| `pnpm migrate:staging` | Apply D1 migrations to staging |
| `pnpm generate` | Regenerate Wrangler TypeScript types |
| `pnpm types` | Run `tsc` type check |
| `pnpm check` | `generate` + `types` |
| `pnpm seed` | Run seed script against local worker |
