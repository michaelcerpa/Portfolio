# Michael Cerpa — Portfolio

Personal portfolio site. I'm an operator who ships AI in regulated environments
(Army intelligence → UC Berkeley → JPMorgan → Wells Fargo).

**Live:** https://mcerpa.com

## What this is

A single hand-written page that exhibits my work — Granite and Strata (enterprise AI,
sanitized) and Cairn (a live Sierra trip planner). Each project is its own repo and its
own deploy; this site shows a real screenshot of each and links to the live app at
`mcerpa.com/granite/`, `/strata/`, `/cairn/` — same domain, full viewport, no iframes.

The hero carries one live element: real NOAA conditions for the Eastern Sierra, fetched
from Cairn's own API and typed out on load. If the fetch fails, the line hides — it is
never faked.

## Architecture

Vanilla HTML / CSS / JS. No framework, no build step, no dependencies.

| File | Job |
|------|-----|
| `index.html` | The whole page, semantic hand-written HTML; ~60 lines of JS for the live weather line, the email-copy interaction, and nav state |
| `styles.css` | All styling; design tokens (colors, fonts, the house ease) live in `:root` |
| `vercel.json` | Rewrites that serve each project's separate Vercel deploy under this domain |
| `fonts/` | Two self-hosted variable fonts (Space Grotesk, JetBrains Mono) — no third-party font requests |
| `assets/`, `photos/` | Project screenshots and summit photos, web-sized WebP |

Motion is native CSS: scroll-driven reveals (`animation-timeline: view()`) and
cross-document view transitions, both shipped as progressive enhancement, both
respecting `prefers-reduced-motion`.

## Deploy

Static site on **Vercel**; auto-deploys on every push to `main`.

---
Built with vanilla web tech + Claude Code.
