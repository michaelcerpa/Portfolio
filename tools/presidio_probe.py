"""Probe 4: official Presidio GO Downtown timetable (which trips need a pass) + a fresh GTFS-RT snapshot."""
import datetime, html, json, os, re, sys, urllib.request
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0"}
def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
            b = r.read(); print(f"  GET {url} -> {r.status} {len(b)}B", flush=True); return b
    except Exception as e:
        print(f"  GET {url} -> ERROR {e}", flush=True); return None
stamp = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
for name, path in [("TripUpdates", "tripupdates"), ("VehiclePositions", "vehiclepositions"), ("Alerts", "alerts")]:
    b = get(f"https://presidiobus.com/gtfs-rt/{path}")
    if b: open(f"{OUT}/{name}-{stamp}.pb", "wb").write(b)
h = (get("https://presidio.gov/visit/getting-to-and-around-the-park/presidio-go-shuttle/presidio-go-downtown-shuttle-schedule/") or b"").decode("utf-8", "replace")
open(f"{OUT}/downtown_schedule.html", "w").write(h)
def cells(row):
    return [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", c))).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]
n = 0
for m in re.finditer(r'"label":("(?:[^"\\]|\\.)*"),"schedule_table":("(?:[^"\\]|\\.)*")', h):
    label, table = json.loads(m.group(1)), json.loads(m.group(2))
    n += 1
    print(f"\n===== TABLE {n} label={label!r} len={len(table)}")
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S)
    if not rows: print(table[:3000]); continue
    for r in rows:
        cs = cells(r); gr = "GREEN" if re.search(r"green|#[0-9a-f]{0,2}[c-f][0-9a-f]{3}", r, re.I) and "background" in r else ""
        print(" | ".join(cs), gr)
    print("RAW SAMPLE:", rows[1][:600] if len(rows) > 1 else "")
print("tables found:", n)
