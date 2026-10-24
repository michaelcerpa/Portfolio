// Shared pieces for the /presidio/ evals: load a recording of Presidio GO's live feed, rebuild what the API
// would have answered at any recorded moment, and find when each shuttle actually left each stop (from GPS).
//
// A recording is JSON lines (optionally .gz), one sample every ~15 s, as written by tools/evals/record.py:
//   {"t": epoch, "tu": [{trip, date, veh, stops: {seq: epoch}}], "vp": [{veh, trip, lat, lon, ts, seq}]}
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const c = require("../../api/_lib/commute");
const AGENCY = require("../../api/_lib/agencies").pgo;

// Her three boarding stops and where each ride goes (as the page asks the API).
const STOPS = [
  { name: "Lombard Gate", from: "31933", to: "8894813" },
  { name: "50 Beale", from: "8894813", to: "31980" },
  { name: "Drumm & California", from: "839326", to: "31980" },
];
const AT_STOP_M = 60;          // GPS within this of the stop = the shuttle is there
const LEFT_M = 100;            // ...and seen beyond this afterwards = it left
const SAMPLE_SLACK_S = 30;     // samples are ~15 s apart; allow one gap of slack when judging "after it left"

const metersApart = (a, b) => Math.hypot((a.lat - b.lat) * 110540, (a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180));

function loadRecording(file) {
  let buf = fs.readFileSync(file);
  if (file.endsWith(".gz")) buf = zlib.gunzipSync(buf);
  const samples = buf.toString("utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((s) => s.t);
  // Recordings before Oct 8 lack the feed's heading: derive it from each vehicle's movement (kept while it stands still).
  const lastFix = {};
  for (const s of samples) {
    for (const v of s.vp || []) {
      const prev = lastFix[v.veh];
      if (v.bearing == null) {
        const moved = prev && metersApart(prev, v) >= 15;
        v.bearing = moved ? (((Math.atan2((v.lon - prev.lon) * Math.cos((v.lat * Math.PI) / 180), v.lat - prev.lat) * 180) / Math.PI) + 360) % 360 : prev?.bearing ?? null;
      }
      if (!prev || metersApart(prev, v) >= 15 || prev.bearing == null) lastFix[v.veh] = { lat: v.lat, lon: v.lon, bearing: v.bearing };
    }
  }
  // What the server would hold as vehicles at each moment: it reuses the last positions when the feed blinks empty.
  let last = null;
  for (const s of samples) {
    s.vpServed = c.keepVehicles(last, { vehicles: s.vp || [] }, AGENCY.keepVehiclesS, s.t * 1000).vehicles;
    if ((s.vp || []).length) last = { at: s.t * 1000, vehicles: s.vp };
  }
  return samples;
}

function loadModel(zipPath) {
  const model = c.buildModel(fs.readFileSync(zipPath), "eval");
  const y = new Date().getUTCFullYear();
  return c.weekendOnHolidays(model, [y - 1, y, y + 1]);
}

// The engine's view of one recorded sample (same shape decodeFeed() produces).
function liveAt(sample, naive = false) {
  return {
    tripUpdates: (sample.tu || []).map((u) => ({
      trip: { tripId: u.trip, startDate: u.date || undefined }, vehicle: { id: u.veh },
      stops: Object.entries(u.stops || {}).map(([seq, t]) => ({ seq: +seq, arr: { time: t }, dep: { time: t } })).sort((a, b) => a.seq - b.seq),
    })),
    vehicles: ((naive ? sample.vp : sample.vpServed ?? sample.vp) || []).map((v) => ({
      trip: { tripId: v.trip }, vehicle: { id: v.veh }, pos: { lat: v.lat, lon: v.lon, bearing: v.bearing ?? undefined }, ts: v.ts, seq: v.seq || undefined,
    })),
    ts: sample.tu_ts || sample.vp_ts || sample.t,
    errors: [],
  };
}

// Departures exactly as /api/pgo computes them (same options as api/_lib/handler.js). naive: without the
// protections (turnaround hold/cap, at-stop and pulling-up holds, kept GPS), to prove the eval catches the bugs they fix.
function departuresAt(model, sample, stop, naive = false) {
  return c.departures(model, liveAt(sample, naive), {
    from: [stop.from], to: [stop.to], now: sample.t,
    holdAt: !naive && AGENCY.turnaround ? [AGENCY.turnaround] : [],
    atStopMeters: naive ? 0 : AGENCY.atStopMeters, gpsTrack: !naive && AGENCY.gpsTrack,
  });
}

// The page's display rule before the missed-shuttle fix: show the feed's time, whatever it is.
const NaiveTiming = {
  onRun: (d) => d.status === "live",
  departs: (d) => d.pred ?? d.sched,
  status: (d) => {
    if (d.pred == null) return ["sched", "timetable"];
    const m = Math.round((d.pred - d.sched) / 60);
    return Math.abs(d.pred - d.sched) < 60 ? ["ontime", "on time"] : m > 0 ? ["late", `${m} min late`] : ["early", `${-m} min early`];
  },
};


// Departures GPS can't show (a frozen fix, say) can be given in <recording>.labels.json: {departures: [{stop, trip, left}]}.
function loadLabels(file) {
  const f = file.replace(/\.jsonl(\.gz)?$/, ".labels.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")).departures || [] : [];
}

// When each run actually left a stop: its last GPS fix within AT_STOP_M of the stop (near its timetable time there),
// counted only once a later fix has it beyond LEFT_M going on along the route. A shuttle passing the stop the other
// way (the loop's way back to the Transit Center goes right by Lombard Gate, often already labelled with its next run)
// isn't leaving it. Returns {trip: {left, sched}}.
function actualDepartures(model, samples, stopId, labels = []) {
  const stop = model.stops[stopId];
  const out = {};
  const ymd = c.ymdOf(samples[0].t), base = c.serviceDayBase(ymd);
  const { alongTrip, shapeIndex } = c._internals;
  const schedAt = (trip) => {
    const t = model.trips[trip], s = t && t.stops.find((x) => x.stop === stopId);
    return s ? base + s.dep : null;
  };
  // Going on along the route from the stop: placed past it, or (when it can't be placed) heading the way the route does.
  const onward = (trip, v) => {
    const t = model.trips[trip], k = t.stops.findIndex((x) => x.stop === stopId), ix = shapeIndex(model, t);
    const fix = alongTrip(model, t, base, { lat: v.lat, lon: v.lon, bearing: v.bearing }, v.ts, null);
    if (fix) return fix.at > ix.stops[k].at;
    if (v.bearing == null) return false;
    const seg = Math.min(ix.stops[k].seg, ix.pts.length - 2), [p, q] = [ix.pts[seg], ix.pts[seg + 1]];
    const dir = (Math.atan2(q[0] - p[0], q[1] - p[1]) * 180) / Math.PI;
    return Math.abs((((v.bearing - dir) % 360) + 540) % 360 - 180) < 90;
  };
  const near = {}, checked = {};
  for (const smp of samples) {
    for (const v of smp.vp || []) {
      const sched = schedAt(v.trip);
      if (sched == null || Math.abs(v.ts - sched) > 25 * 60 || smp.t - v.ts > 90) continue;
      const d = metersApart(v, stop);
      if (d < AT_STOP_M) { near[v.trip] = Math.max(near[v.trip] || 0, v.ts); checked[v.trip] = false; }
      else if (d > LEFT_M && near[v.trip] && !checked[v.trip]) {
        checked[v.trip] = true;
        if (onward(v.trip, v)) out[v.trip] = { left: near[v.trip], sched };
      }
    }
  }
  for (const l of labels) if (l.stop === stopId && schedAt(l.trip) != null) out[l.trip] = { left: l.left, sched: schedAt(l.trip), labeled: true };
  return out;
}

function recordingFiles(args) {
  if (args.length) return args;
  const dir = path.join(__dirname, "recordings");
  return fs.readdirSync(dir).filter((f) => /\.jsonl(\.gz)?$/.test(f)).sort().map((f) => path.join(dir, f));
}

const hm = (t) => (t ? new Date(t * 1000).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", second: "2-digit" }) : "-");

module.exports = { NaiveTiming, STOPS, SAMPLE_SLACK_S, loadRecording, loadLabels, loadModel, liveAt, departuresAt, actualDepartures, recordingFiles, hm, AGENCY };
