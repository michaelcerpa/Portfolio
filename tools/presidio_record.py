"""Record Presidio GO's live feed every 15 s (raw predictions + vehicle positions) and the deployed /api/pgo every 30 s."""
import json, sys, time, urllib.request
from google.transit import gtfs_realtime_pb2 as g
OUT, MINUTES = sys.argv[1], float(sys.argv[2])
END = time.time() + MINUTES * 60
def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=12) as r:
            return r.read()
    except Exception as e:
        return None
feed, api = open(f"{OUT}/feed.jsonl", "a"), open(f"{OUT}/api.jsonl", "a")
n = 0
while time.time() < END:
    t0 = time.time()
    rec = {"t": int(t0)}
    tu = get("https://presidiobus.com/gtfs-rt/tripupdates")
    vp = get("https://presidiobus.com/gtfs-rt/vehiclepositions")
    if tu:
        m = g.FeedMessage(); m.ParseFromString(tu); rec["tu_ts"] = m.header.timestamp
        rec["tu"] = [{"trip": e.trip_update.trip.trip_id, "date": e.trip_update.trip.start_date, "veh": e.trip_update.vehicle.id,
                      "stops": {str(u.stop_sequence): u.arrival.time or u.departure.time for u in e.trip_update.stop_time_update}}
                     for e in m.entity if e.HasField("trip_update")]
    if vp:
        m = g.FeedMessage(); m.ParseFromString(vp); rec["vp_ts"] = m.header.timestamp
        rec["vp"] = [{"veh": e.vehicle.vehicle.id, "trip": e.vehicle.trip.trip_id, "lat": round(e.vehicle.position.latitude, 6),
                      "lon": round(e.vehicle.position.longitude, 6), "ts": e.vehicle.timestamp, "seq": e.vehicle.current_stop_sequence,
                      "status": e.vehicle.current_status} for e in m.entity if e.HasField("vehicle")]
    feed.write(json.dumps(rec) + "\n"); feed.flush()
    if n % 2 == 0:
        for q in ["from=31933&to=8894813", "from=8894813&to=31980"]:
            b = get("https://mcerpa.com/api/pgo/?" + q)
            if b:
                try: api.write(json.dumps({"t": int(t0), "q": q, "body": json.loads(b)}) + "\n"); api.flush()
                except Exception: pass
    n += 1
    time.sleep(max(1, 15 - (time.time() - t0)))
