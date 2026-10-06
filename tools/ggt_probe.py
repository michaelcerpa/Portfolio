"""One-off discovery probe: find Golden Gate Transit data sources reachable without an API key."""
import csv, io, json, math, re, sys, urllib.request, zipfile

UA = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
                    "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"}

def get(url, binary=False, timeout=40):
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            print(f"  GET {url} -> {r.status} {len(body)}B {r.headers.get('content-type')}"
                  f" ACAO={r.headers.get('access-control-allow-origin')}")
            return body if binary else body.decode("utf-8", "replace")
    except Exception as e:
        print(f"  GET {url} -> ERROR {e}")
        return None

def section(t):
    print("\n" + "=" * 20 + " " + t + " " + "=" * 20, flush=True)

URL_RE = re.compile(r"""https?://[^\s"'<>\\)]+""")
KEY = re.compile(r"api|json|real|vehicle|predict|arriv|gtfs|swift|transit|tripshot|avail|infopoint|bustime|rider|map|\.js", re.I)

section("goldengate.org pages")
seen_js = set()
route_pages = set()
for p in ["https://www.goldengate.org/bus/real-time-arrivals/",
          "https://www.goldengate.org/bus/real-time-arrivals/real-time-faqs/",
          "https://www.goldengate.org/bus/schedules-maps-updates/",
          "https://www.goldengate.org/bus/",
          "https://www.goldengate.org/new-real-time-maps--improved-timetables"]:
    html = get(p)
    if not html:
        continue
    for m in re.findall(r"<script[^>]*src=[\"']([^\"']+)", html, re.I):
        seen_js.add(urllib.parse.urljoin(p, m))
    for m in re.findall(r"<iframe[^>]*src=[\"']([^\"']+)", html, re.I):
        print("  IFRAME", m)
    for m in re.findall(r"href=[\"']([^\"']+)", html, re.I):
        full = urllib.parse.urljoin(p, m)
        if re.search(r"/bus/(routes?|schedules?)/|route-\d|/route/", full, re.I):
            route_pages.add(full)
        if re.search(r"gtfs|\.zip|developer|open-data|real", full, re.I):
            print("  LINK", full)
    for u in set(URL_RE.findall(html)):
        if KEY.search(u) and "goldengate.org/assets" not in u:
            print("  URL", u)

import urllib.parse  # noqa: E402 (used above lazily)

section("route pages")
print("  found", len(route_pages), "route-ish links")
for u in sorted(route_pages)[:80]:
    print("  ROUTE", u)
for u in sorted(route_pages)[:3]:
    html = get(u)
    if not html:
        continue
    for m in re.findall(r"<script[^>]*src=[\"']([^\"']+)", html, re.I):
        seen_js.add(urllib.parse.urljoin(u, m))
    for m in re.findall(r"<iframe[^>]*src=[\"']([^\"']+)", html, re.I):
        print("  IFRAME", m)
    for blk in re.findall(r"<script(?![^>]*src)[^>]*>(.*?)</script>", html, re.I | re.S):
        if re.search(r"api|realtime|real-time|vehicle|predict|map", blk, re.I):
            print("  INLINE SCRIPT >>>", blk.strip()[:3000].replace("\n", " "))
    for line in html.splitlines():
        if re.search(r"data-(route|stop|api|url|feed)|realtime|real-time-map|vehicle", line, re.I):
            print("  HTML>", line.strip()[:400])

section("javascript files")
for js in sorted(seen_js):
    if re.search(r"jquery|google|gtag|analytics|bootstrap|recaptcha|facebook|cookie", js, re.I):
        print("  skip", js)
        continue
    src = get(js)
    if not src:
        continue
    for u in sorted(set(URL_RE.findall(src))):
        if KEY.search(u):
            print("   JSURL", u)
    for m in sorted(set(re.findall(r"""["'](/[A-Za-z0-9_\-./]*(?:api|Api|API|vehicle|Vehicle|predict|Predict|realtime|RealTime|arrival|Arrival)[A-Za-z0-9_\-./?=&]*)["']""", src))):
        print("   JSPATH", m)

section("mobility database catalog")
for cat in ["https://files.mobilitydatabase.org/feeds_v2.csv",
            "https://share.mobilitydata.org/catalogs-csv"]:
    txt = get(cat)
    if not txt:
        continue
    rows = list(csv.reader(io.StringIO(txt)))
    hdr = rows[0]
    print("  header:", hdr)
    for r in rows[1:]:
        line = ",".join(r)
        if re.search(r"golden gate", line, re.I):
            print("  ROW", dict(zip(hdr, r)))
    break

section("511 without key")
for u in ["https://api.511.org/transit/StopMonitoring?agency=GG&format=json",
          "https://api.511.org/transit/gtfsoperators"]:
    get(u)
