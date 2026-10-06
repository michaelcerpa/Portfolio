"""Discovery probe for Presidio GO (PresidiGo) shuttle data. Temporary; lives only on this branch."""
import csv, io, json, math, re, sys, urllib.parse, urllib.request, zipfile, os
UA = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"}
def get(url, binary=False, quiet=False, headers=None):
    try:
        req = urllib.request.Request(url, headers={**UA, **(headers or {})})
        with urllib.request.urlopen(req, timeout=30) as r:
            b = r.read()
            if not quiet:
                print(f"  GET {url} -> {r.status} {len(b)}B ct={r.headers.get('content-type')} final={r.geturl()} ACAO={r.headers.get('access-control-allow-origin')}", flush=True)
            return b if binary else b.decode("utf-8", "replace")
    except Exception as e:
        if not quiet: print(f"  GET {url} -> ERROR {e}", flush=True)
        return None
def sec(t): print("\n==== " + t, flush=True)
URL = re.compile(r"""https?://[^\s"'<>\\)]+""")

sec("mobility database catalog: Presidio")
cat = get("https://files.mobilitydatabase.org/feeds_v2.csv")
gtfs_urls = []
if cat:
    rows = list(csv.reader(io.StringIO(cat))); hdr = rows[0]
    for r in rows[1:]:
        line = ",".join(r)
        if re.search(r"presidi", line, re.I):
            d = dict(zip(hdr, r)); print("  ROW", d)
            if d.get("data_type") == "gtfs": gtfs_urls += [d.get("urls.direct_download"), d.get("urls.latest")]

sec("presidiobus.com live map")
js = set()
for u in ["https://presidiobus.com/", "http://presidiobus.com/", "https://www.presidiobus.com/"]:
    h = get(u)
    if not h: continue
    for m in re.findall(r"<script[^>]*src=[\"']([^\"']+)", h, re.I): js.add(urllib.parse.urljoin(u, m))
    for m in re.findall(r"<iframe[^>]*src=[\"']([^\"']+)", h, re.I): print("  IFRAME", m)
    for m in re.findall(r"<meta[^>]*refresh[^>]*>", h, re.I): print("  META", m)
    for x in sorted(set(URL.findall(h)))[:80]: print("  URL", x)
    print("  HEAD>", re.sub(r"\s+", " ", h[:1500]))
    for blk in re.findall(r"<script(?![^>]*src)[^>]*>(.*?)</script>", h, re.I | re.S):
        if len(blk.strip()) > 20: print("  INLINE>", re.sub(r"\s+", " ", blk)[:2500])
    break
for j in sorted(js)[:25]:
    if re.search(r"google|gtag|analytics|jquery\.min|bootstrap", j, re.I): continue
    s = get(j)
    if not s: continue
    for x in sorted(set(URL.findall(s))):
        if re.search(r"api|vehicle|route|stop|predict|eta|feed|gtfs|realtime|socket", x, re.I): print("   JSURL", x)
    for x in sorted(set(re.findall(r"""["'`](/[A-Za-z0-9_\-./]*(?:api|Api|vehicle|Vehicle|route|Route|stop|Stop|eta|Eta|predict|feed|gtfs)[A-Za-z0-9_\-./?=&{}]*)["'`]""", s)))[:60]:
        print("   JSPATH", x)

sec("presidio.gov pages")
for u in ["https://www.presidio.gov/transportation/presidigo/rider-guide",
          "https://presidio.gov/visit/getting-to-and-around-the-park/presidio-go-shuttle",
          "https://presidio.gov/visit/getting-to-and-around-the-park/presidio-go-shuttle/presidio-go-downtown-shuttle-schedule/"]:
    h = get(u)
    if not h: continue
    for x in sorted(set(URL.findall(h))):
        if re.search(r"gtfs|track|live|realtime|real-time|app|map|bus|schedule|pdf|stop", x, re.I) and "presidio.gov/assets" not in x: print("  URL", x)
    txt = re.sub(r"<[^>]+>", " ", h); txt = re.sub(r"\s+", " ", txt)
    for kw in ["Stop ID", "41411", "Transbay", "Embarcadero", "Van Ness", "Letterman", "Lombard", "Transit Center", "real time", "real-time"]:
        for m in re.finditer(kw, txt):
            print("  CTX", kw, "→", txt[max(0, m.start()-160): m.end()+200]); break

sec("static GTFS candidates")
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
for u in [x for x in gtfs_urls if x]:
    z = get(u, binary=True)
    if not z or z[:2] != b"PK": continue
    open(f"{OUT}/presidio_gtfs.zip", "wb").write(z)
    zf = zipfile.ZipFile(io.BytesIO(z))
    def table(n):
        with zf.open(n) as f: return list(csv.DictReader(io.TextIOWrapper(f, "utf-8-sig")))
    names = zf.namelist(); print("  files", names)
    for n in ["agency.txt", "feed_info.txt", "routes.txt", "calendar.txt", "calendar_dates.txt"]:
        if n in names: print(" ", n); [print("    ", r) for r in table(n)[:30]]
    stops = {s["stop_id"]: s for s in table("stops.txt")}
    print("  stops:"); [print("    ", s["stop_id"], s.get("stop_code"), s["stop_name"], s["stop_lat"], s["stop_lon"]) for s in stops.values()]
    trips = table("trips.txt"); print("  trips", len(trips), "sample", trips[:3])
    st = {}
    for r in table("stop_times.txt"): st.setdefault(r["trip_id"], []).append(r)
    seen = set()
    for t in trips:
        rows = sorted(st.get(t["trip_id"], []), key=lambda r: int(r["stop_sequence"]))
        pat = (t["route_id"], t.get("direction_id"), tuple(r["stop_id"] for r in rows))
        if pat in seen: continue
        seen.add(pat)
        print(f"  PATTERN route={t['route_id']} dir={t.get('direction_id')} svc={t['service_id']} headsign={t.get('trip_headsign')}")
        for r in rows: print(f"     {r['stop_sequence']:>3} {r['arrival_time']} {r['departure_time']} pu={r.get('pickup_type')} do={r.get('drop_off_type')} {r['stop_id']} {stops[r['stop_id']]['stop_name']}")
    break

sec("511 operator list (no key) and transit.land")
get("https://api.511.org/transit/operators?format=json")
