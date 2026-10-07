// Tests for the /presidio/ shuttle tracker (Presidio GO): holidays, the 50 Beale turnaround, pass-only runs.
//   PGO_FIXTURES=<dir with GTFSTransitData.zip, TripUpdates-*.pb, VehiclePositions-*.pb> node --test tools/shuttle.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const c = require("../api/_lib/commute");

const FX = process.env.PGO_FIXTURES;

/* ---------- synthetic loop: P → L → V (drop off only) → B (turnaround) → D → M → P ---------- */

function zip(files) {
  const parts = [], central = [];
  let off = 0;
  for (const [n, txt] of Object.entries(files)) {
    const name = Buffer.from(n), body = Buffer.from(txt);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(body.length, 22); h.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(body.length, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(off, 42);
    parts.push(h, name, body); central.push(cd, name); off += 30 + name.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(central.length / 2, 8);
  eocd.writeUInt16LE(central.length / 2, 10); eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}
function loop(id, svc, h, m) {
  const t = (min) => { const x = h * 60 + m + min; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}:00`; };
  return [["P", 0, 0], ["L", 3, 0], ["V", 10, 1], ["B", 30, 0], ["D", 32, 0], ["M", 52, 0], ["P", 55, 0]]
    .map(([stop, min, nopickup], seq) => `${id},${t(min)},${t(min)},${stop},${seq},${nopickup},`).join("\n") + "\n";
}
function loopModel(extraDates = "") {
  return c.buildModel(zip({
    "routes.txt": "route_id,route_short_name,route_long_name,route_color,route_text_color\n66,Presidio GO Downtown,Presidio GO Downtown,EA321B,FFFFFF\n",
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\nP,Transit Center,37.8018,-122.4559\nL,Lombard Gate,37.7984,-122.4473\n" +
      "V,Van Ness & Union (Drop Off),37.7983,-122.4245\nB,Beale & Mission,37.7916,-122.3965\nD,Drumm & California,37.7938,-122.3963\nM,Letterman,37.7981,-122.4482\n",
    "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
      "1,1,1,1,1,1,0,0,20260101,20991231\n2,0,0,0,0,0,1,1,20260101,20991231\n",
    "calendar_dates.txt": "service_id,date,exception_type\n" + extraDates,
    "trips.txt": "trip_id,route_id,service_id,trip_headsign,direction_id,shape_id\nPD0730,66,1,COMMUTER,0,\nPD0800,66,1,COMMUTER,0,\nPDW900,66,2,COMMUTER,0,\n",
    "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n" +
      loop("PD0730", 1, 7, 30) + loop("PD0800", 1, 8, 0) + loop("PDW900", 2, 9, 0),
  }), "test");
}
const none = { tripUpdates: [], vehicles: [] };
const at = (ymd, h, m) => c.serviceDayBase(ymd) + h * 3600 + m * 60;
const TUE = "20261006", COLUMBUS = "20261012";

test("federal holidays as observed", () => {
  const y26 = c.federalHolidays(2026);
  assert.equal(y26["20261012"], "Columbus Day");
  assert.equal(y26["20261126"], "Thanksgiving");
  assert.equal(y26["20260703"], "Independence Day");             // July 4 is a Saturday → Friday
  assert.equal(Object.keys(y26).length, 11);
  assert.equal(c.federalHolidays(2027)["20270705"], "Independence Day"); // Sunday → Monday
  assert.equal(c.federalHolidays(2028)["20271231"], "New Year's Day");   // Jan 1 2028 is a Saturday
  assert.equal(c.federalHolidays(2026)["20260525"], "Memorial Day");     // last Monday of May
});

test("loop: board mid-loop, alight at the turnaround, and the reverse", () => {
  const m = loopModel();
  const am = c.departures(m, none, { from: ["L"], to: ["B"], now: at(TUE, 7, 0) });
  assert.deepEqual(am.map((d) => [d.trip, d.sched, d.dest.sched]), [["PD0730", at(TUE, 7, 33), at(TUE, 8, 0)], ["PD0800", at(TUE, 8, 3), at(TUE, 8, 30)]]);
  const pm = c.departures(m, none, { from: ["B"], to: ["M"], now: at(TUE, 7, 50) });
  assert.deepEqual(pm.map((d) => [d.trip, d.sched, d.dest.sched]), [["PD0730", at(TUE, 8, 0), at(TUE, 8, 22)], ["PD0800", at(TUE, 8, 30), at(TUE, 8, 52)]]);
  // Van Ness on the way downtown is drop-off only.
  assert.equal(c.departures(m, none, { from: ["V"], to: ["B"], now: at(TUE, 7, 0) }).length, 0);
});

test("federal holiday runs the weekend schedule; the feed's own calendar_dates still wins", () => {
  const m = c.weekendOnHolidays(loopModel(), [2026]);
  assert.equal(m.holidays[COLUMBUS], "Columbus Day");
  assert.deepEqual(c.departures(m, none, { from: ["L"], to: ["B"], now: at(COLUMBUS, 7, 0), windowMin: 240 }).map((d) => d.trip), ["PDW900"]);
  assert.deepEqual(c.departures(m, none, { from: ["L"], to: ["B"], now: at(TUE, 7, 0), windowMin: 240 }).map((d) => d.trip), ["PD0730", "PD0800"]);
  const kept = c.weekendOnHolidays(loopModel("1,20261012,1\n"), [2026]);
  assert.deepEqual(c.departures(kept, none, { from: ["L"], to: ["B"], now: at(COLUMBUS, 7, 0), windowMin: 240 }).map((d) => d.trip),
    ["PD0730", "PD0800", "PDW900"]);
});

test("turnaround: a shuttle there early still leaves on schedule; arriving there early is still early", () => {
  const m = loopModel();
  // The feed predicts PD0730 at Beale 4 minutes before the timetable (its arrival; it then waits).
  const tu = { trip: { tripId: "PD0730", startDate: TUE }, stops: [{ seq: 3, arr: { time: at(TUE, 7, 56) }, dep: { time: at(TUE, 7, 56) } },
                                                                   { seq: 4, arr: { time: at(TUE, 8, 2) }, dep: { time: at(TUE, 8, 2) } }] };
  const live = { tripUpdates: [tu], vehicles: [] };
  const [held] = c.departures(m, live, { from: ["B"], to: ["M"], now: at(TUE, 7, 50), holdAt: ["B"] });
  assert.deepEqual([held.trip, held.pred, held.delay], ["PD0730", at(TUE, 8, 0), 0]);
  const [raw] = c.departures(m, live, { from: ["B"], to: ["M"], now: at(TUE, 7, 50) });
  assert.equal(raw.delay, -240);
  // Still listed while it waits there.
  assert.equal(c.departures(m, live, { from: ["B"], to: ["M"], now: at(TUE, 7, 58), holdAt: ["B"] })[0]?.trip, "PD0730");
  // On the way downtown, Beale is where you get off: show the early arrival.
  const r = c.ride(m, live, { trip: "PD0730", date: TUE, from: "L", to: "B", now: at(TUE, 7, 40), holdAt: ["B"] });
  assert.equal(r.stops.at(-1).pred, at(TUE, 7, 56));
  const back = c.ride(m, live, { trip: "PD0730", date: TUE, from: "B", to: "M", now: at(TUE, 7, 57), holdAt: ["B"] });
  assert.deepEqual(back.stops.map((s) => s.id), ["B", "D", "M"]);
  assert.equal(back.stops[0].pred, at(TUE, 8, 0));
});

test("a trip that hasn't started (next stop is sequence 0) reads as waiting, not riding", () => {
  const m = loopModel();
  const t = (h, mi) => ({ time: at(TUE, h, mi) });
  // PD0800 is predicted from its first stop (sequence 0); its shuttle is still finishing PD0730.
  const tu = { trip: { tripId: "PD0800", startDate: TUE }, stops: [{ seq: 0, arr: t(8, 1), dep: t(8, 1) }, { seq: 1, arr: t(8, 4), dep: t(8, 4) }] };
  const r = c.ride(m, { tripUpdates: [tu], vehicles: [] }, { trip: "PD0800", date: TUE, from: "L", to: "B", now: at(TUE, 7, 55) });
  assert.equal(r.feed.nextSeq, 0);
  const R = require("../bus/ride");
  const geo = R.geometry(r.line, r.stops);
  const phone = { lat: r.stops[0].lat, lon: r.stops[0].lon, acc: 10, ts: at(TUE, 7, 55) };
  assert.equal(R.progress(geo, r.stops, { phone, feed: r.feed, now: at(TUE, 7, 55) }).state, "waiting");
  // Live on this trip, still at its first stop: one stop before Lombard Gate.
  const vp = { trip: { tripId: "PD0800", startDate: TUE }, pos: { lat: 37.8018, lon: -122.4559 }, ts: at(TUE, 7, 59) };
  const [d] = c.departures(m, { tripUpdates: [tu], vehicles: [vp] }, { from: ["L"], to: ["B"], now: at(TUE, 8, 0) });
  assert.deepEqual([d.trip, d.status, d.vehicle.near, d.vehicle.stopsAway], ["PD0800", "live", "Transit Center", 1]);
});

/* ---------- real Presidio GO data, through the API handler (CI downloads a fresh snapshot) ---------- */

async function api(url, now) {
  const files = fs.readdirSync(FX);
  const latest = (p) => path.join(FX, files.filter((f) => f.startsWith(p) && f.endsWith(".pb")).sort().pop());
  const realFetch = global.fetch, realNow = Date.now;
  global.fetch = async (u) => {
    const s = String(u);
    const file = s.includes("tripupdates") ? latest("TripUpdates") : s.includes("vehiclepositions") ? latest("VehiclePositions") : path.join(FX, "GTFSTransitData.zip");
    return new Response(fs.readFileSync(file), { status: 200, headers: { "last-modified": "fixture" } });
  };
  Date.now = () => now * 1000;
  try {
    return await new Promise((resolve) => {
      const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { resolve({ code: this.code, body }); } };
      require("../api/pgo")({ url }, res);
    });
  } finally { global.fetch = realFetch; Date.now = realNow; }
}
const clock = (t) => new Date(t * 1000).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", hour12: false });

test("real feeds: her stops, the timetable, and which runs need a pass", { skip: !FX && "set PGO_FIXTURES" }, async () => {
  const model = c.buildModel(fs.readFileSync(path.join(FX, "GTFSTransitData.zip")), "fixture");
  for (const id of ["31933", "8894813", "31980"]) assert.ok(model.stops[id], `stop ${id} still exists`);
  // A weekday that isn't a federal holiday, at or after the snapshot.
  const { decodeFeed } = require("../api/_lib/gtfs");
  const tu = decodeFeed(fs.readFileSync(path.join(FX, fs.readdirSync(FX).filter((f) => f.startsWith("TripUpdates")).sort().pop())));
  const known = tu.tripUpdates.filter((t) => model.trips[t.trip?.tripId]).length;
  if (tu.tripUpdates.length) assert.ok(known > 0, "live trip ids match the timetable");
  let ymd = c.ymdOf(tu.header.ts || Date.now() / 1000);
  const holidays = { ...c.federalHolidays(+ymd.slice(0, 4)), ...c.federalHolidays(+ymd.slice(0, 4) + 1) };
  while (!/^(Mon|Tue|Wed|Thu|Fri)/.test(new Date(c.serviceDayBase(ymd) * 1000 + 43200000).toUTCString()) || holidays[ymd]) {
    ymd = new Date(c.serviceDayBase(ymd) * 1000 + 36 * 3600000).toISOString().slice(0, 10).replace(/-/g, "");
  }
  const base = c.serviceDayBase(ymd);
  const list = (b) => b.departures.map((d) => clock(d.sched) + (d.pass ? "*" : ""));

  // Morning from Lombard Gate: presidio.gov marks 7:33–8:49 with * (pass holders only).
  const am = await api("/api/pgo/?from=31933&to=8894813", base + 7 * 3600);
  assert.equal(am.code, 200);
  assert.deepEqual(list(am.body).slice(0, 8), ["07:03", "07:18", "07:33*", "07:48*", "08:03*", "08:18*", "08:33*", "08:48*"]);
  for (const d of am.body.departures) assert.ok(d.dest.id === "8894813" && d.dest.sched > d.sched && d.dest.sched - d.sched < 40 * 60);

  // Evening from 50 Beale: every other run from 4:30 to 6:00 needs a pass.
  const pm = await api("/api/pgo/?from=8894813&to=31980", base + 16 * 3600 + 20 * 60);
  assert.deepEqual(list(pm.body).slice(0, 8), ["16:30*", "16:45", "17:00*", "17:15", "17:30*", "17:45", "18:00*", "18:15"]);
  for (const d of pm.body.departures) assert.ok(d.dest.id === "31980" && d.dest.sched > d.sched);
  // Or the same runs 2 minutes later at Drumm & California (Embarcadero BART), the other downtown pick-up.
  const drumm = await api("/api/pgo/?from=839326&to=31980", base + 16 * 3600 + 20 * 60);
  assert.deepEqual(list(drumm.body).slice(0, 8), ["16:32*", "16:47", "17:02*", "17:17", "17:32*", "17:47", "18:02*", "18:17"]);
  assert.deepEqual(drumm.body.departures.map((d) => d.trip).slice(0, 8), pm.body.departures.map((d) => d.trip).slice(0, 8));
  for (const d of drumm.body.departures) assert.ok(d.origin.id === "839326" && d.dest.id === "31980" && d.dest.sched > d.sched);

  // Ride mode on the morning run.
  const first = am.body.departures[0];
  const ride = await api(`/api/pgo/?ride=${first.trip}&date=${first.date}&from=31933&to=8894813`, base + 7 * 3600);
  assert.deepEqual([ride.body.stops[0].id, ride.body.stops.at(-1).id], ["31933", "8894813"]);
  assert.ok(ride.body.line.length > 5);

  // The coming Columbus Day runs the weekend schedule (no pass runs, nothing before 9).
  const y = +ymd.slice(0, 4);
  const columbus = Object.entries(c.federalHolidays(y)).find(([, n]) => n === "Columbus Day")[0];
  const hol = await api("/api/pgo/?from=31933&to=8894813", c.serviceDayBase(columbus) + 8 * 3600);
  assert.equal(hol.body.holiday, "Columbus Day");
  assert.ok(hol.body.departures.length > 0);
  assert.ok(hol.body.departures.every((d) => !d.pass && d.sched >= c.serviceDayBase(columbus) + 9 * 3600));
});
