// Turns Golden Gate Transit's schedule (GTFS) + live feeds (GTFS-RT) into
// "the next buses from stop X that reach stop Y" with live vs scheduled times.
"use strict";
const { unzip, parseCsv, decodeFeed } = require("./gtfs");

const TZ = "America/Los_Angeles";
const SOURCES = {
  schedule: "https://realtime.goldengate.org/gtfsstatic/GTFSTransitData.zip",
  tripUpdates: "https://realtime.goldengate.org/gtfsrealtime/TripUpdates",
  vehicles: "https://realtime.goldengate.org/gtfsrealtime/VehiclePositions",
};

/* ---------- time ---------- */

const dtf = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
});
function localParts(epochSec) {
  const p = {};
  for (const x of dtf.formatToParts(new Date(epochSec * 1000))) p[x.type] = x.value;
  return p;
}
function ymdOf(epochSec) { const p = localParts(epochSec); return p.year + p.month + p.day; }
function addDays(ymd, n) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + n));
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}
// GTFS times count from "noon minus 12h" local time on the service day (DST-safe).
function serviceDayBase(ymd) {
  const guess = Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), 12) / 1000;
  const p = localParts(guess);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) / 1000;
  return guess - (asUtc - guess) - 12 * 3600;
}
const hms = (s) => { const [h, m, x] = s.split(":").map(Number); return h * 3600 + m * 60 + (x || 0); };

/* ---------- schedule model ---------- */

function buildModel(zipBuf, lastModified) {
  const files = unzip(zipBuf, ["routes.txt", "trips.txt", "stop_times.txt", "stops.txt",
                               "calendar.txt", "calendar_dates.txt", "shapes.txt"]);
  const csv = (n) => (files[n] ? parseCsv(files[n].toString("utf8")) : []);

  const routes = {};
  for (const r of csv("routes.txt")) {
    routes[r.route_id] = { short: r.route_short_name || r.route_id.split("-")[0], name: r.route_long_name,
                           color: "#" + (r.route_color || "6FBF93"), text: "#" + (r.route_text_color || "FFFFFF") };
  }
  const stops = {};
  for (const s of csv("stops.txt")) stops[s.stop_id] = { id: s.stop_id, name: s.stop_name, lat: +s.stop_lat, lon: +s.stop_lon };

  const weekly = {}, exceptions = {};
  for (const c of csv("calendar.txt")) weekly[c.service_id] = c;
  for (const d of csv("calendar_dates.txt")) (exceptions[d.service_id] ||= {})[d.date] = d.exception_type;

  const trips = {};
  for (const t of csv("trips.txt")) {
    trips[t.trip_id] = { id: t.trip_id, route: t.route_id, service: t.service_id, headsign: t.trip_headsign,
                         dir: t.direction_id, shape: t.shape_id, stops: [] };
  }
  for (const st of csv("stop_times.txt")) {
    const t = trips[st.trip_id];
    if (!t) continue;
    t.stops.push({ seq: +st.stop_sequence, stop: st.stop_id, arr: hms(st.arrival_time || st.departure_time),
                   dep: hms(st.departure_time || st.arrival_time), pickup: st.pickup_type, dropoff: st.drop_off_type });
  }
  for (const t of Object.values(trips)) t.stops.sort((a, b) => a.seq - b.seq);

  const shapes = {};
  for (const p of csv("shapes.txt")) (shapes[p.shape_id] ||= []).push([+p.shape_pt_sequence, +p.shape_pt_lat, +p.shape_pt_lon]);
  for (const k in shapes) shapes[k] = shapes[k].sort((a, b) => a[0] - b[0]).map(([, la, lo]) => [la, lo]);

  let validUntil = "";
  for (const c of Object.values(weekly)) if (c.end_date > validUntil) validUntil = c.end_date;

  return { routes, stops, trips, shapes, weekly, exceptions, lastModified, validUntil, loadedAt: Date.now() };
}

function runsOn(model, serviceId, ymd) {
  const ex = model.exceptions[serviceId]?.[ymd];
  if (ex === "1") return true;
  if (ex === "2") return false;
  const c = model.weekly[serviceId];
  if (!c || ymd < c.start_date || ymd > c.end_date) return false;
  const day = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
    [new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))).getUTCDay()];
  return c[day] === "1";
}

/* ---------- live data helpers ---------- */

const STATUS = ["incoming", "stopped", "in_transit"];

// Predicted epoch time at stop `s` of trip `trip` (scheduled at base + s.dep), using GTFS-RT
// semantics: an update at the stop wins; otherwise the delay of the closest earlier update propagates.
function predictAt(tu, s, base) {
  if (!tu || !tu.stops.length) return null;
  let prev = null;
  for (const u of tu.stops) {
    const match = u.seq === s.seq || (u.seq === undefined && u.stopId === s.stop);
    if (match) {
      if (u.rel === 1) return { skipped: true };
      const ev = u.dep && (u.dep.time || u.dep.delay !== undefined) ? u.dep : u.arr;
      if (!ev) return null;
      return { time: ev.time || base + s.dep + (ev.delay || 0) };
    }
    if (u.seq !== undefined && u.seq < s.seq) prev = u;
  }
  if (prev) {
    const ev = prev.dep || prev.arr;
    if (ev && ev.delay !== undefined) return { time: base + s.dep + ev.delay };
  }
  if (tu.delay !== undefined) return { time: base + s.dep + tu.delay };
  return null;
}

// True when the live data says the bus has already left stop `s`.
function passed(tu, vp, s) {
  if (vp && vp.seq !== undefined && vp.seq > s.seq) return true;
  if (tu && tu.stops.length && tu.stops.every((u) => u.seq !== undefined && u.seq > s.seq)) return true;
  return false;
}

/* ---------- main computation ---------- */

function departures(model, live, opts) {
  const { from, to, now, windowMin = 120, limit = 14 } = opts;
  const toRank = new Map(to.map((id, i) => [id, i]));
  const tuByTrip = new Map(), vpByTrip = new Map(), vpById = new Map();
  for (const tu of live.tripUpdates || []) if (tu.trip?.tripId) tuByTrip.set(tu.trip.tripId + "|" + (tu.trip.startDate || ""), tu);
  for (const vp of live.vehicles || []) {
    if (vp.trip?.tripId) vpByTrip.set(vp.trip.tripId + "|" + (vp.trip.startDate || ""), vp);
    if (vp.vehicle?.id) vpById.set(vp.vehicle.id, vp);
  }
  const lookup = (m, tripId, ymd) => m.get(tripId + "|" + ymd) || m.get(tripId + "|");

  const today = ymdOf(now);
  const out = [];
  for (const ymd of [addDays(today, -1), today]) {
    const base = serviceDayBase(ymd);
    for (const trip of Object.values(model.trips)) {
      const i = trip.stops.findIndex((s) => s.stop === from && s.pickup !== "1");
      if (i < 0 || i === trip.stops.length - 1) continue;
      const origin = trip.stops[i];
      const sched = base + origin.dep;
      if (sched < now - 3600 || sched > now + windowMin * 60) continue;
      if (!runsOn(model, trip.service, ymd)) continue;

      let dest = null;
      for (const s of trip.stops.slice(i + 1)) {
        if (!toRank.has(s.stop) || s.dropoff === "1") continue;
        if (!dest || toRank.get(s.stop) < toRank.get(dest.stop)) dest = s;
      }
      if (!dest) continue;

      const tu = lookup(tuByTrip, trip.id, ymd);
      const vp = lookup(vpByTrip, trip.id, ymd);
      const canceled = tu?.trip?.rel === 3;
      if (passed(tu, vp, origin)) continue;

      const atOrigin = canceled ? null : predictAt(tu, origin, base);
      const atDest = canceled ? null : predictAt(tu, dest, base);
      const pred = atOrigin?.time ?? null;
      const effective = pred ?? sched;
      // Hide buses that have left: live-predicted ones once their prediction is past,
      // untracked ones two minutes after their scheduled time.
      if (effective < now - (pred ? 30 : 120)) continue;
      if (effective > now + windowMin * 60) continue;

      // Which physical bus will run this trip, and where is it right now?
      let bus = vp, onEarlierTrip = false;
      if (!bus && tu?.vehicle?.id && vpById.has(tu.vehicle.id)) { bus = vpById.get(tu.vehicle.id); onEarlierTrip = true; }
      const fresh = bus && bus.ts && now - bus.ts < 300;
      let vehicle = null;
      if (bus?.pos && fresh) {
        // Next stop: the trip update lists only stops still ahead, and the vehicle feed names the
        // stop it is heading to (but reports 0 on stretches like the bridge). Trust the further one.
        const nextSeq = onEarlierTrip ? null : Math.max(tu?.stops?.[0]?.seq || 0, bus.seq > 0 ? bus.seq : 0) || null;
        const nextStop = nextSeq !== null ? trip.stops.find((s) => s.seq === nextSeq) : null;
        const stopsAway = nextStop ? trip.stops.filter((s) => s.seq >= nextStop.seq && s.seq < origin.seq).length : null;
        vehicle = {
          id: bus.vehicle?.id || null, lat: +bus.pos.lat.toFixed(6), lon: +bus.pos.lon.toFixed(6),
          bearing: bus.pos.bearing ?? null, ts: bus.ts, status: STATUS[bus.status ?? 2],
          near: nextStop ? model.stops[nextStop.stop]?.name || null : null, stopsAway, onEarlierTrip,
        };
      }

      const route = model.routes[trip.route] || { short: trip.route.split("-")[0], color: "#6FBF93", text: "#FFFFFF" };
      out.push({
        trip: trip.id, date: ymd, route: route.short, color: route.color, textColor: route.text,
        headsign: trip.headsign, shape: trip.shape,
        status: canceled ? "canceled" : atOrigin?.skipped ? "skipped" : vehicle && !onEarlierTrip ? "live" : pred ? "estimated" : "scheduled",
        sched, pred, delay: pred !== null ? pred - sched : null,
        dest: { id: dest.stop, name: model.stops[dest.stop]?.name, sched: base + dest.arr, pred: atDest?.time ?? null },
        vehicle,
      });
    }
  }
  out.sort((a, b) => (a.pred ?? a.sched) - (b.pred ?? b.sched));
  return out.slice(0, limit);
}

/* ---------- map shapes (simplified) ---------- */

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const k = Math.cos((pts[0][0] * Math.PI) / 180);
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ay, ax] = [pts[a][0], pts[a][1] * k], [by, bx] = [pts[b][0], pts[b][1] * k];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let best = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const py = pts[i][0], px = pts[i][1] * k;
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > best) { best = d; idx = i; }
    }
    if (best > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]).map(([la, lo]) => [+la.toFixed(5), +lo.toFixed(5)]);
}

// One line per route serving `from` → `to` (its most common pattern), plus the stops involved.
function mapLayer(model, from, to) {
  const counts = {};
  for (const t of Object.values(model.trips)) {
    const i = t.stops.findIndex((s) => s.stop === from);
    if (i < 0 || !t.stops.slice(i + 1).some((s) => to.includes(s.stop))) continue;
    const key = t.route + "|" + t.shape;
    counts[key] = (counts[key] || 0) + 1;
  }
  const best = {};
  for (const [key, n] of Object.entries(counts)) {
    const [route, shape] = key.split("|");
    if (!best[route] || n > best[route].n) best[route] = { shape, n };
  }
  const lines = Object.entries(best).map(([route, { shape }]) => ({
    route: model.routes[route]?.short || route, color: model.routes[route]?.color || "#6FBF93",
    points: simplify(model.shapes[shape] || [], 0.00008),
  }));
  const stops = [from, ...to].map((id) => model.stops[id]).filter(Boolean);
  return { lines, stops };
}

/* ---------- fetching with in-memory caches ---------- */

let modelCache = null, modelPromise = null;
async function getModel(fetchImpl = fetch) {
  const fresh = modelCache && Date.now() - modelCache.loadedAt < 6 * 3600 * 1000;
  if (fresh) return modelCache;
  if (!modelPromise) {
    modelPromise = (async () => {
      const r = await fetchImpl(SOURCES.schedule, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error("schedule HTTP " + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      modelCache = buildModel(buf, r.headers.get("last-modified"));
      return modelCache;
    })().catch((e) => { if (modelCache) return modelCache; throw e; })
       .finally(() => { modelPromise = null; });
  }
  return modelPromise;
}

let liveCache = null;
async function getLive(fetchImpl = fetch) {
  if (liveCache && Date.now() - liveCache.at < 8000) return liveCache.data;
  const grab = async (url) => {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(url.split("/").pop() + " HTTP " + r.status);
    return decodeFeed(Buffer.from(await r.arrayBuffer()));
  };
  const [tu, vp] = await Promise.allSettled([grab(SOURCES.tripUpdates), grab(SOURCES.vehicles)]);
  const data = {
    tripUpdates: tu.status === "fulfilled" ? tu.value.tripUpdates : [],
    vehicles: vp.status === "fulfilled" ? vp.value.vehicles : [],
    ts: Math.max(tu.value?.header.ts || 0, vp.value?.header.ts || 0) || null,
    errors: [tu, vp].filter((x) => x.status === "rejected").map((x) => String(x.reason?.message || x.reason)),
  };
  if (!data.errors.length) liveCache = { at: Date.now(), data };
  return data;
}

module.exports = { departures, mapLayer, buildModel, getModel, getLive, serviceDayBase, ymdOf, runsOn, SOURCES };
