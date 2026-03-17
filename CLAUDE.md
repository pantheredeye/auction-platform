# Auction Platform

## Key Docs

- `DESIGN.md` — UI design constraints and accessibility guidance. Read before building any customer-facing UI.
- `SCOPE.md` — Implementation scope for the live experience. Reference for current build plan.
- `ROADMAP.md` — Full launch roadmap and open questions.

## Stack

- RWSDK (RedwoodSDK) on Cloudflare Workers
- D1 + R2 + Queues + Durable Objects
- React 19 RSC with "use client" directives
- shadcn/ui (Radix + CVA + Tailwind 4)
- Passkey auth (WebAuthn) + password fallback

## Patterns

- Server components fetch data, client components handle interaction
- Server functions in `server-functions/` subdirs with `"use server"` directive
- Durable Objects for real-time state (auction bidding, sessions, stream tracks)
- Queue consumers for async persistence (bids, chat)
- `npx wrangler` for all wrangler commands (not in PATH directly)

## Two App Surfaces

- `/admin/*` — back office, requires auth, sidebar nav, full management UI
- `/live/*` — customer-facing, anonymous entry, minimal chrome, stream-focused
- Both share: DB, DOs, streaming infra, shadcn components, auth (when needed)

## Design Rules (live experience)

- 18px base font, 48px touch targets, no icons without labels
- High contrast, no color-only indicators
- Mobile-first, no swipe gestures, respect prefers-reduced-motion
- See `DESIGN.md` for full constraints

## Git Workflow

- `main` is protected — all changes go through PRs (no direct push)
- Branch naming: `initials-description` (e.g., `pt-stripe-webhooks`, `cm-chat-ui`)
- Keep branches short-lived (days, not weeks) — one feature/fix per branch
- Push daily, even if WIP
- PRs don't require approval — either collaborator can merge their own
- Merge via GitHub UI or `gh pr merge`, then delete the branch
- Only `main` gets deployed to prod
- Staging uses a separate worker/config (see `scripts/staging-config.js`)

## Deploy

- **Prod**: merge to `main`, then `pnpm build && npx wrangler deploy`
- **Staging**: `pnpm build && node scripts/staging-config.js && npx wrangler deploy --config dist/worker/wrangler.staging.json`
- Prod domain: `auction.digitalglue.dev`
- Staging domain: `staging-auction.digitalglue.dev`
