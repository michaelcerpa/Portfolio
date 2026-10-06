"""Probe 2: realtime.goldengate.org endpoints + static GTFS analysis for the commute."""
import csv, io, math, re, subprocess, sys, urllib.parse, urllib.request, zipfile
from collections import defaultdict, Counter

UA = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
                    "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Origin": "https://mcerpa.com"}

def get(url, binary=False, timeout=40, quiet=False):
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            if not quiet:
                print(f"  GET {url} -> {r.status} {len(body)}B ct={r.headers.get('content-type')}"
                      f" ACAO={r.headers.get('access-control-allow-origin')} cache={r.headers.get('cache-control')}"
                      f" lm={r.headers.get('last-modified')}", flush=True)
            return body if binary else body.decode("utf-8", "replace")
    except Exception as e:
        if not quiet:
            print(f"  GET {url} -> ERROR {e}", flush=True)
        return None

def section(t):
    print("\n" + "=" * 20 + " " + t + " " + "=" * 20, flush=True)

section("realtime.goldengate.org")
base = "https://realtime.goldengate.org"
found_rt = {}
for path in ["/", "/gtfsstatic/", "/gtfsrealtime/", "/gtfsrealtime/TripUpdates", "/gtfsrealtime/VehiclePositions",
             "/gtfsrealtime/Alerts", "/gtfsrealtime/ServiceAlerts", "/gtfs-rt/", "/gtfsrt/", "/GTFSRealTime/",
             "/gtfsrt/tripupdates", "/gtfsrt/vehiclepositions", "/gtfs-realtime/", "/TripUpdates", "/VehiclePositions",
             "/tripupdates", "/vehiclepositions", "/alerts", "/InfoPoint/", "/api/", "/robots.txt", "/sitemap.xml"]:
    b = get(base + path, binary=True)
    if b:
        head = b[:300]
        try:
            print("    first bytes:", head.decode("utf-8")[:300].replace("\n", " "))
        except UnicodeDecodeError:
            print("    first bytes (binary):", head[:60])
        if path != "/" and not head.lstrip().startswith(b"<"):
            found_rt[path] = b
        if head.lstrip().startswith(b"<"):
            for m in set(re.findall(rb"""(?:href|src)=["']([^"']+)""", b)):
                print("    link:", m.decode(errors="replace"))

section("goldengate.org schedule pages (real-time maps live here)")
html = get("https://www.goldengate.org/bus/schedules-maps/")
route_links = set()
if html:
    for m in re.findall(r"href=[\"']([^\"']+)", html, re.I):
        full = urllib.parse.urljoin("https://www.goldengate.org/bus/schedules-maps/", m)
        if "/bus/" in full and re.search(r"\d", full.split("/bus/")[1]):
            route_links.add(full.split("#")[0])
print("  route links:", len(route_links))
for u in sorted(route_links)[:200]:
    print("   ", u)
pick = [u for u in sorted(route_links) if re.search(r"route-?(101|2|30)\b|/(101|2|30)/", u)] or sorted(route_links)[:2]
js_seen = set()
for u in pick[:2]:
    page = get(u)
    if not page:
        continue
    for m in re.findall(r"<iframe[^>]*src=[\"']([^\"']+)", page, re.I):
        print("  IFRAME", m)
    for m in re.findall(r"<script[^>]*src=[\"']([^\"']+)", page, re.I):
        js_seen.add(urllib.parse.urljoin(u, m.replace("&amp;", "&")))
    for blk in re.findall(r"<script(?![^>]*src)[^>]*>(.*?)</script>", page, re.I | re.S):
        if re.search(r"realtime|vehicle|predict|leaflet|mapbox|google\.maps|L\.map|gtfs", blk, re.I):
            print("  INLINE >>>", re.sub(r"\s+", " ", blk)[:4000])
    for line in page.splitlines():
        if re.search(r"realtime\.goldengate|data-route|data-stop|map-container|id=\"map|leaflet|mapbox", line, re.I):
            print("  HTML>", line.strip()[:500])
for js in sorted(js_seen):
    if re.search(r"jquery|google|gtag|translate|recaptcha|galleria|slick|modernizr|picker|headroom|enquire|ScriptResource|WebResource|UltimateSpell", js, re.I):
        continue
    src = get(js)
    if src and re.search(r"realtime|vehicle|gtfs|predict", src, re.I):
        for m in sorted(set(re.findall(r"""["'`]([^"'`\s]*(?:realtime|gtfs|vehicle|Vehicle|predict|Predict|arrival)[^"'`\s]*)["'`]""", src))):
            print("   JSREF", m)

section("static GTFS")
z = get(base + "/gtfsstatic/GTFSTransitData.zip", binary=True) or get("https://files.mobilitydatabase.org/mdb-67/latest.zip", binary=True)
zf = zipfile.ZipFile(io.BytesIO(z))
print("  files:", [(i.filename, i.file_size) for i in zf.infolist()])
def table(name):
    with zf.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, "utf-8-sig")))
for n in ["feed_info.txt", "agency.txt"]:
    if n in zf.namelist():
        print(" ", n, table(n))
cal = table("calendar.txt") if "calendar.txt" in zf.namelist() else []
print("  calendar:")
for c in cal:
    print("   ", c)
if "calendar_dates.txt" in zf.namelist():
    cd = table("calendar_dates.txt")
    print("  calendar_dates count", len(cd), "sample", cd[:15])
routes = {r["route_id"]: r for r in table("routes.txt")}
print("  routes:", len(routes))
for r in routes.values():
    print("   ", r.get("route_id"), r.get("route_short_name"), "|", r.get("route_long_name"), "| type", r.get("route_type"), "| color", r.get("route_color"))
stops = {s["stop_id"]: s for s in table("stops.txt")}
print("  stops:", len(stops), "columns", list(next(iter(stops.values())).keys()))

def dist(a, b, c, d):
    R = 6371000
    p1, p2 = math.radians(a), math.radians(c)
    dp, dl = p2 - p1, math.radians(d - b)
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))

HOME = (37.7999, -122.4362)    # Lombard St & Fillmore St (public intersection)
OFFICE = (37.7896, -122.4022)  # Montgomery St, Financial District
near_home = {sid: dist(*HOME, float(s["stop_lat"]), float(s["stop_lon"])) for sid, s in stops.items()}
near_home = {k: v for k, v in near_home.items() if v < 650}
near_off = {sid: dist(*OFFICE, float(s["stop_lat"]), float(s["stop_lon"])) for sid, s in stops.items()}
near_off = {k: v for k, v in near_off.items() if v < 700}
print("  stops near Lombard/Fillmore:")
for k, v in sorted(near_home.items(), key=lambda x: x[1]):
    s = stops[k]; print(f"    {k} code={s.get('stop_code')} {s['stop_name']} ({s['stop_lat']},{s['stop_lon']}) {v:.0f}m")
print("  stops near Montgomery:")
for k, v in sorted(near_off.items(), key=lambda x: x[1]):
    s = stops[k]; print(f"    {k} code={s.get('stop_code')} {s['stop_name']} ({s['stop_lat']},{s['stop_lon']}) {v:.0f}m")

trips = {t["trip_id"]: t for t in table("trips.txt")}
print("  trips:", len(trips), "columns", list(next(iter(trips.values())).keys()))
by_trip = defaultdict(list)
with zf.open("stop_times.txt") as f:
    rdr = csv.DictReader(io.TextIOWrapper(f, "utf-8-sig"))
    cols = rdr.fieldnames
    for row in rdr:
        if row["stop_id"] in near_home or row["stop_id"] in near_off:
            by_trip[row["trip_id"]].append(row)
print("  stop_times columns", cols)
def secs(t):
    h, m, s = map(int, t.split(":")); return h * 3600 + m * 60 + s
commute = []
home_routes = defaultdict(Counter)
for tid, rows in by_trip.items():
    rows.sort(key=lambda r: int(r["stop_sequence"]))
    t = trips[tid]
    for r in rows:
        if r["stop_id"] in near_home:
            home_routes[r["stop_id"]][(routes[t["route_id"]]["route_short_name"], t.get("direction_id"), t.get("trip_headsign"))] += 1
    hs = [r for r in rows if r["stop_id"] in near_home]
    os_ = [r for r in rows if r["stop_id"] in near_off]
    if hs and os_ and int(os_[-1]["stop_sequence"]) > int(hs[0]["stop_sequence"]):
        h = min(hs, key=lambda r: near_home[r["stop_id"]])
        o = min([r for r in os_ if int(r["stop_sequence"]) > int(h["stop_sequence"])], key=lambda r: near_off[r["stop_id"]])
        commute.append((t["service_id"], h["departure_time"], routes[t["route_id"]]["route_short_name"], t.get("trip_headsign"),
                        h["stop_id"], o["stop_id"], o["arrival_time"], tid, t.get("direction_id"), t.get("shape_id"),
                        [(r["stop_id"], r["departure_time"]) for r in rows]))
print("  routes per home-area stop (route, dir, headsign: trips):")
for sid, c in home_routes.items():
    print(f"   {sid} {stops[sid]['stop_name']}: {dict(c)}")
print("  commute trips (home-area stop then office-area stop):", len(commute))
for c in sorted(commute, key=lambda c: (c[0], secs(c[1]))):
    print("   svc=%s dep=%s rt=%s hs=%s from=%s to=%s arr=%s trip=%s dir=%s shape=%s" % c[:10])
for c in sorted(commute, key=lambda c: (c[0], secs(c[1])))[:3]:
    print("   detail", c[7], c[10])

section("GTFS-RT decode")
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "gtfs-realtime-bindings"], check=False)
try:
    from google.transit import gtfs_realtime_pb2
    for path, b in found_rt.items():
        fm = gtfs_realtime_pb2.FeedMessage()
        try:
            fm.ParseFromString(b)
        except Exception as e:
            print("  ", path, "not protobuf:", e); continue
        print(f"  {path}: header ts={fm.header.timestamp} ver={fm.header.gtfs_realtime_version} entities={len(fm.entity)}")
        for e in fm.entity[:6]:
            print("   ", str(e).replace("\n", " ")[:900])
        matched = sum(1 for e in fm.entity if (e.trip_update.trip.trip_id or e.vehicle.trip.trip_id) in trips)
        print("    entities whose trip_id is in static GTFS:", matched)
except Exception as e:
    print("  decode failed", e)
