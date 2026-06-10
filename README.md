# Michael Cerpa — Portfolio

Personal portfolio site. I'm an operator who ships AI in regulated environments
(Army intelligence → UC Berkeley → JPMorgan → Wells Fargo).

**Live:** https://mcerpa.com

## What this is

A single-page portfolio shell that houses my work — passion builds (e.g. Cairn AI)
and professional projects (e.g. Granite) — each embedded **inline via `<iframe>`,
never a new tab**, with a fullscreen view for the live apps.

## Architecture

Vanilla HTML / CSS / JS. No framework, no build step. Content is **separated from
structure** so the site scales by editing data, not markup:

| File | Job |
|------|-----|
| `index.html` | Skeleton + empty mount points (rarely edited) |
| `styles.css` | All styling; design tokens (colors, fonts) live in `:root` |
| `content.js` | **The editable data** — `SITE`, `SECTIONS`, `PROJECTS[]`, `PHOTOS[]`. Add a project or photo = append one object |
| `main.js` | Renders the page from `content.js`; wires nav, click-to-expand demos, photo flips, and the fullscreen lightbox |

**Why the split:** a single app (like Cairn) is fine as one self-contained file, but a
portfolio is a growing *container* of repeating content — separating the data keeps it
editable and lets it scale cleanly as projects are added.

## Deploy

Static site on **Vercel**; auto-deploys on every push to `main`.

---
Built with vanilla web tech + Claude Code.
