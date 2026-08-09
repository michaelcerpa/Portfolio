# sierra-watch

Watches recreation.gov for a **two-night, same-site** Eastern Sierra booking over
Labor Day weekend 2026 — **Sat Sep 5 + Sun Sep 6**. Two people, one vehicle, tent,
no hookups.

Stdlib Python only. No dependencies, no build step — same as the rest of this repo.

## Run it

```sh
python3 tools/sierra-watch/check.py                      # print a report, keep no state
python3 tools/sierra-watch/check.py --state .state/state.json   # + transition detection
```

Useful flags: `--out-md report.md`, `--transitions-out transitions.md`,
`--delay 2.5` (seconds between requests, floored at 2.0).

## What counts as a hit

A row is flagged only when the **same site** in the **same campground** is
`Available` on **both** nights. One night open is not a hit. Group sites,
management sites, day-use sites, and sites capped under 2 people are filtered
out and counted in the per-campground summary, not silently dropped.

## Campground IDs

Every ID in `campgrounds.json` was read out of a real
`recreation.gov/camping/campgrounds/{id}` URL. None were guessed. The two IDs
supplied with the original request (Bishop Park `10132033`, Convict Lake
`234311`) were independently confirmed by lookup.

| # | Campground | ID | Elevation |
|---|---|---|---|
| 1 | Big Pine Creek | 232305 | 7,700 ft |
| 2 | Rock Creek Lake | 233907 | — |
| 3 | Lake Mary | 233404 | 8,900 ft |
| 4 | Coldwater | 234290 | 8,900 ft |
| 5 | Four Jeffrey | 233807 | 8,100 ft |
| 6 | Forks | 10132055 | — |
| 7 | Big Trees | *none — FCFS* | ~7,000 ft |
| 8 | Bishop Park | 10132033 | — |
| 9 | Sherwin Creek | 232271 | 7,600 ft |
| 10 | Convict Lake | 234311 | 7,500 ft |

Elevations are shown only where recreation.gov or the USFS states them. A dash
means it was not stated on the listing — not that the campground is low. The
9,000 ft figure that turns up for Rock Creek Lake belongs to the adjacent
**Group Camp** (232239), a different facility, so it is deliberately not used here.

**Big Trees has no reservable inventory.** USFS Inyo lists it as first-come,
first-served — you register at the campground. It was in the original list as
reservable; it is not, so it is reported under FCFS instead of being queried.

## Scheduling

`.github/workflows/sierra-watch.yml` runs every 6 hours (`0 */6 * * *`).

> **GitHub only fires `schedule` from the default branch.** The workflow must be
> merged to `main` before the cron will ever run. Until then, trigger it by hand
> with **Actions → sierra-watch → Run workflow**, which works from any branch.

GitHub also auto-disables scheduled workflows after 60 days without repo
activity — worth knowing for a watch that runs until September.

## Notifications

You are alerted **only on a transition from unavailable to available**. Nothing
is sent for a no-change run, for a baseline run, or when a site disappears.

This repo had **no existing email or notification path** — it is a static site
whose only "email" is a `mailto:` link in `index.html`. So rather than invent
credentials, the default channel is a **GitHub issue**, assigned to you, which
reaches michael.cerp@gmail.com through your existing GitHub notification
settings with zero configuration.

Direct email is opt-in. Set these repo secrets and `notify_email.py` starts
sending as well:

| Secret | Notes |
|---|---|
| `SMTP_HOST` | e.g. `smtp.gmail.com` |
| `SMTP_PORT` | optional, default `587` (`465` uses implicit TLS) |
| `SMTP_USER` | also the From address |
| `SMTP_PASS` | app password, not your account password |
| `NOTIFY_TO` | where the alert goes |

## State

Previous availability lives on a dedicated orphan branch, `sierra-watch-state`,
force-pushed as a single commit each run — durable across runners, no history
bloat, and no commits on `main` (which would trigger a pointless Vercel rebuild).

The first run only records a baseline and never alerts, so losing that branch
costs you one silent cycle rather than a burst of false alarms.

## Failure behaviour

The site rate-limits and occasionally serves bot-flavoured 403s. So:

- One request every 2.5s, never faster.
- 429 and 5xx get three tries with backoff.
- A campground that fails is listed under **Errors** in the report.
- If the JSON is missing `campsites`, the run raises `ShapeError` with the real
  body rather than reporting zero availability.
- If **every** campground fails, the run exits non-zero instead of reporting a
  reassuring empty table.

An empty result for the FCFS campgrounds is expected, not a bug.
