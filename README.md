# Michael Cerpa — Portfolio

Personal portfolio site. I build AI agents at Pallet. Before that: Army intelligence →
UC Berkeley → JPMorgan → Wells Fargo.

**Live:** https://mcerpa.com

## What this is

A single hand-written page that exhibits my work — Granite and Strata (enterprise AI,
sanitized), Cairn (a live Sierra trip planner), and Commute (live trackers for my Golden
Gate Transit and Presidio GO rides). Granite, Strata, and Cairn are each their own repo
and deploy, served at `mcerpa.com/granite/`, `/strata/`, `/cairn/` — same domain, full
viewport, no iframes. The Commute trackers live in this repo at `/bus/` and `/presidio/`.

The hero carries one live element: current San Francisco weather, fetched by the
visitor's own browser straight from the National Weather Service and typed out on load.
If the fetch fails, the line hides — it is never faked.

## Architecture

Vanilla HTML / CSS / JS. No framework, no build step, no npm dependencies.

| Path | Job |
|------|-----|
| `index.html` | The whole page, semantic hand-written HTML; a little JS for the live weather line, the email-copy interaction, and nav state |
| `styles.css` | All styling; design tokens (colors, fonts, the house ease) live in `:root` |
| `vercel.json` | Rewrites that serve each project's separate Vercel deploy under this domain |
| `bus/`, `presidio/` | The Commute trackers: phone-first pages, installable to the home screen |
| `api/` | Vercel functions behind them. They read each agency's public GTFS timetable and GTFS-Realtime feeds directly, with zero-dependency ZIP, CSV, and protobuf readers in `api/_lib/` |
| `tools/`, `.github/` | Tests against fresh snapshots of both agencies' feeds, run whenever the trackers change and every Monday |
| `fonts/` | Two self-hosted variable fonts (Space Grotesk, JetBrains Mono) — no third-party font requests |
| `assets/`, `photos/` | Card posters (WebP) + demo loops (animated WebP) · summit photos |

Motion is native CSS: scroll-driven reveals (`animation-timeline: view()`) and
cross-document view transitions, both shipped as progressive enhancement, both
respecting `prefers-reduced-motion`.

## Deploy

Static site + functions on **Vercel**; auto-deploys on every push to `main`.

---
Built with vanilla web tech + Claude Code.
