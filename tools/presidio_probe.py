"""Probe 3: Presidio GO GTFS + GTFS-RT from presidiobus.com — save as fixtures and summarize."""
import csv, io, math, os, sys, urllib.request, zipfile, datetime
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0"}
def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
            b = r.read()
            print(f"  GET {url} -> {r.status} {len(b)}B ct={r.headers.get('content-type')} ACAO={r.headers.get('access-control-allow-origin')} lm={r.headers.get('last-modified')} cache={r.headers.get('cache-control')}", flush=True)
            return b
    except Exception as e:
        print(f"  GET {url} -> ERROR {e}", flush=True); return None
stamp = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
z = get("https://presidiobus.com/gtfs.zip") or get("https://presidiobus.com/gtfs")
for name, path in [("TripUpdates", "tripupdates"), ("VehiclePositions", "vehiclepositions"), ("Alerts", "alerts")]:
    b = get(f"https://presidiobus.com/gtfs-rt/{path}")
    if b: open(f"{OUT}/{name}-{stamp}.pb", "wb").write(b); print("    first bytes", b[:80])
if not z or z[:2] != b"PK":
    print("NO ZIP", z[:300] if z else None); sys.exit(0)
open(f"{OUT}/GTFSTransitData.zip", "wb").write(z)
zf = zipfile.ZipFile(io.BytesIO(z))
def table(n):
    with zf.open(n) as f: return list(csv.DictReader(io.TextIOWrapper(f, "utf-8-sig")))
names = zf.namelist(); print("files", [(i.filename, i.file_size) for i in zf.infolist()])
for n in ["agency.txt", "feed_info.txt", "routes.txt", "calendar.txt", "calendar_dates.txt"]:
    if n in names:
        rows = table(n); print(f"== {n} ({len(rows)})"); [print("  ", r) for r in rows[:25]]
stops = {s["stop_id"]: s for s in table("stops.txt")}
print("== stops"); [print("  ", s) for s in stops.values()]
trips = table("trips.txt"); print("== trips", len(trips), "cols", list(trips[0].keys()))
st = {}
for r in table("stop_times.txt"): st.setdefault(r["trip_id"], []).append(r)
print("== stop_times cols", list(next(iter(st.values()))[0].keys()))
pats = {}
for t in trips:
    rows = sorted(st.get(t["trip_id"], []), key=lambda r: int(r["stop_sequence"]))
    key = (t["route_id"], t.get("direction_id"), tuple(r["stop_id"] for r in rows))
    pats.setdefault(key, []).append((t, rows))
for (rid, d, seq), lst in pats.items():
    t, rows = lst[0]
    print(f"== PATTERN route={rid} dir={d} trips={len(lst)} headsign={t.get('trip_headsign')} shortname={t.get('trip_short_name')} services={sorted(set(x[0]['service_id'] for x in lst))}")
    for r in rows: print(f"     {r['stop_sequence']:>3} {r['arrival_time']} {r['departure_time']} pu={r.get('pickup_type')} do={r.get('drop_off_type')} tp={r.get('timepoint')} {r['stop_id']} {stops[r['stop_id']]['stop_name']}")
    print("     first departures:", sorted(x[1][0]["departure_time"] for x in lst)[:40])
