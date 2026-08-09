#!/usr/bin/env python3
"""Watch recreation.gov for a two-night Eastern Sierra site over Labor Day weekend 2026.

Flags only sites bookable on BOTH target nights, same campground, same site.
Stdlib only — this repo has no build step and no dependencies.

Failures are always reported, never swallowed: a campground that errors shows up
in the ERRORS section and, if every campground fails, the process exits non-zero.
"""

import argparse
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

API = "https://www.recreation.gov/api/camps/availability/campground/{id}/month"

# recreation.gov serves bot-flavoured 403s to non-browser agents.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

AVAILABLE = "available"
# Site classes a 2-person tent party can't actually book.
EXCLUDED_TYPES = ("GROUP", "MANAGEMENT")


class ShapeError(RuntimeError):
    """The endpoint answered, but not with the JSON we know how to read."""


def norm_day(key):
    """'2026-09-05T00:00:00Z' or '...000Z' -> '2026-09-05'."""
    return str(key)[:10]


def month_start_for(night):
    """A month request covers the whole month, so both nights need one call."""
    return night[:7] + "-01T00:00:00.000Z"


def fetch_month(camp_id, start_date, timeout=30, retries=3):
    """GET one campground-month. Retries 429/5xx with backoff; raises otherwise."""
    url = "{}?start_date={}".format(API.format(id=camp_id), start_date)
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.recreation.gov/camping/campgrounds/{}".format(camp_id),
            "Connection": "close",
        },
    )
    ctx = ssl.create_default_context()
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                raw = resp.read().decode("utf-8", "replace")
            break
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")[:200]
            last = "HTTP {} — {}".format(exc.code, body.strip() or exc.reason)
            if exc.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                wait = 5 * (attempt + 1)
                print("    {} — retrying in {}s".format(last, wait), file=sys.stderr)
                time.sleep(wait)
                continue
            raise RuntimeError(last)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last = "network error — {}".format(exc)
            if attempt < retries - 1:
                wait = 5 * (attempt + 1)
                print("    {} — retrying in {}s".format(last, wait), file=sys.stderr)
                time.sleep(wait)
                continue
            raise RuntimeError(last)
    else:  # pragma: no cover - loop always breaks or raises
        raise RuntimeError(last or "unreachable")

    try:
        data = json.loads(raw)
    except ValueError:
        raise ShapeError(
            "response was not JSON (first 300 chars): {!r}".format(raw[:300])
        )

    if not isinstance(data, dict) or "campsites" not in data:
        raise ShapeError(
            "no 'campsites' key — the endpoint shape may have changed. "
            "Top-level keys: {}. First 300 chars: {!r}".format(
                sorted(data)[:12] if isinstance(data, dict) else type(data).__name__,
                raw[:300],
            )
        )
    if not isinstance(data["campsites"], dict):
        raise ShapeError(
            "'campsites' was {}, expected object".format(type(data["campsites"]).__name__)
        )
    return data["campsites"]


def bookable_for_party(site):
    """Screen out site classes this party can't use. Everything else is reported."""
    if str(site.get("type_of_use", "")).strip().lower() == "day":
        return False, "day-use"
    ctype = str(site.get("campsite_type", "")).upper()
    for bad in EXCLUDED_TYPES:
        if bad in ctype:
            return False, bad.lower()
    cap = site.get("max_num_people")
    if isinstance(cap, int) and cap < 2:
        return False, "capacity<2"
    return True, None


def evaluate(campsites, nights):
    """-> (rows, skipped) where each row carries per-night status for one site."""
    rows, skipped = [], 0
    for site_id, site in campsites.items():
        if not isinstance(site, dict):
            continue
        ok, _ = bookable_for_party(site)
        if not ok:
            skipped += 1
            continue

        avail = site.get("availabilities") or {}
        by_day = {norm_day(k): str(v) for k, v in avail.items()}
        statuses = [by_day.get(n, "No data") for n in nights]
        rows.append(
            {
                "site_id": str(site_id),
                "site": str(site.get("site") or site_id),
                "loop": str(site.get("loop") or ""),
                "type": str(site.get("campsite_type") or ""),
                "statuses": statuses,
                "both": all(s.strip().lower() == AVAILABLE for s in statuses),
            }
        )

    rows.sort(key=lambda r: (not r["both"], _site_sort_key(r["site"])))
    return rows, skipped


def _site_sort_key(site):
    """Sort '9' before '10' where site labels are numeric."""
    s = str(site)
    return (0, int(s), "") if s.isdigit() else (1, 0, s)


def load_state(path):
    if not path or not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            state = json.load(fh)
        if isinstance(state, dict) and isinstance(state.get("sites"), dict):
            return state
        print("state file at {} is malformed; treating run as baseline".format(path),
              file=sys.stderr)
    except (ValueError, OSError) as exc:
        print("could not read state ({}); treating run as baseline".format(exc),
              file=sys.stderr)
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--config", default=os.path.join(here, "campgrounds.json"))
    ap.add_argument("--state", default=None,
                    help="previous-run state JSON; absent = baseline run, no alerts")
    ap.add_argument("--out-md", default=None, help="write the full report here")
    ap.add_argument("--transitions-out", default=None,
                    help="write the alert body here (only if there are transitions)")
    ap.add_argument("--delay", type=float, default=2.5,
                    help="seconds between requests (floor 2.0, per site etiquette)")
    args = ap.parse_args()

    delay = max(2.0, args.delay)

    with open(args.config, "r", encoding="utf-8") as fh:
        cfg = json.load(fh)

    nights = cfg["trip"]["nights"]
    camps = sorted(cfg["campgrounds"], key=lambda c: c["rank"])
    reservable = [c for c in camps if c.get("id")]

    results, errors, new_sites = [], [], {}

    print("Checking {} campgrounds for {} — {}s between requests\n".format(
        len(reservable), " + ".join(nights), delay))

    for i, camp in enumerate(reservable):
        print("[{}/{}] {} (id {})".format(i + 1, len(reservable), camp["name"], camp["id"]))
        try:
            campsites = fetch_month(camp["id"], month_start_for(nights[0]))
        except (RuntimeError, ShapeError) as exc:
            print("    FAILED: {}".format(exc), file=sys.stderr)
            errors.append({"name": camp["name"], "id": camp["id"], "error": str(exc)})
            if i < len(reservable) - 1:
                time.sleep(delay)
            continue

        rows, skipped = evaluate(campsites, nights)
        hits = [r for r in rows if r["both"]]
        results.append({"camp": camp, "rows": rows, "hits": hits})

        for r in rows:
            new_sites["{}|{}".format(camp["id"], r["site_id"])] = r["both"]

        print("    {} sites read, {} filtered out, {} open both nights".format(
            len(rows), skipped, len(hits)))

        if i < len(reservable) - 1:
            time.sleep(delay)

    if reservable and len(errors) == len(reservable):
        print("\nEvery campground request failed — refusing to report an empty "
              "result as 'nothing available'.", file=sys.stderr)
        _write_report(args, cfg, results, errors, [], nights)
        return 1

    # Transition detection: alert only on unavailable -> available.
    prior = load_state(args.state)
    baseline = prior is not None and bool(prior.get("sites"))
    transitions = []
    if baseline:
        old = prior["sites"]
        for res in results:
            for r in res["rows"]:
                key = "{}|{}".format(res["camp"]["id"], r["site_id"])
                if r["both"] and not old.get(key, False):
                    transitions.append((res["camp"], r))

    _write_report(args, cfg, results, errors, transitions, nights,
                  baseline=baseline, prior=prior)

    if args.state:
        os.makedirs(os.path.dirname(os.path.abspath(args.state)), exist_ok=True)
        with open(args.state, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "nights": nights,
                    "sites": new_sites,
                },
                fh,
                indent=2,
                sort_keys=True,
            )

    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        with open(gh_out, "a", encoding="utf-8") as fh:
            fh.write("transitions={}\n".format(len(transitions)))
            fh.write("errors={}\n".format(len(errors)))

    if transitions:
        print("\n{} NEW opening(s) since last run.".format(len(transitions)))
    elif baseline:
        print("\nNo change since last run — no notification sent.")
    else:
        print("\nBaseline run: state recorded, no notification by design.")
    return 0


def _fmt_elev(camp):
    return "{:,} ft".format(camp["elevation_ft"]) if camp.get("elevation_ft") else "—"


def _write_report(args, cfg, results, errors, transitions, nights,
                  baseline=False, prior=None):
    n1, n2 = nights[0], nights[1]
    out = []
    out.append("# Eastern Sierra — {} + {}".format(n1, n2))
    out.append("")
    out.append("_Checked {}. Two people, one vehicle, tent, no hookups. "
               "A row counts only if the SAME site is Available on BOTH nights._".format(
                   datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")))
    out.append("")

    hits = [(res["camp"], r) for res in results for r in res["hits"]]
    if hits:
        out.append("## Bookable both nights")
        out.append("")
        out.append("| # | Campground | Site | Loop | {} | {} | Elevation |".format(n1, n2))
        out.append("|---|---|---|---|---|---|---|")
        for camp, r in hits:
            out.append("| {} | {} | {} | {} | {} | {} | {} |".format(
                camp["rank"], camp["name"], r["site"], r["loop"] or "—",
                r["statuses"][0], r["statuses"][1], _fmt_elev(camp)))
        out.append("")
    else:
        out.append("## Bookable both nights")
        out.append("")
        out.append("Nothing. No site in any checked campground is Available on both nights.")
        out.append("")

    out.append("## Per-campground summary")
    out.append("")
    out.append("| # | Campground | ID | Sites read | Open both nights | Elevation |")
    out.append("|---|---|---|---|---|---|")
    for res in results:
        c = res["camp"]
        out.append("| {} | {} | {} | {} | {} | {} |".format(
            c["rank"], c["name"], c["id"], len(res["rows"]),
            len(res["hits"]) or "0", _fmt_elev(c)))
    for e in errors:
        out.append("| — | {} | {} | request failed | — | — |".format(e["name"], e["id"]))
    out.append("")

    if transitions:
        out.append("## New since last run")
        out.append("")
        for camp, r in transitions:
            out.append("- **{}** site **{}**{} — now open both nights. "
                       "https://www.recreation.gov/camping/campgrounds/{}".format(
                           camp["name"], r["site"],
                           " (loop {})".format(r["loop"]) if r["loop"] else "",
                           camp["id"]))
        out.append("")

    fcfs = list(cfg.get("fcfs_phone_only", []))
    extra = [c for c in cfg["campgrounds"] if c.get("fcfs")]
    out.append("## FCFS, phone only")
    out.append("")
    out.append("_No online inventory. An empty result for these is expected, not a bug._")
    out.append("")
    for name in fcfs:
        out.append("- {}".format(name))
    for c in extra:
        out.append("- {} — {}".format(c["name"], c.get("note", "first-come, first-served")))
    out.append("")

    if errors:
        out.append("## Errors")
        out.append("")
        for e in errors:
            out.append("- **{}** (id {}): {}".format(e["name"], e["id"], e["error"]))
        out.append("")

    report = "\n".join(out)
    print()
    print(report)

    if args.out_md:
        with open(args.out_md, "w", encoding="utf-8") as fh:
            fh.write(report + "\n")

    if transitions and args.transitions_out:
        body = ["The following site(s) went from unavailable to available:", ""]
        for camp, r in transitions:
            body.append("- **{}** site **{}**{} — {} and {}".format(
                camp["name"], r["site"],
                " (loop {})".format(r["loop"]) if r["loop"] else "",
                n1, n2))
            body.append("  https://www.recreation.gov/camping/campgrounds/{}".format(camp["id"]))
        body.append("")
        body.append("Book fast — Labor Day inventory does not sit.")
        with open(args.transitions_out, "w", encoding="utf-8") as fh:
            fh.write("\n".join(body) + "\n")


if __name__ == "__main__":
    sys.exit(main())
