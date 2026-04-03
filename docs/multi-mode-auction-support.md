# Multi-Mode Auction Support

## Context

Primary user is a live seller who stands at a tripod camera, holds up items, calls out prices verbally. Customers currently order via chat (messy, error-prone). The system currently only supports English auctions (competitive bidding up), but his actual workflow is **live selling** — fixed price, customers claim. We need to support his real workflow while keeping English auctions and adding Dutch auctions.

Also fixing two existing bugs that make the live auction room unreliable.

## Sale Modes

| Mode | Who sets price | Competition | Winners |
|------|---------------|-------------|---------|
| `english` (built) | Customers bid up | Highest bidder wins | 1 |
| `live_sell` (priority) | Seller names price | First-come claim | Many (up to qty) |
| `dutch` | Starts high, drops | First to claim wins | 1 per unit |

## Phases

### Phase 0: Bug Fixes

**0A. Fix ping/pong mismatch**
- `src/auction/durableObject.ts` line 56: change auto-response from literal `"ping"` to `'{"type":"ping"}'` and response to `'{"type":"pong"}'`

**0B. Fix WebSocket reconnect bug**
- `src/app/pages/auctions/AuctionRoomClient.tsx`: `handleServerMessage` depends on `myLastBidLotId` in useCallback deps → every bid triggers WS reconnect
- Fix: use a ref (`myLastBidLotIdRef`) for the outbid check, remove from useCallback deps. Final deps: `[userId]` only.

---

### Phase 1: Schema + Types

**1A. Migration `migrations/0014_lot_sale_mode.sql`**
```sql
ALTER TABLE lots ADD COLUMN saleMode TEXT NOT NULL DEFAULT 'english';
ALTER TABLE lots ADD COLUMN quantityClaimed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lots ADD COLUMN maxClaimsPerUser INTEGER;  -- null = unlimited
```

**1B. Types — `src/auction/types.ts`**
- Add `SaleMode = "english" | "live_sell" | "dutch"`
- Add `"claim"` to `BidEventType`
- Extend `LotState` with: `saleMode`, `quantity`, `quantityClaimed`, `maxClaimsPerUser`, `claimants: ClaimEntry[]`
- Add `ClaimEntry`: `{ userId, username, quantity, amountCents, claimedAt }`
- Add `ClientMessage`: `{ type: "claim"; lotId; quantity; idempotencyKey }`
- Add `ServerMessage`: `claim_accepted`, `claim_rejected`
- Extend `lot_update` ServerMessage: add `saleMode`, `quantity`, `quantityClaimed`
- Add `AdminMessage`: `set_price` (lotId, priceCents), `close_lot` (lotId)
- Extend `quick_add_lot`: optional `saleMode`, `quantity`, `maxClaimsPerUser`

**1C. DB types — `src/db/index.ts`**
- Add `saleMode`, `quantityClaimed`, `maxClaimsPerUser` to `LotsTable`

**1D. State machine — `src/auction/state-machine.ts`**
- Add helper `getValidTransitions(status, saleMode)` — for `live_sell`/`dutch`, exclude `going_once`/`going_twice`

---

### Phase 2: Durable Object — Claim Handling

**File: `src/auction/durableObject.ts`**

- **handleInit**: Load `saleMode`, `quantity`, `quantityClaimed`, `maxClaimsPerUser` into LotState
- **webSocketMessage**: Route `type: "claim"` to new `handleClaim`
- **handleClaim**: Validate mode (live_sell or dutch only), check status=active, check quantity remaining, enforce `maxClaimsPerUser` (count existing claims for userId), idempotency check, accept claim, buffer to bid_events queue, auto-sell if fully claimed
- **handleSetPrice**: New admin handler — updates `currentBidCents` on active lot, broadcasts update. Works for live_sell price adjust and dutch manual price drop.
- **handleCloseLot**: New admin handler — transitions active lot to sold (if claims > 0) or passed (if 0 claims), flushes bid buffer
- **Guard existing handlers**: `handleBid`/`handleFloorBid` reject if `saleMode !== "english"`. `handleGoingOnce`/`handleGoingTwice` reject if not english.
- **broadcastLotUpdate + sendStateSnapshot**: Include `saleMode`, `quantity`, `quantityClaimed` in lot_update messages
- **handleQuickAddLot**: Accept `saleMode`, `quantity`, `maxClaimsPerUser` params
- **StoredState**: LotState serializes naturally with new fields

---

### Phase 3: Queue Consumer

**File: `src/queue/bid-events.ts`**

- Handle `type: "claim"` events: increment `quantityClaimed` and `bidCount` in D1 lots table (instead of updating currentBidCents/currentBidderId)

---

### Phase 4: Customer UI — Mode-Aware Auction Room

**File: `src/app/pages/auctions/AuctionRoomClient.tsx`**

- **LotDynamic**: Add `saleMode`, `quantity`, `quantityClaimed`
- **handleServerMessage**: Parse new fields from `lot_update`, handle `claim_accepted`/`claim_rejected`
- **Sticky bid bar**: Switch on saleMode:
  - `english`: existing "Bid $X" button (extract to `EnglishBidBar`)
  - `live_sell`: "Claim — $X" button + "N of M left" counter (`LiveSellClaimBar`)
  - `dutch`: "Buy at $X" button (`DutchBuyBar`)
- **CurrentLotCard**: Mode-aware display:
  - `english`: current bid + bid count + "You're winning!" (existing)
  - `live_sell`: fixed price + claimed/total progress
  - `dutch`: current (dropping) price
- **Overlays**: Only show going_once/going_twice overlays for english lots
- **Mobile layout improvements**: Tighten video height, make bid/claim bar more prominent

---

### Phase 5: Auctioneer Console — Mode-Aware + Readable

**File: `src/app/pages/admin/auctions/AuctioneerConsole.tsx`**

- **Huge price display**: `text-6xl font-black` for current bid/price — readable from 6+ feet
- **Mode-aware controls**:
  - `english`: existing going_once/going_twice/sold/pass/withdraw/next
  - `live_sell`: set price input, close lot, next item, claims counter + progress bar
  - `dutch`: set price (drop) input, sold/pass, next item
- **Audio cue**: Web Audio API — generate a short tone on new bid/claim. Mute toggle in header.
- **Claim feed**: Show claims list (like bid feed) for live_sell lots
- **QuickAddLotForm**: Add saleMode dropdown (default `live_sell`) + quantity input + optional maxClaimsPerUser
- **Lot queue sidebar**: Mode indicator badge per lot

---

### Phase 6: Admin Lot Form

**File: `src/app/pages/admin/auctions/AdminLotFormClient.tsx`** (and server functions)

- Add saleMode select (English / Live Sell / Dutch)
- Contextual fields: hide increment/reserve for live_sell, label startingPriceCents as "Sell Price" for live_sell
- Show quantity prominently for live_sell
- Optional maxClaimsPerUser field
- Update `createLot`/`updateLot` server functions

---

## Ship Order

1. **PR 1** — Phase 0: Bug fixes (standalone, ship immediately)
2. **PR 2** — Phase 1+2+3: Schema + DO + queue (backend, backward compatible)
3. **PR 3** — Phase 4: Customer UI (depends on PR 2)
4. **PR 4** — Phase 5: Auctioneer console (depends on PR 2)
5. **PR 5** — Phase 6: Admin lot form (parallel with PR 3/4)

## Key Decisions

- **saleMode per-lot, not per-auction** — one auction can mix modes
- **Reuse bid_events table** for claims (new type "claim"), no new tables
- **startingPriceCents = sell price** for live_sell lots
- **maxClaimsPerUser nullable** — null = unlimited (default), set per-lot
- **No auto-timer for dutch** — manual price drops via set_price, seller controls pacing
- **claimants array in DO memory** — authoritative record stays in bid_events table
- **Web Audio API** for bid/claim ding — no asset files needed

## Critical Files

- `src/auction/durableObject.ts` — claim handling, set_price, close_lot, mode guards
- `src/auction/types.ts` — SaleMode, updated messages, LotState
- `src/auction/state-machine.ts` — mode-aware transitions
- `src/app/pages/auctions/AuctionRoomClient.tsx` — customer mode-aware UI + WS bug fix
- `src/app/pages/admin/auctions/AuctioneerConsole.tsx` — auctioneer mode-aware UI + audio
- `src/queue/bid-events.ts` — claim event processing
- `src/db/index.ts` — LotsTable type update

## Verification

- Deploy migration, confirm existing english lots unaffected (saleMode defaults to 'english')
- Create a live_sell lot with quantity=5, start auction, have 2 test users claim — verify quantity tracking
- Create a dutch lot, manually drop price via set_price, verify customer sees price update
- Verify english lots still work: bid up, going once/twice/sold flow
- Test maxClaimsPerUser: set to 2, verify user blocked on 3rd claim
- Verify audio cue fires on auctioneer console for all modes
- Test mobile customer UI for all 3 modes

## Unresolved

- Order creation on claim: immediate vs batch on lot close? (defer to later PR)
- Dutch with quantity > 1: each claim takes 1 unit at current price? (assume yes)
