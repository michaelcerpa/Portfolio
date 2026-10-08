// Tests for the /presidio/ shuttle tracker (Presidio GO): holidays, the 50 Beale turnaround, pass-only runs.
//   PGO_FIXTURES=<dir with GTFSTransitData.zip, TripUpdates-*.pb, VehiclePositions-*.pb> node --test tools/shuttle.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const c = require("../api/_lib/commute");
const Timing = require("../presidio/timing");

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

test("a shuttle the feed has marked past your stop stays listed while its GPS still has it there", () => {
  // Seen on the 7:03 from Lombard Gate: the feed dropped the stop at 7:03:26, the shuttle pulled away at 7:04:10.
  const m = loopModel();
  const tu = { trip: { tripId: "PD0730", startDate: TUE }, vehicle: { id: "11" }, stops: [{ seq: 2, arr: { time: at(TUE, 7, 41) }, dep: { time: at(TUE, 7, 41) } }] };
  const vp = (lat, lon, t) => ({ trip: { tripId: "PD0730", startDate: TUE }, vehicle: { id: "11" }, pos: { lat, lon }, ts: t });
  const opts = (now) => ({ from: ["L"], to: ["B"], now, atStopMeters: 60 });
  const atGate = c.departures(m, { tripUpdates: [tu], vehicles: [vp(37.79843, -122.44735, at(TUE, 7, 33) + 20)] }, opts(at(TUE, 7, 33) + 30));
  assert.deepEqual([atGate[0].trip, atGate[0].atStop, atGate[0].status], ["PD0730", true, "live"]);
  assert.deepEqual(Timing.status(atGate[0]), ["ontime", "at your stop"]);
  // 150 m down the road: gone.
  const away = c.departures(m, { tripUpdates: [tu], vehicles: [vp(37.79850, -122.44570, at(TUE, 7, 34))] }, opts(at(TUE, 7, 34) + 5));
  assert.equal(away[0].trip, "PD0800");
  // Off by default (Golden Gate's page keeps its behavior).
  assert.equal(c.departures(m, { tripUpdates: [tu], vehicles: [vp(37.79843, -122.44735, at(TUE, 7, 33) + 20)] },
    { from: ["L"], to: ["B"], now: at(TUE, 7, 33) + 30 })[0].trip, "PD0800");
});

test("a shuttle still on its way stays listed after the feed drops the stop; once its GPS is past the stop it's gone", () => {
  // Seen on the 8:48 from Lombard Gate: the feed dropped the stop at 8:50:09 with the shuttle 86 m out; it pulled up at
  // 8:50:54 and left at 8:51:07. And at 50 Beale, a late shuttle 146 m out was predicted at 9:01:54 but left at 9:01:24.
  const m = loopModel(), now = at(TUE, 7, 34);
  const tu = { trip: { tripId: "PD0730", startDate: TUE }, vehicle: { id: "11" }, stops: [{ seq: 2, arr: { time: at(TUE, 7, 45) }, dep: { time: at(TUE, 7, 45) } }] };
  const vp = (lat, lon, bearing) => ({ trip: { tripId: "PD0730", startDate: TUE }, vehicle: { id: "11" }, pos: { lat, lon, bearing }, ts: now - 5 });
  const opts = { from: ["L"], to: ["B"], now, atStopMeters: 60, gpsTrack: true };
  // 120 m short of the gate, heading in from the Transit Center.
  const pulling = c.departures(m, { tripUpdates: [tu], vehicles: [vp(37.79888, -122.44852, 116)] }, opts);
  assert.deepEqual([pulling[0].trip, pulling[0].status, !!pulling[0].atStop], ["PD0730", "live", false]);
  assert.ok(Timing.departs(pulling[0]) <= now + 60, "120 m at a 2 m/s crawl: no later than a minute out");
  // 120 m past it, heading on toward Van Ness: it has left.
  assert.equal(c.departures(m, { tripUpdates: [tu], vehicles: [vp(37.7984, -122.44594, 90)] }, opts)[0].trip, "PD0800");
  // Off by default (Golden Gate's page keeps its behavior).
  assert.equal(c.departures(m, { tripUpdates: [tu], vehicles: [vp(37.79888, -122.44852, 116)] }, { ...opts, gpsTrack: false })[0].trip, "PD0800");
});

test("the 4:02 from Drumm: a shuttle running late reads late and stays listed past its time, not swapped for the next one", () => {
  // Oct 7: at 3:34 the page said the 4:02 would leave at 4:00 (1 min early); it came about 4 minutes late, and at its
  // timetable time the page dropped it for the next run. Here: the 8:02 from D, the feed still predicting 8:01 (and
  // already past the turnaround B, so it dropped that stop), the shuttle's GPS 60% of the way from V to B at 8:03.
  const m = loopModel(), now = at(TUE, 8, 3);
  const tu = { trip: { tripId: "PD0730", startDate: TUE }, vehicle: { id: "11" },
               stops: [{ seq: 4, arr: { time: at(TUE, 8, 1) }, dep: { time: at(TUE, 8, 1) } }, { seq: 5, arr: { time: at(TUE, 8, 21) }, dep: { time: at(TUE, 8, 21) } }] };
  const vp = { trip: { tripId: "PD0730", startDate: TUE }, vehicle: { id: "11" }, pos: { lat: 37.79428, lon: -122.4077, bearing: 107 }, ts: now - 5 };
  const opts = { from: ["D"], to: ["M"], now, holdAt: ["B"], atStopMeters: 60, gpsTrack: true };
  const list = c.departures(m, { tripUpdates: [tu], vehicles: [vp] }, opts);
  assert.equal(list[0].trip, "PD0730", "still coming: listed first");
  assert.equal(list[0].status, "live");
  assert.ok(Timing.departs(list[0]) >= now, "not 'gone' and not in the past");
  assert.match(Timing.label(list[0])[1], /^\d+ min late$/);
  // Without the GPS placement it would have been dropped for the 8:32.
  assert.equal(c.departures(m, { tripUpdates: [tu], vehicles: [vp] }, { ...opts, gpsTrack: false })[0].trip, "PD0800");
  // And a run whose shuttle is still finishing its previous loop past its time says so, at the timetable time.
  const late = { ...Timing, d: { status: "estimated", sched: now - 120, pred: now + 300, overdue: true } };
  assert.deepEqual(Timing.label(late.d), ["late", "running late"]);
  assert.equal(Timing.departs(late.d), now - 120);
});

test("a frozen GPS fix and predictions that vanish don't make a shuttle 'gone': it reads 'running late' until it's seen past the stop", () => {
  // The Oct 7 4:02 from Drumm & California: its GPS sat on one spot off the mapped streets from 3:54 to 4:05 (fresh
  // timestamps), the feed stopped predicting the trip at 4:00, and it left about 4:04:30.
  const m = loopModel(), sched = at(TUE, 8, 2);
  const frozen = (now) => ({ trip: { tripId: "PD0730", startDate: TUE }, vehicle: { id: "11" }, pos: { lat: 37.7952, lon: -122.3940, bearing: 349 }, ts: now - 3 });
  const opts = (now) => ({ from: ["D"], to: ["M"], now, holdAt: ["B"], atStopMeters: 60, gpsTrack: true });
  const at4 = (now) => c.departures(m, { tripUpdates: [], vehicles: [frozen(now)] }, opts(now))[0];
  assert.deepEqual([at4(sched + 30).trip, Timing.label(at4(sched + 30))], ["PD0730", null]);
  assert.deepEqual([at4(sched + 150).trip, Timing.label(at4(sched + 150))], ["PD0730", ["late", "running late"]]);
  assert.equal(at4(sched + 150 + 3 * 60).trip, "PD0730", "still within the 6-minute grace");
  assert.equal(at4(sched + 7 * 60).trip, "PD0800", "given up 6 minutes past its time with no sign of it");
  // Seen 300 m past the stop toward M: gone at once.
  const past = { ...frozen(sched + 150), pos: { lat: 37.79408, lon: -122.39967, bearing: 277 } };
  assert.equal(c.departures(m, { tripUpdates: [], vehicles: [past] }, opts(sched + 150))[0].trip, "PD0800");
});

test("a late estimate far out shows only part of the lateness, all of it as the time gets close", () => {
  // Oct 7: with the shuttle's GPS frozen, the feed had the 6:30 from 50 Beale at 6:34 for minutes; it left 6:32:57.
  const m = loopModel(), sched = at(TUE, 8, 0);
  const tu = (late) => ({ trip: { tripId: "PD0730", startDate: TUE }, vehicle: { id: "11" }, stops: [{ seq: 3, arr: { time: sched + late }, dep: { time: sched + late } }] });
  const opts = (now) => ({ from: ["B"], to: ["M"], now, holdAt: ["B"], gpsTrack: true });
  const far = c.departures(m, { tripUpdates: [tu(240)], vehicles: [] }, opts(sched - 10 * 60))[0];
  assert.ok(far.pred > sched && far.pred < sched + 240 / 2, "10 min out: well under the feed's 4 min late");
  const near = c.departures(m, { tripUpdates: [tu(240)], vehicles: [] }, opts(sched + 200))[0];
  assert.ok(near.pred >= sched + 240 - 20, "40 s out: nearly all of it");
});

test("when the vehicle feed blinks empty for a poll, the last positions are kept for up to a minute", () => {
  const last = { at: 1_000_000, vehicles: [{ vehicle: { id: "11" } }] }, empty = { tripUpdates: [], vehicles: [], errors: [] };
  assert.equal(c.keepVehicles(last, empty, 60, 1_000_000 + 30_000).vehicles, last.vehicles);
  assert.equal(c.keepVehicles(last, empty, 60, 1_000_000 + 90_000).vehicles.length, 0);
  assert.equal(c.keepVehicles(last, empty, undefined, 1_000_000 + 30_000).vehicles.length, 0);  // Golden Gate: off
  const fresh = { ...empty, vehicles: [{ vehicle: { id: "12" } }] };
  assert.equal(c.keepVehicles(last, fresh, 60, 1_000_000 + 30_000), fresh);
});

test("past the turnaround: a shuttle parked at 50 Beale reaches Drumm on the timetable's 2 minutes, not the feed's 9", () => {
  // Seen on PD0700: parked at 50 Beale at 7:30:18 the feed said Drumm 7:39:40; it left Drumm at 7:34:01.
  const m = loopModel();
  const t = (h, mi, sec = 0) => at(TUE, h, mi) + sec;
  const tu = { trip: { tripId: "PD0730", startDate: TUE }, vehicle: { id: "11" },
               stops: [{ seq: 4, arr: { time: t(8, 11, 40) }, dep: { time: t(8, 11, 40) } }, { seq: 5, arr: { time: t(8, 31) }, dep: { time: t(8, 31) } }] };
  const vp = { trip: { tripId: "PD0730", startDate: TUE }, vehicle: { id: "11" }, pos: { lat: 37.79165, lon: -122.3965 }, ts: t(8, 0, 15) };
  const [d] = c.departures(m, { tripUpdates: [tu], vehicles: [vp] }, { from: ["D"], to: ["M"], now: t(8, 0, 18), holdAt: ["B"] });
  assert.equal(d.trip, "PD0730");
  assert.equal(d.pred, t(8, 2, 18), "leaves 50 Beale now (8:00:18), Drumm 2 minutes later");
  assert.equal(d.dest.pred, t(8, 22, 18), "and Letterman on the timetable's 22 minutes");
  // Once it is rolling the feed's own (earlier) prediction wins.
  const rolling = { ...tu, stops: [{ seq: 4, arr: { time: t(8, 1, 42) }, dep: { time: t(8, 1, 42) } }] };
  assert.equal(c.departures(m, { tripUpdates: [rolling], vehicles: [vp] }, { from: ["D"], to: ["M"], now: t(8, 0, 33), holdAt: ["B"] })[0].pred, t(8, 1, 42));
  // Without a turnaround (Golden Gate) nothing changes.
  assert.equal(c.departures(m, { tripUpdates: [tu], vehicles: [vp] }, { from: ["D"], to: ["M"], now: t(8, 0, 18) })[0].pred, t(8, 11, 40));
});

/* ---------- which time the page shows (presidio/timing.js) ---------- */

test("timing: a later estimate is never the time to be there until the shuttle is on the run", () => {
  const sched = at(TUE, 6, 34), d = (status, delay) => ({ status, sched, pred: delay == null ? null : sched + delay,
                                                         dest: { sched: sched + 1560, pred: delay == null ? null : sched + 1560 + delay } });
  // Shuttle still finishing its previous loop, feed says 6 min late: be there at 6:34, the estimate is a note.
  assert.equal(Timing.departs(d("estimated", 360)), sched);
  assert.equal(Timing.arrives(d("estimated", 360)), sched + 1560);
  assert.deepEqual(Timing.status(d("estimated", 360)), ["maybe", "may run late"]);
  assert.equal(Timing.lateEstimate(d("estimated", 360)), sched + 360);
  // On the run with GPS: late is late.
  assert.equal(Timing.departs(d("live", 360)), sched + 360);
  assert.deepEqual(Timing.status(d("live", 360)), ["verylate", "6 min late"]);
  assert.equal(Timing.lateEstimate(d("live", 360)), null);
  // An earlier estimate is shown either way (being early is the safe side).
  assert.equal(Timing.departs(d("estimated", -180)), sched - 180);
  assert.deepEqual(Timing.status(d("estimated", -180)), ["early", "3 min early"]);
  assert.deepEqual(Timing.status(d("estimated", 30)), ["ontime", "on time"]);
  assert.equal(Timing.departs(d("scheduled", null)), sched);
  assert.deepEqual(Timing.status(d("scheduled", null)), ["sched", "timetable"]);
  assert.deepEqual(Timing.status({ ...d("canceled", null), status: "canceled" }), ["canceled", "canceled"]);
  assert.deepEqual(Timing.status({ ...d("live", null), atStop: true }), ["ontime", "at your stop"]);
  // The page shows a label only when it is real: no "timetable", no "may run late", no guessing before the run.
  assert.equal(Timing.label(d("estimated", 360)), null);
  assert.equal(Timing.label(d("estimated", -180)), null);
  assert.equal(Timing.label(d("scheduled", null)), null);
  assert.equal(Timing.label(d("live", null)), null);
  assert.deepEqual(Timing.label(d("live", 360)), ["verylate", "6 min late"]);
  assert.deepEqual(Timing.label(d("live", 20)), ["ontime", "on time"]);
  assert.deepEqual(Timing.label({ ...d("estimated", null), status: "canceled" }), ["canceled", "canceled"]);
  assert.deepEqual(Timing.label({ ...d("estimated", 360), atStop: true }), ["ontime", "at your stop"]);
});

test("the missed 6:34: an estimate from the previous loop never pushes the time later", () => {
  // The 6:34 from Lombard Gate is run by the shuttle finishing the 5:45 loop (1 minute layover). Here PD0730 plays
  // the earlier loop and PD0800 the next run: the feed carries the earlier loop's 6 minutes forward to PD0800.
  const m = loopModel();
  const s = (h, mi) => ({ time: at(TUE, h, mi) });
  // Lombard Gate is stop 1 of the synthetic loop (8:03 on the timetable); the feed says 8:09.
  const early = { trip: { tripId: "PD0800", startDate: TUE }, vehicle: { id: "11" }, stops: [{ seq: 0, arr: s(8, 6), dep: s(8, 6) },
    { seq: 1, arr: s(8, 9), dep: s(8, 9) }, { seq: 2, arr: s(8, 16), dep: s(8, 16) }, { seq: 3, arr: s(8, 36), dep: s(8, 36) }] };
  const bus = { trip: { tripId: "PD0730", startDate: TUE }, vehicle: { id: "11" }, pos: { lat: 37.7983, lon: -122.4245 }, ts: at(TUE, 7, 50) };
  const [then] = c.departures(m, { tripUpdates: [early], vehicles: [bus] }, { from: ["L"], to: ["B"], now: at(TUE, 7, 50) });
  assert.deepEqual([then.trip, then.status, then.vehicle.onEarlierTrip, then.delay], ["PD0800", "estimated", true, 360]);
  assert.equal(Timing.departs(then), at(TUE, 8, 3), "shows the timetable 8:03, not the 8:09 estimate");
  assert.equal(Timing.status(then)[1], "may run late");
  // Ten minutes later the shuttle caught up and is on the run, on time: the time shown didn't move.
  const onTime = { trip: { tripId: "PD0800", startDate: TUE }, vehicle: { id: "11" }, stops: [{ seq: 1, arr: s(8, 3), dep: s(8, 3) }, { seq: 3, arr: s(8, 30), dep: s(8, 30) }] };
  const onRun = { ...bus, trip: { tripId: "PD0800", startDate: TUE }, pos: { lat: 37.8018, lon: -122.4559 }, ts: at(TUE, 8, 0) };
  const [now] = c.departures(m, { tripUpdates: [onTime], vehicles: [onRun] }, { from: ["L"], to: ["B"], now: at(TUE, 8, 0) });
  assert.deepEqual([now.status, Timing.departs(now), Timing.status(now)[1]], ["live", at(TUE, 8, 3), "on time"]);
});

/* ---------- real Presidio GO data, through the API handler (CI downloads a fresh snapshot) ---------- */

// live: false serves no live feed (timetable only), for checks at a pretend time of day that the snapshot's
// live trips would otherwise affect (e.g. a 7:40am snapshot already has the 7:03 as departed).
async function api(url, now, live = true) {
  const files = fs.readdirSync(FX);
  const latest = (p) => path.join(FX, files.filter((f) => f.startsWith(p) && f.endsWith(".pb")).sort().pop());
  const realFetch = global.fetch, realNow = Date.now;
  global.fetch = async (u) => {
    const s = String(u);
    if (!live && s.includes("gtfs-rt")) return new Response("", { status: 503 });
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

test("real feeds: her stops, the timetable, and no pass-only runs", { skip: !FX && "set PGO_FIXTURES" }, async () => {
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
  const list = (b) => b.departures.map((d) => clock(d.sched));

  // Morning from Lombard Gate: presidio.gov marks 7:33–8:48 with * (Presidio GO Pass holders only). She has no pass,
  // so after the 7:18 the next one she can take is the 9:03.
  const am = await api("/api/pgo/?from=31933&to=8894813", base + 7 * 3600, false);
  assert.equal(am.code, 200);
  assert.deepEqual(list(am.body), ["07:03", "07:18"]);
  for (const d of am.body.departures) assert.ok(d.dest.id === "8894813" && d.dest.sched > d.sched && d.dest.sched - d.sched < 40 * 60);
  const missed = await api("/api/pgo/?from=31933&to=8894813", base + 7 * 3600 + 25 * 60, false);
  assert.deepEqual(list(missed.body), ["09:03"]);

  // Evening from 50 Beale: every other run from 4:30 to 6:00 needs a pass; she gets the ones in between.
  const pm = await api("/api/pgo/?from=8894813&to=31980", base + 16 * 3600 + 20 * 60, false);
  assert.deepEqual(list(pm.body).slice(0, 4), ["16:45", "17:15", "17:45", "18:15"]);
  for (const d of pm.body.departures) assert.ok(d.dest.id === "31980" && d.dest.sched > d.sched);
  // Or the same runs 2 minutes later at Drumm & California (Embarcadero BART), the other downtown pick-up.
  const drumm = await api("/api/pgo/?from=839326&to=31980", base + 16 * 3600 + 20 * 60, false);
  assert.deepEqual(list(drumm.body).slice(0, 4), ["16:47", "17:17", "17:47", "18:17"]);
  assert.deepEqual(drumm.body.departures.map((d) => d.trip).slice(0, 4), pm.body.departures.map((d) => d.trip).slice(0, 4));
  // Earlier in the afternoon nothing is pass-only: the 4:00 and 4:02 she rode on Oct 7 are listed.
  const aft = await api("/api/pgo/?from=839326&to=31980", base + 15 * 3600 + 30 * 60, false);
  assert.deepEqual(list(aft.body).slice(0, 3), ["15:32", "16:02", "16:47"]);
  for (const d of drumm.body.departures) assert.ok(d.origin.id === "839326" && d.dest.id === "31980" && d.dest.sched > d.sched);

  // Ride mode on the morning run.
  const first = am.body.departures[0];
  const ride = await api(`/api/pgo/?ride=${first.trip}&date=${first.date}&from=31933&to=8894813`, base + 7 * 3600, false);
  assert.deepEqual([ride.body.stops[0].id, ride.body.stops.at(-1).id], ["31933", "8894813"]);
  assert.ok(ride.body.line.length > 5);

  // The coming Columbus Day runs the weekend schedule (no pass runs, nothing before 9).
  const y = +ymd.slice(0, 4);
  const columbus = Object.entries(c.federalHolidays(y)).find(([, n]) => n === "Columbus Day")[0];
  const hol = await api("/api/pgo/?from=31933&to=8894813", c.serviceDayBase(columbus) + 8 * 3600, false);
  assert.equal(hol.body.holiday, "Columbus Day");
  assert.ok(hol.body.departures.length > 0);
  assert.ok(hol.body.departures.every((d) => d.sched >= c.serviceDayBase(columbus) + 9 * 3600));

  // And with the live snapshot at the moment it was taken (last: the handler caches live data briefly).
  if (tu.header.ts) {
    const now = await api("/api/pgo/?from=31933&to=8894813", tu.header.ts);
    assert.equal(now.code, 200);
    assert.ok(now.body.feed.ok, "live feed decoded: " + JSON.stringify(now.body.feed.errors));
    for (const d of now.body.departures) {
      assert.ok(["live", "estimated", "scheduled", "canceled", "skipped"].includes(d.status));
      assert.ok(d.pred == null || Math.abs(d.pred - d.sched) < 3 * 3600);
      assert.ok(Timing.departs(d) <= Math.max(d.pred ?? d.sched, d.sched), "never later than both the timetable and the feed");
    }
  }
});
