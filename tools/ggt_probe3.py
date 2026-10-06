"""Probe 3: save real feed samples as test fixtures + inspect the details the app relies on."""
import csv, io, os, sys, urllib.request, zipfile, datetime
from collections import defaultdict

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read()

stamp = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
z = get("https://realtime.goldengate.org/gtfsstatic/GTFSTransitData.zip")
open(f"{OUT}/GTFSTransitData.zip", "wb").write(z)
for name in ["TripUpdates", "VehiclePositions"]:
    b = get(f"https://realtime.goldengate.org/gtfsrealtime/{name}")
    open(f"{OUT}/{name}-{stamp}.pb", "wb").write(b)
    print(name, len(b))

from google.transit import gtfs_realtime_pb2
for name in ["TripUpdates", "VehiclePositions"]:
    fm = gtfs_realtime_pb2.FeedMessage()
    fm.ParseFromString(open(f"{OUT}/{name}-{stamp}.pb", "rb").read())
    open(f"{OUT}/{name}-{stamp}.txt", "w").write(str(fm))
    print(f"==== {name}: ts={fm.header.timestamp} entities={len(fm.entity)}")
    for e in fm.entity[:3]:
        print(str(e)[:2500])

zf = zipfile.ZipFile(io.BytesIO(z))
def table(name):
    with zf.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, "utf-8-sig")))
for n in ["realtime_routes.txt", "directions.txt", "calendar_attributes.txt"]:
    print("====", n); [print(r) for r in table(n)]
print("==== stop_attributes head"); [print(r) for r in table("stop_attributes.txt")[:5]]
print("==== timepoints head"); [print(r) for r in table("timepoints.txt")[:5]]
stops = {s["stop_id"]: s for s in table("stops.txt")}
trips = {t["trip_id"]: t for t in table("trips.txt")}
st = defaultdict(list)
for r in table("stop_times.txt"):
    st[r["trip_id"]].append(r)
seen = set()
for tid in ["9503159", "9502610", "9503032", "9503059", "9503039", "9503110", "9502708"]:
    rows = sorted(st[tid], key=lambda r: int(r["stop_sequence"]))
    print(f"==== trip {tid} route {trips[tid]['route_id']} shape {trips[tid]['shape_id']}: {len(rows)} stops")
    for r in rows:
        s = stops[r["stop_id"]]
        print(f"  {r['stop_sequence']:>3} {r['arrival_time']} {r['departure_time']} pu={r['pickup_type']} do={r['drop_off_type']} "
              f"dist={r['shape_dist_traveled']} {r['stop_id']} {s['stop_name'].strip()} ({s['stop_lat'].strip()},{s['stop_lon'].strip()})")
