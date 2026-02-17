# Spec Chunks — Auction Platform Phase 1

Source: `plan.md` (build steps 1-19)

| Spec | Build Steps | Status |
|---|---|---|
| `1-foundation` | 1-6: Repo setup, D1, password auth, schema, utilities, interruptors, UI shell | spec created |
| `2-catalog` | 7-8: Products/categories CRUD (admin, perishable fields), Shopify import (queue + R2) | pending |
| `3-auction-admin` | 9-10: Auction CRUD + state machine + clone, lot management (reorder, grouping) | pending |
| `4-live-engine` | 11-14: AuctionRoomDO (WS, bids, timers, anti-snipe, floor bids, chat, outbox), auction room UI (bidder + auctioneer console), Cloudflare Stream, cron trigger | pending |
| `5-post-auction` | 15-19: Orders + invoices + Stripe payment links, pickup scheduling, fee config, dealer profiles + management, user detail page | pending |

## How to generate next spec

1. Read `plan.md` for full detail on the relevant build steps
2. Read the completed prior spec(s) for context on what's already built
3. Run `/choo-choo-ralph:spec` with `spec_name` = next chunk name (e.g. `2-catalog`)
4. Update status in this file after spec is created
