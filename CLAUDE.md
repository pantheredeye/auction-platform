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
