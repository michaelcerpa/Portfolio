// Tests for the /bus/ commute tracker's data layer.
//   GGT_FIXTURES=<dir with GTFSTransitData.zip, TripUpdates-*.pb, VehiclePositions-*.pb> node --test tools/bus.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { unzip, parseCsv, decodeFeed } = require("../api/_lib/gtfs");
const c = require("../api/_lib/commute");

const FX = process.env.GGT_FIXTURES;
const FROM = "40033", TO = ["42203", "40053"];

test("serviceDayBase is local 'noon minus 12h', DST-safe", () => {
  assert.equal(c.serviceDayBase("20261006"), Date.UTC(2026, 9, 6, 7) / 1000);   // PDT midnight
  assert.equal(c.serviceDayBase("20261215"), Date.UTC(2026, 11, 15, 8) / 1000); // PST midnight
  assert.equal(c.serviceDayBase("20261101"), Date.UTC(2026, 10, 1, 8) / 1000);  // fall-back day: noon PST − 12h
  assert.equal(c.ymdOf(Date.UTC(2026, 9, 6, 6, 59) / 1000), "20261005");        // 11:59pm PDT
});

test("csv parser handles quotes, BOM, CRLF and padding", () => {
  const rows = parseCsv('﻿a,b,c\r\n1,"x, ""y""",  37.5\r\n2,,\r\n');
  assert.deepEqual(rows, [{ a: "1", b: 'x, "y"', c: "37.5" }, { a: "2", b: "", c: "" }]);
});

test("zip reader inflates deflated entries", () => {
  // Build a one-file zip by hand: local header + data + central directory + EOCD.
  const name = Buffer.from("x.txt"), body = Buffer.from("hello,world\n"), def = zlib.deflateRawSync(body);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(def.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(def.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28);
  const cdOffset = 30 + name.length + def.length;
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + name.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  const zip = Buffer.concat([local, name, def, central, name, eocd]);
  assert.equal(unzip(zip)["x.txt"].toString(), "hello,world\n");
});

test("protobuf reader decodes negative int32 delays", () => {
  // FeedMessage{ header{ts=5}, entity{ id="e", trip_update{ trip{trip_id="t"}, stop_time_update{seq=3, arrival{delay=-330}} } } }
  const neg = [0xb6, 0xfd, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]; // -330 as 10-byte varint
  const ev = [0x08, ...neg];
  const stu = [0x08, 0x03, 0x12, ev.length, ...ev];
  const trip = [0x0a, 0x01, 0x74];
  const tu = [0x0a, trip.length, ...trip, 0x12, stu.length, ...stu];
  const ent = [0x0a, 0x01, 0x65, 0x1a, tu.length, ...tu];
  const buf = Buffer.from([0x0a, 0x02, 0x18, 0x05, 0x12, ent.length, ...ent]);
  const feed = decodeFeed(buf);
  assert.equal(feed.header.ts, 5);
  assert.equal(feed.tripUpdates[0].trip.tripId, "t");
  assert.deepEqual(feed.tripUpdates[0].stops[0], { seq: 3, arr: { delay: -330 } });
});

/* ---------- synthetic schedule: one trip A → STOP → X → DEST ---------- */

function tinyModel() {
  const csv = {
    "routes.txt": "route_id,route_short_name,route_long_name,route_color,route_text_color\n101-273,101,Novato - SF,3366FF,FFFFFF\n",
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\nA,Origin,37.9,-122.5\n40033,Lombard,37.8,-122.43\nX,Van Ness,37.79,-122.42\n42203,Mission & 2nd,37.78,-122.40\n",
    "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,0,0,20260901,20261231\n",
    "calendar_dates.txt": "service_id,date,exception_type\nWK,20261126,2\n",
    "trips.txt": "route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\n101-273,WK,T1,South,1,S1\n101-273,WK,T2,South,1,S1\n",
    "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n" +
      "T1,07:30:00,07:30:00,A,1,0,0\nT1,07:56:00,07:56:00,40033,2,0,0\nT1,08:05:00,08:05:00,X,3,0,0\nT1,08:21:00,08:21:00,42203,4,0,0\n" +
      "T2,08:00:00,08:00:00,A,1,0,0\nT2,08:26:00,08:26:00,40033,2,0,0\nT2,08:35:00,08:35:00,X,3,0,0\nT2,08:51:00,08:51:00,42203,4,0,0\n",
    "shapes.txt": "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nS1,37.9,-122.5,1\nS1,37.8,-122.43,2\nS1,37.78,-122.40,3\n",
  };
  // buildModel takes a zip; build an uncompressed one.
  const parts = [], central = [];
  let off = 0;
  for (const [n, txt] of Object.entries(csv)) {
    const name = Buffer.from(n), body = Buffer.from(txt);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(body.length, 22); h.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(body.length, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(off, 42);
    parts.push(h, name, body); central.push(cd, name); off += 30 + name.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(central.length / 2, 8);
  eocd.writeUInt16LE(central.length / 2, 10); eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(off, 16);
  return c.buildModel(Buffer.concat([...parts, cdBuf, eocd]), "test");
}
const DAY = "20261006"; // a Tuesday
const at = (h, m) => c.serviceDayBase(DAY) + h * 3600 + m * 60;

test("timetable only: both trips listed with destination times", () => {
  const out = c.departures(tinyModel(), { tripUpdates: [], vehicles: [] }, { from: FROM, to: TO, now: at(7, 40) });
  assert.deepEqual(out.map((d) => [d.trip, d.status, d.sched, d.dest.sched]),
    [["T1", "scheduled", at(7, 56), at(8, 21)], ["T2", "scheduled", at(8, 26), at(8, 51)]]);
});

test("holiday exception removes the trips", () => {
  const thanksgiving = c.serviceDayBase("20261126") + 7 * 3600 + 40 * 60;
  assert.equal(c.departures(tinyModel(), { tripUpdates: [], vehicles: [] }, { from: FROM, to: TO, now: thanksgiving }).length, 0);
});

test("live bus: delay propagates from the last update before your stop", () => {
  const tu = { trip: { tripId: "T1", startDate: DAY }, vehicle: { id: "1905" },
               stops: [{ seq: 1, dep: { delay: 180 } }] };
  const vp = { trip: { tripId: "T1", startDate: DAY }, vehicle: { id: "1905" }, pos: { lat: 37.85, lon: -122.48 }, seq: 2, status: 2, ts: at(7, 39) };
  const [d] = c.departures(tinyModel(), { tripUpdates: [tu], vehicles: [vp] }, { from: FROM, to: TO, now: at(7, 40) });
  assert.equal(d.status, "live");
  assert.equal(d.delay, 180);
  assert.equal(d.pred, at(7, 59));
  assert.equal(d.dest.pred, at(8, 24));
  assert.equal(d.vehicle.near, "Lombard");
  assert.equal(d.vehicle.stopsAway, 0);
});

test("early bus is reported early; explicit stop time wins over propagation", () => {
  const tu = { trip: { tripId: "T1", startDate: DAY }, stops: [{ seq: 2, arr: { time: at(7, 54) }, dep: { time: at(7, 54) } }] };
  const [d] = c.departures(tinyModel(), { tripUpdates: [tu], vehicles: [] }, { from: FROM, to: TO, now: at(7, 40) });
  assert.equal(d.status, "estimated");
  assert.equal(d.delay, -120);
});

test("bus that already passed your stop is dropped", () => {
  const tu = { trip: { tripId: "T1", startDate: DAY }, stops: [{ seq: 3, dep: { delay: 0 } }, { seq: 4, arr: { delay: 0 } }] };
  const out = c.departures(tinyModel(), { tripUpdates: [tu], vehicles: [] }, { from: FROM, to: TO, now: at(7, 57) });
  assert.deepEqual(out.map((d) => d.trip), ["T2"]);
});

test("late bus stays listed after its scheduled time", () => {
  const tu = { trip: { tripId: "T1", startDate: DAY }, stops: [{ seq: 2, dep: { delay: 600 } }] };
  const out = c.departures(tinyModel(), { tripUpdates: [tu], vehicles: [] }, { from: FROM, to: TO, now: at(8, 0) });
  assert.equal(out[0].trip, "T1");
  assert.equal(out[0].pred, at(8, 6));
});

test("canceled trip and skipped stop are flagged", () => {
  const tus = [{ trip: { tripId: "T1", startDate: DAY, rel: 3 }, stops: [] },
               { trip: { tripId: "T2", startDate: DAY }, stops: [{ seq: 2, rel: 1 }] }];
  const out = c.departures(tinyModel(), { tripUpdates: tus, vehicles: [] }, { from: FROM, to: TO, now: at(7, 40) });
  assert.deepEqual(out.map((d) => d.status), ["canceled", "skipped"]);
});

test("bus finishing an earlier run is shown as that bus, dimmed", () => {
  const tu = { trip: { tripId: "T2", startDate: DAY }, vehicle: { id: "1907" }, stops: [{ seq: 1, dep: { delay: 300 } }] };
  const vp = { trip: { tripId: "OTHER", startDate: DAY }, vehicle: { id: "1907" }, pos: { lat: 37.95, lon: -122.5 }, seq: 9, ts: at(7, 39) };
  const out = c.departures(tinyModel(), { tripUpdates: [tu], vehicles: [vp] }, { from: FROM, to: TO, now: at(7, 40) });
  const d = out.find((x) => x.trip === "T2");
  assert.equal(d.status, "estimated");
  assert.equal(d.vehicle.onEarlierTrip, true);
});

/* ---------- real Golden Gate data (CI downloads a fresh snapshot) ---------- */

test("real feeds: schedule + live data produce sane departures", { skip: !FX && "set GGT_FIXTURES" }, () => {
  const files = fs.readdirSync(FX);
  const latest = (p) => path.join(FX, files.filter((f) => f.startsWith(p) && f.endsWith(".pb")).sort().pop());
  const model = c.buildModel(fs.readFileSync(path.join(FX, "GTFSTransitData.zip")), "fixture");
  assert.ok(model.stops[FROM], "Lombard & Fillmore (40033) still exists");
  for (const id of TO) assert.ok(model.stops[id], `destination stop ${id} still exists`);
  const tu = decodeFeed(fs.readFileSync(latest("TripUpdates")));
  const vp = decodeFeed(fs.readFileSync(latest("VehiclePositions")));
  assert.ok(tu.header.ts > 1.7e9 && vp.header.ts > 1.7e9, "feed headers carry timestamps");
  const known = tu.tripUpdates.filter((t) => model.trips[t.trip?.tripId]).length;
  if (tu.tripUpdates.length) assert.ok(known > 0, "live trip ids match the timetable");

  // Weekday 7:30am: the morning commute must have buses to both downtown stops.
  let ymd = c.ymdOf(tu.header.ts);
  while (!/^(Mon|Tue|Wed|Thu|Fri)/.test(new Date(c.serviceDayBase(ymd) * 1000 + 43200000).toUTCString())) ymd = String(+ymd + 1);
  const morning = c.departures(model, { tripUpdates: [], vehicles: [] }, { from: FROM, to: TO, now: c.serviceDayBase(ymd) + 7.5 * 3600 });
  assert.ok(morning.length >= 8, `expected a busy morning, got ${morning.length}`);
  assert.ok(morning.some((d) => d.dest.id === "42203") && morning.some((d) => d.dest.id === "40053"));
  for (let i = 1; i < morning.length; i++) assert.ok(morning[i].sched >= morning[i - 1].sched);
  for (const d of morning) assert.ok(d.dest.sched > d.sched, "arrives downtown after leaving Lombard");

  const now = c.departures(model, { tripUpdates: tu.tripUpdates, vehicles: vp.vehicles }, { from: FROM, to: TO, now: tu.header.ts });
  for (const d of now) {
    assert.ok(["live", "estimated", "scheduled", "canceled", "skipped"].includes(d.status));
    if (d.pred) assert.ok(Math.abs(d.delay) < 3 * 3600, "delay within 3h");
  }
  const map = c.mapLayer(model, FROM, TO);
  assert.ok(map.lines.length >= 2 && map.lines.every((l) => l.points.length > 10));
});

/* ---------- ride mode ---------- */

test("recent mode lists a bus that already left your stop and is still en route", () => {
  const tu = { trip: { tripId: "T1", startDate: DAY }, stops: [{ seq: 3, dep: { delay: 60 } }, { seq: 4, arr: { delay: 60 } }] };
  const live = { tripUpdates: [tu], vehicles: [] };
  assert.deepEqual(c.departures(tinyModel(), live, { from: FROM, to: TO, now: at(8, 0), recent: true }).map((d) => d.trip), ["T1"]);
  assert.deepEqual(c.departures(tinyModel(), live, { from: FROM, to: TO, now: at(8, 0) }).map((d) => d.trip), ["T2"]);
  // Once it has reached downtown it drops off; the 8:26 (timetable only) has now left and takes its place.
  assert.deepEqual(c.departures(tinyModel(), live, { from: FROM, to: TO, now: at(8, 30), recent: true }).map((d) => d.trip), ["T2"]);
});

test("ride(): stops from your stop to the destination, with live predictions", () => {
  const tu = { trip: { tripId: "T1", startDate: DAY }, stops: [{ seq: 2, dep: { delay: 120 } }] };
  const vp = { trip: { tripId: "T1", startDate: DAY }, pos: { lat: 37.82, lon: -122.45 }, seq: 2, status: 2, ts: at(7, 50) };
  const r = c.ride(tinyModel(), { tripUpdates: [tu], vehicles: [vp] }, { trip: "T1", date: DAY, from: FROM, to: "42203", now: at(7, 51) });
  assert.deepEqual(r.stops.map((s) => s.id), ["40033", "X", "42203"]);
  assert.deepEqual(r.stops.map((s) => s.pred), [at(7, 58), at(8, 7), at(8, 23)]);
  assert.equal(r.feed.nextSeq, 2);
  assert.equal(r.trip.route, "101");
  assert.ok(r.line.length >= 2);
  assert.equal(c.ride(tinyModel(), { tripUpdates: [], vehicles: [] }, { trip: "nope", date: DAY, from: FROM, to: "42203", now: at(7, 51) }), null);
});

const R = require("../bus/ride");
// A straight north→south street with stops every ~220 m: A (origin), B, C, D (destination).
const LINE = [[37.800, -122.42], [37.794, -122.42]];
const STOPS = [0, 1, 2, 3].map((k) => ({ seq: 10 + k, id: "S" + k, lat: 37.800 - k * 0.002, lon: -122.42, sched: at(8, k * 2), pred: null }));
const geo = R.geometry(LINE, STOPS);
const T = at(8, 0);
const phoneAt = (lat, lon = -122.42) => ({ lat, lon, acc: 10, ts: T });

test("ride core: stop positions along the line", () => {
  assert.deepEqual(geo.stopDist.map((d) => Math.round(d)), [0, 221, 442, 663]);
});

test("ride core: phone GPS between stops → counts the stops left", () => {
  const p = R.progress(geo, STOPS, { phone: phoneAt(37.7990), now: T });
  assert.equal(p.source, "phone");
  assert.equal(p.state, "riding");
  assert.equal(p.nextIdx, 1);
  assert.equal(p.stopsLeft, 3);
});

test("ride core: past the second-to-last stop → your stop is next", () => {
  const between = R.progress(geo, STOPS, { phone: phoneAt(37.7950), now: T });
  assert.equal(between.state, "next");
  assert.equal(between.stopsLeft, 1);
  const dwelling = R.progress(geo, STOPS, { phone: phoneAt(37.7960), now: T });
  assert.equal(dwelling.atIdx, 2);
  assert.equal(dwelling.state, "next");
  assert.ok(Math.abs(dwelling.metersLeft - 221) < 5);
});

test("ride core: at the destination → arrived", () => {
  assert.equal(R.progress(geo, STOPS, { phone: phoneAt(37.7941), now: T }).state, "arrived");
});

test("ride core: phone off the route (not on this bus) falls back to the bus GPS", () => {
  const p = R.progress(geo, STOPS, { phone: phoneAt(37.7990, -122.43), vehicle: { lat: 37.7975, lon: -122.42, ts: T - 20 }, now: T });
  assert.equal(p.source, "bus");
  assert.equal(p.nextIdx, 2);
});

test("ride core: standing at your stop before the bus comes is 'waiting'", () => {
  const p = R.progress(geo, STOPS, { phone: phoneAt(37.8000), feed: { nextSeq: 8, stopped: false }, now: T });
  assert.equal(p.state, "waiting");
});

test("ride core: feed-only progress, and it never jitters backwards", () => {
  const f = R.progress(geo, STOPS, { feed: { nextSeq: 13, stopped: false }, now: T });
  assert.equal(f.source, "feed");
  assert.equal(f.state, "next");
  const stopped = R.progress(geo, STOPS, { feed: { nextSeq: 12, stopped: true }, now: T });
  assert.equal(stopped.atIdx, 2);
  assert.equal(stopped.state, "next");
  const jitter = R.progress(geo, STOPS, { phone: phoneAt(37.7962), now: T, minD: 470 });
  assert.ok(jitter.d >= 430);
});

test("ride core: timetable fallback", () => {
  assert.equal(R.progress(geo, STOPS, { now: at(7, 59) }).state, "waiting");
  const p = R.progress(geo, STOPS, { now: at(8, 3) });
  assert.equal(p.source, "timetable");
  assert.equal(p.nextIdx, 2);
});
