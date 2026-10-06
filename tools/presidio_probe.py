"""Probe 2: find the Syncromatics portal API behind presidiobus.com + the official Downtown timetable."""
import json, re, sys, urllib.parse, urllib.request, os, html as H
UA = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Accept": "application/json, text/plain, */*"}
def get(url, quiet=False, headers=None):
    try:
        req = urllib.request.Request(url, headers={**UA, **(headers or {})})
        with urllib.request.urlopen(req, timeout=30) as r:
            b = r.read().decode("utf-8", "replace")
            if not quiet: print(f"  GET {url} -> {r.status} {len(b)}B ct={r.headers.get('content-type')} ACAO={r.headers.get('access-control-allow-origin')} cache={r.headers.get('cache-control')}", flush=True)
            return b
    except Exception as e:
        if not quiet: print(f"  GET {url} -> ERROR {e}", flush=True)
        return None
def sec(t): print("\n==== " + t, flush=True)
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = "https://presidiobus.com"

sec("portal JS: endpoints")
home = get(BASE + "/")
assets = sorted(set(re.findall(r'"(/assets/[^"]+\.js)"', home or "")))
print("  assets:", len(assets))
found = set()
for a in assets:
    s = get(BASE + a, quiet=True) or ""
    for m in re.findall(r"""[`"'](/(?:api|Api|Route|Region|Stop|Vehicle|portal)[A-Za-z0-9_\-./${}?=&:]*)[`"']""", s): found.add(("path", m, a))
    for m in re.findall(r"""https?://[A-Za-z0-9.\-]*(?:syncromatics|presidiobus)[A-Za-z0-9_\-./${}?=&:]*""", s): found.add(("url", m, a))
    for m in re.finditer(r"fetch\(|axios|\.get\(|apiBase|baseUrl|baseURL|/api/", s):
        ctx = s[max(0, m.start()-120): m.end()+220].replace("\n", " ")
        if re.search(r"route|stop|vehicle|arriv|predict|api", ctx, re.I): found.add(("ctx", ctx[:340], a))
for kind, v, a in sorted(found)[:160]: print(f"  {kind:4} {v}   [{a.split('/')[-1]}]")

sec("candidate endpoints")
cands = ["/api/routes", "/api/v1/routes", "/api/route/66", "/api/routes/66", "/api/routes/66/vehicles", "/api/routes/66/stops",
         "/api/routes/66/directions", "/api/vehicles", "/api/stops", "/api/alerts", "/api/messages",
         "/Region/0/Routes", "/Route/66/Directions", "/Route/66/Vehicles", "/Route/66/Waypoints", "/Route/66/Direction/0/Stops",
         "/Route/66/Direction/1/Stops", "/transit.data", "/_root.data", "/map.data", "/__manifest?p=/&version=1"]
for c in cands:
    b = get(BASE + c)
    if b: print("     ", b[:700].replace("\n", " "))

sec("official Downtown timetable (presidio.gov)")
h = get("https://presidio.gov/visit/getting-to-and-around-the-park/presidio-go-shuttle/presidio-go-downtown-shuttle-schedule/") or ""
open(f"{OUT}/downtown_schedule.html", "w").write(h)
for t in re.findall(r"<table.*?</table>", h, re.S | re.I)[:6]:
    rows = []
    for tr in re.findall(r"<tr.*?</tr>", t, re.S | re.I):
        cells = [H.unescape(re.sub(r"<[^>]+>", " ", c)).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S | re.I)]
        rows.append(" | ".join(re.sub(r"\s+", " ", c) for c in cells))
    print("  TABLE rows:", len(rows))
    for r in rows: print("   ", r)
# also the escaped JSON copy inside Next/ReactRouter payload
for m in re.finditer(r"\\u003ctable.*?\\u003c/table\\u003e", h, re.S):
    t = m.group(0).encode().decode("unicode_escape", "ignore")
    rows = []
    for tr in re.findall(r"<tr.*?</tr>", t, re.S | re.I):
        cells = [H.unescape(re.sub(r"<[^>]+>", " ", c)).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S | re.I)]
        rows.append(" | ".join(re.sub(r"\s+", " ", c) for c in cells))
    print("  JSON-TABLE rows:", len(rows))
    for r in rows[:80]: print("   ", r)
txt = re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", h)))
for kw in ["Weekday", "Monday", "Weekend", "Lombard Gate", "Letterman", "Stop ID", "Transbay", "Beale", "Fremont", "Drumm", "Main St"]:
    for m in list(re.finditer(kw, txt))[:2]: print("  CTX", kw, "→", txt[max(0, m.start()-200): m.end()+300])
