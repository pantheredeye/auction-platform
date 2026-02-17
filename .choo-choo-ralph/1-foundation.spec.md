---
title: "Foundation — Repo, Auth, Schema, Utilities, Shell"
created: 2026-02-17
poured: []
iteration: 1
auto_discovery: false
auto_learnings: false
---
<project_specification>
<project_name>Foundation — Repo, Auth, Schema, Utilities, Shell</project_name>

  <overview>
    Build steps 1-6 of the auction platform Phase 1. Fork the rwsdk-multi-tenant-starter template,
    replace its DO-SQLite database pattern with Cloudflare D1, port password auth from quality-garden,
    apply full schema (13 migrations), create shared utilities, add role-based interruptors, and build
    the mobile-first UI shell. After this spec, the app boots with auth, full schema, and nav — ready
    for feature work.
  </overview>

  <context>
    <existing_patterns>
      - Template at /home/ptre/code/github/templates/rwsdk-multi-tenant-starter
      - worker.tsx: `defineApp([middleware..., render(Document, [routes])])` pattern
      - Export format: `export default { fetch: app.fetch, scheduled(), queue() } satisfies ExportedHandler<Env>`
      - Context augmentation via `declare module "rwsdk/worker" { interface DefaultAppContext {...} }`
      - Server/client component split: ServerComponent passes props to ClientComponent ("use client")
      - Layout pattern: server Layout receives RequestInfo, renders LayoutClient with serialized props
      - Interruptors return Response(302) to redirect, or undefined to pass through
      - Passkey auth in src/passkey/ — startPasskeyRegistration/Login, finishPasskeyRegistration/Login
      - DB queries via Kysely: db.selectFrom().selectAll().where().executeTakeFirst()
      - Session via defineDurableSession from rwsdk/auth + SessionDurableObject
      - shadcn/ui in src/app/components/ui/ (button, card, input, label installed)
      - cn() utility from @/app/lib/utils (clsx + tailwind-merge)
      - Vite config: cloudflare plugin + redwood() + tailwindcss()
      - Scripts: dev, build, seed, release (build + wrangler deploy)
    </existing_patterns>

    <integration_points>
      - quality-garden password auth to port: src/auth/password.ts (PBKDF2 via Web Crypto), src/auth/functions.ts (registerWithPassword, loginWithPassword), src/auth/rate-limit.ts (5 attempts, 15min lockout)
      - Template's src/db/ to replace: durableObject.ts (SqliteDurableObject), index.ts (createDb), migrations.ts
      - Template's src/passkey/ to extend: add password option alongside passkey
      - Template's src/app/interruptors.ts to extend: add role-based guards
      - Template's src/layouts/ to rebuild: mobile-first with bottom nav
      - Template's wrangler.jsonc to reconfigure: D1, AuctionRoomDO, R2, Queues, Cron
    </integration_points>

    <new_technologies>
      - kysely-d1: `new Kysely({ dialect: new D1Dialect({ database: env.DB }) })`. No built-in migrations — use wrangler D1 migrations (SQL files in migrations/ dir)
      - D1 migrations: `wrangler d1 migrations create <DB> "desc"` → NNNN_desc.sql in migrations/. Apply with `wrangler d1 migrations apply <DB> --local|--remote`. Tracked in d1_migrations table
      - D1 gotchas: SQLite under the hood — no ALTER COLUMN, limited ALTER TABLE. 100k row limit per query. Use PRAGMA defer_foreign_keys for FK-violating changes
      - RWSDK's built-in rwsdk/db uses SqliteDurableObject + Kysely — we're NOT using this, replacing with D1 directly
      - Cron: triggers.crons in wrangler.jsonc, implement scheduled() in export default. Test locally: curl localhost:5173/cdn-cgi/handler/scheduled?cron=...
      - Queues: producers/consumers in wrangler.jsonc, implement queue() in export default. Messages via env.QUEUE.send(). Max 128KB per message body
    </new_technologies>

    <conventions>
      - IDs: UUIDv4 (text primary key)
      - Money: integer cents
      - Dates: ISO text strings
      - Soft deletes: deletedAt column where appropriate
      - Optimistic locking: version column on mutable entities
      - Path alias: @/* → ./src/*
      - TypeScript strict mode, ES2021 target, react-jsx
    </conventions>
  </context>

  <technology_stack>
    <frontend>React 19 RSC (RWSDK), Tailwind 4, shadcn/ui (new-york), Radix, Lucide</frontend>
    <backend>Cloudflare Workers, D1 (Kysely), Durable Objects, R2, Queues, Cron</backend>
  </technology_stack>

  <tasks>
    <task id="repo-setup" priority="0" category="infrastructure">
      <title>Fork Template + Project Setup</title>
      <description>
        Fork rwsdk-multi-tenant-starter into this repo. Rename in package.json and wrangler.jsonc.
        Update branding (app name, RP ID, org defaults). Remove DigitalGlueFooter.tsx.
        Add deps: date-fns, stripe, kysely-d1. Add theme-color + apple-mobile-web-app-capable meta
        in Document.tsx. Update CSP in headers.ts for Cloudflare Stream iframes.
      </description>
      <steps>
        - Copy template files from /home/ptre/code/github/templates/rwsdk-multi-tenant-starter into repo
        - Update package.json: name → "auction-platform", add date-fns, stripe, kysely-d1 deps
        - Remove src/layouts/DigitalGlueFooter.tsx and its imports
        - Update Document.tsx: add theme-color meta, apple-mobile-web-app-capable meta
        - Update headers.ts CSP: allow Cloudflare Stream iframe sources
        - Update WEBAUTHN_APP_NAME, WEBAUTHN_RP_ID vars for auction platform
        - Run pnpm install to verify deps resolve
      </steps>
      <test_steps>
        1. pnpm install succeeds without errors
        2. pnpm build succeeds
        3. No references to "quality-garden" or "DigitalGlue" remain in source
        4. Document.tsx contains theme-color and apple-mobile-web-app-capable meta tags
      </test_steps>
      <review></review>
    </task>

    <task id="d1-setup" priority="0" category="infrastructure">
      <title>Replace DO-SQLite with D1 + Kysely</title>
      <description>
        Replace template's Database Durable Object (SqliteDurableObject from rwsdk/db) with
        Cloudflare D1 using kysely-d1 adapter. Update wrangler.jsonc with all bindings:
        D1 database, SessionDurableObject, AuctionRoomDO, R2 bucket, Queues (bid-events,
        post-auction, shopify-import), Cron trigger. Update src/db/index.ts to use D1Dialect.
        Remove src/db/durableObject.ts. Create initial D1 migration (0001) from template's
        existing schema (users, credentials, organizations, memberships).
      </description>
      <steps>
        - Delete src/db/durableObject.ts (SqliteDurableObject no longer needed)
        - Delete src/db/migrations.ts (moving to D1 SQL migrations)
        - Rewrite src/db/index.ts: use Kysely + D1Dialect from kysely-d1 with env.DB binding
        - Create migrations/ directory at project root
        - Create migrations/0001_initial_schema.sql with users, credentials, organizations, memberships tables (matching template's existing schema)
        - Update wrangler.jsonc: remove Database DO binding, add d1_databases binding, add AuctionRoomDO DO, add R2 bucket, add Queues (3 producers + 3 consumers), add Cron trigger
        - Update worker.tsx: remove Database DO export, update db initialization to use D1, add placeholder queue() and scheduled() handlers in export default
        - Run pnpm generate to update TypeScript bindings
        - Define AppDatabase type manually (since D1 migrations are SQL, not Kysely typed migrations)
      </steps>
      <test_steps>
        1. pnpm generate succeeds (wrangler types valid)
        2. pnpm build succeeds
        3. wrangler d1 migrations apply auction-platform-db --local succeeds
        4. pnpm dev starts without errors
        5. No imports from rwsdk/db remain (except rwsdk/auth for sessions)
      </test_steps>
      <review></review>
    </task>

    <task id="password-auth" priority="1" category="functional">
      <title>Port Password Auth from quality-garden</title>
      <description>
        Port password authentication alongside existing passkey auth. Copy and adapt
        password.ts (PBKDF2 hashing via Web Crypto), auth server functions (registerWithPassword,
        loginWithPassword), and rate-limit.ts from quality-garden. Update login and registration
        pages to offer both passkey and password options. Users choose authMethod: passkey|password|both.
      </description>
      <steps>
        - Copy /home/ptre/code/github/quality-garden/src/auth/password.ts → src/auth/password.ts (adapt imports)
        - Copy /home/ptre/code/github/quality-garden/src/auth/rate-limit.ts → src/auth/rate-limit.ts (adapt imports)
        - Create src/auth/functions.ts with registerWithPassword and loginWithPassword server functions, adapted for D1 db
        - Update src/passkey/functions.ts: ensure passkey registration also creates proper user record with authMethod='passkey'
        - Create src/app/pages/auth/RegisterPage.tsx: form with username, email, password fields + passkey option
        - Update src/app/pages/auth/LoginPage.tsx: tabbed/toggle UI for password login vs passkey login
        - Add /auth/register route in auth routes
        - Wire session creation on successful password login (use existing sessions.save pattern)
        - Add failedLoginAttempts + lockoutUntil logic using rate-limit.ts
      </steps>
      <test_steps>
        1. Register new user with password — user created in D1, passwordHash populated
        2. Login with correct password — session created, redirect to dashboard
        3. Login with wrong password — error shown, failedLoginAttempts incremented
        4. 5 failed attempts — account locked, lockout message shown
        5. Register with passkey still works (existing flow)
        6. Login with passkey still works
      </test_steps>
      <review></review>
    </task>

    <task id="schema" priority="1" category="infrastructure">
      <title>D1 Schema Migrations 002-013</title>
      <description>
        Create all D1 SQL migration files for the full Phase 1 schema as defined in plan.md
        sections 3.2-3.12. Extends the initial schema (users, credentials, organizations,
        memberships) with user profile fields, roles, dealer profiles, audit logs, categories,
        products, auctions, lots, lot_items, bid_events, chat_messages, fee_configurations,
        orders, invoices, invoice_line_items, pickup_slots, pickup_reservations, stream_providers,
        import_jobs, and auction_summaries. Update AppDatabase type definitions to match.
      </description>
      <steps>
        - Create migrations/0002_user_profiles_roles.sql (ALTER users + ALTER memberships)
        - Create migrations/0003_dealer_profiles.sql
        - Create migrations/0004_audit_logs.sql
        - Create migrations/0005_categories_products.sql (with perishable fields)
        - Create migrations/0006_auctions_lots.sql (auctions, auction_state_transitions, lots, lot_items)
        - Create migrations/0007_bid_events.sql
        - Create migrations/0008_chat_messages.sql
        - Create migrations/0009_fee_configurations.sql
        - Create migrations/0010_orders_invoices.sql (orders, invoices, invoice_line_items)
        - Create migrations/0011_pickup_scheduling.sql (pickup_slots, pickup_reservations)
        - Create migrations/0012_stream_import.sql (stream_providers, import_jobs)
        - Create migrations/0013_auction_summaries.sql
        - Update src/db/index.ts: extend AppDatabase interface with all new table types
        - Verify all migrations apply cleanly in sequence
      </steps>
      <test_steps>
        1. wrangler d1 migrations apply auction-platform-db --local runs all migrations without error
        2. All tables exist with correct columns (spot-check via wrangler d1 execute)
        3. Foreign key constraints work (insert with invalid FK fails)
        4. All indexes created
        5. TypeScript types compile — AppDatabase covers all tables
      </test_steps>
      <review></review>
    </task>

    <task id="utilities" priority="2" category="functional">
      <title>Shared Utility Modules</title>
      <description>
        Create shared utility modules used across the app: audit logging, idempotency key
        checking, money formatting/calculation, cursor-based pagination, and Turnstile
        verification. These are foundational helpers referenced by feature code.
      </description>
      <steps>
        - Create src/lib/audit.ts: insertAuditLog(db, {orgId, userId, entityType, entityId, action, changes}) helper
        - Create src/lib/idempotency.ts: checkAndSetIdempotencyKey helper (query + insert pattern)
        - Create src/lib/money.ts: formatCents(cents) → "$1.00", parseDollars(str) → cents, addPremium(cents, pct)
        - Create src/lib/pagination.ts: cursor-based pagination helper (encodeCursor, decodeCursor, paginatedQuery)
        - Create src/lib/turnstile.ts: verifyTurnstileToken(token, secretKey) → boolean (POST to siteverify endpoint)
      </steps>
      <test_steps>
        1. money.ts: formatCents(1050) returns "$10.50", parseDollars("10.50") returns 1050
        2. money.ts: addPremium(1000, 10) returns 100 (10% of $10)
        3. audit.ts: insertAuditLog writes row to audit_logs table
        4. turnstile.ts: verifyTurnstileToken calls correct endpoint with correct params
        5. pnpm build succeeds with all utility imports
      </test_steps>
      <review></review>
    </task>

    <task id="auction-utils" priority="2" category="functional">
      <title>Auction State Machine + Bid Increment Logic</title>
      <description>
        Create the auction and lot status state machine (valid transitions, transition validation)
        and bid increment resolution logic (per-lot override → tiered auction rules → flat default).
        These are core business logic modules used by AuctionRoomDO and admin pages.
      </description>
      <steps>
        - Create src/auction/state-machine.ts: AUCTION_TRANSITIONS map (draft→scheduled→preview→live→closing→closed→settled→archived), LOT_TRANSITIONS map (pending→active→going_once→going_twice→sold|passed|withdrawn), validateTransition(from, to) → boolean, transitionAuction/Lot helpers
        - Create src/auction/increments.ts: resolveIncrement(lot, auction) → cents (checks lot.incrementCents, then auction.incrementRules JSON tiered, then auction.defaultIncrementCents), validateBidAmount(newBid, currentBid, increment) → boolean
        - Create src/auction/types.ts: TypeScript types for AuctionStatus, LotStatus, WebSocket message types (client→server, server→client, admin→server), AuctionRoomState interface
      </steps>
      <test_steps>
        1. State machine: draft→scheduled valid, draft→live invalid, sold→active invalid
        2. Increments: lot override (500) used when set, tiered rules applied correctly (e.g. under $50 → $1, under $250 → $5), flat default used as fallback
        3. Bid validation: newBid >= currentBid + increment passes, less fails
        4. Types: all WebSocket message types compile, AuctionStatus/LotStatus are string union types
      </test_steps>
      <review></review>
    </task>

    <task id="interruptors" priority="2" category="functional">
      <title>Role-Based Auth Interruptors</title>
      <description>
        Extend template's requireAuth interruptor with role-based guards. Add requireAdmin
        (super_admin|admin), requireEmployee (auctioneer|catalog_manager|customer_service|shipping),
        and requireDealer interruptors. These check ctx.user's membership role for the current
        organization.
      </description>
      <steps>
        - Update src/app/interruptors.ts: add requireAdmin — checks ctx.currentOrganization.role in ['super_admin','admin'], redirects to /dashboard if not
        - Add requireEmployee — checks role in ['super_admin','admin','auctioneer','catalog_manager','customer_service','shipping']
        - Add requireDealer — checks role === 'dealer' and membership isApproved
        - Ensure all interruptors call requireAuth first (chain pattern or explicit check)
        - Export all interruptors for use in route definitions
      </steps>
      <test_steps>
        1. Unauthenticated user hitting /admin → redirected to /auth/login
        2. Consumer role hitting /admin → redirected to /dashboard
        3. Admin role hitting /admin → passes through
        4. Auctioneer role hitting admin auction pages → passes through (employee)
        5. Unapproved dealer hitting dealer routes → redirected
      </test_steps>
      <review></review>
    </task>

    <task id="mobile-ui-shell" priority="2" category="functional">
      <title>Mobile-First UI Shell + Layouts</title>
      <description>
        Rebuild layouts for mobile-first design. Create PublicLayout, AuthenticatedLayout (with
        bottom nav), and AdminLayout (with sidebar on desktop). Add fixed bottom navigation
        (Home, Auctions, My Bids, Invoices, Profile) for authenticated consumers. Sticky top bar
        with logo. Desktop (md+) gets sidebar nav + wider content. Add needed shadcn components.
      </description>
      <steps>
        - Install shadcn components: dialog, sheet, tabs, badge, avatar, select, textarea, switch, toast/sonner, skeleton, table, dropdown-menu, alert, progress, calendar, popover
        - Rebuild src/layouts/PublicLayout.tsx + PublicLayoutClient.tsx: clean public chrome, centered content
        - Rebuild src/layouts/AuthenticatedLayout.tsx + AuthenticatedLayoutClient.tsx: sticky top bar (logo + notification bell), fixed bottom nav (5 tabs with Lucide icons), content area between, hide bottom nav on md+ and show sidebar
        - Create src/layouts/AdminLayout.tsx + AdminLayoutClient.tsx: sidebar nav with admin sections (Auctions, Catalog, Pickups, Invoices, Orders, Users, Settings), collapsible on mobile (sheet), always visible on md+
        - Create src/layouts/MobileNav.tsx: bottom tab bar component (Home, Auctions, My Bids, Invoices, Profile) with active state
        - Update route structure in worker.tsx to use new layouts per section
        - Create placeholder pages: Dashboard.tsx, Landing.tsx (update existing)
      </steps>
      <test_steps>
        1. Mobile viewport: bottom nav visible with 5 tabs, top bar with logo
        2. Tapping nav tabs navigates to correct routes
        3. Desktop viewport: sidebar nav replaces bottom nav
        4. Admin pages show admin sidebar with all sections
        5. Public pages (landing, login) show clean public layout without nav
        6. All shadcn components import correctly
      </test_steps>
      <review></review>
    </task>
  </tasks>

  <success_criteria>
    - App boots via pnpm dev, landing page renders
    - Register + login with both passkey and password
    - Full D1 schema applied (all 13 migrations)
    - Role-based access control works (admin, employee, dealer, consumer)
    - Mobile-first shell with bottom nav (consumer) and sidebar (admin)
    - All shared utilities available for feature work
    - pnpm build succeeds, deployable to Cloudflare Workers
  </success_criteria>

</project_specification>
