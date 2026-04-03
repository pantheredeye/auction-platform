# Design Constraints

> Not a design system. Guidance and guardrails for building UI in this app.

## Audience

Primary users are 20-85 years old, southern American, north Mississippi. Many coming from Facebook Live and Zoom auctions. Varying tech literacy. Mobile-first.

## Typography

- 18px base font minimum (`text-lg`). Never smaller on customer-facing pages.
- `font-medium` (500) minimum. `font-semibold` on important text (bids, status, buttons).
- No thin font weights anywhere.
- System font stack. Nothing custom.

## Touch Targets

- 48px minimum height and width on all interactive elements (`h-12 min-w-12`).
- Input fields: `h-12 text-lg` with visible border.
- Generous padding. When in doubt, make it bigger.

## Contrast & Color

- High contrast always. White on dark, dark on light. No subtle grays for meaningful content.
- Color is never the only indicator. Pair with text, icons, or symbols (e.g., bids get ★ AND highlight AND bold).
- Dark backgrounds for live/stream views (`bg-zinc-950` or `bg-black`).

## Labels & Language

- No icons without text labels. Say "Place Bid" not just an icon. Say "Tap to hear audio" not 🔇.
- Button text describes the action: "Place Bid", "Join Chat", "Go Live", "End Stream", "Leave".
- Plain language. No jargon. "Save your spot" not "Register".
- Error messages in plain English.

## Motion & Timing

- Respect `prefers-reduced-motion`. No bouncing, sliding, or flashy animations.
- Fade-in is fine. Subtle transitions ok.
- No timeouts on prompts or modals. They stay until the user acts.
- No auto-dismiss on important information.

## Layout

- Mobile-first. Design for phone, enhance for desktop.
- No swipe gestures. Everything is tap. Scroll is scroll.
- Auto-rotate support. No orientation lock.
- Live stream views: video dominant, everything else secondary.

## Component Library

- shadcn/ui (Radix + CVA + Tailwind). Stick with it.
- Don't introduce new UI libraries without discussion.
- Reuse existing components from `src/app/components/ui/`.

## Two Surfaces

- **Admin/management** (`/admin/*`): existing layouts, existing patterns. Can have more density.
- **Live experience** (`/live/*`): minimal chrome, no nav, stream-focused. Accessibility constraints above are strict here.
- Shared: shadcn primitives, utility functions, types, server infrastructure.
