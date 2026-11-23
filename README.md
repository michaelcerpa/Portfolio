# Michael Cerpa

My personal site. **Live:** https://mcerpa.com

## What this is

One screen. A wall of old tube TVs fills the window. Each screen plays a short clip of mine:
climbing, skiing, riding, running. In front of the wall are my name, three words, and a small
music player, all drawn in ink. A word opens one sheet of drawing paper.

The site also serves a few things I built:

- Granite, Strata, and Cairn each have their own repo and deploy. They are served here at
  `/granite/`, `/strata/`, and `/cairn/`.
- The Commute trackers live in this repo at `/bus/` and `/presidio/`.

## How it is built

Plain HTML, CSS, and JavaScript. No framework, no build step, no npm dependencies.

| Path | Job |
|------|-----|
| `index.html` | The whole page, written by hand. All the words are here |
| `styles.css` | All styling for the home page |
| `wall.js` | Builds the 49 screens, bends them into the wide-lens bulge, and plays the clips |
| `site.js` | Opens and closes the three pages. Runs the music player |
| `assets/tv/` | The clips: 49 short silent loops, a still frame for each, and smaller copies for phones in `s/` |
| `assets/art/` | The ink lettering and the mountain, drawn from my own photos |
| `fonts/` | Self-hosted fonts. No third-party font requests |
| `vercel.json` | Rewrites that serve each project's separate deploy under this domain |
| `bus/`, `presidio/` | The Commute trackers: phone-first pages, installable to the home screen |
| `api/` | Vercel functions behind the trackers. They read each agency's public GTFS and GTFS-Realtime feeds directly |
| `tools/`, `.github/` | Tests against fresh snapshots of both agencies' feeds |

## Keeping it light

- A screen plays only while it is inside the window and not behind an open page.
- Phones load smaller copies of the clips and play at most 22 at once.
- If a device drops frames, the outer screens fall back to still pictures.
- Visitors who ask for reduced motion get still pictures.
- With JavaScript off there is no wall, but every word is still readable.

## Deploy

Static site and functions on **Vercel**. It deploys on every push to `main`.

---
Built with plain web tech and Claude Code.
