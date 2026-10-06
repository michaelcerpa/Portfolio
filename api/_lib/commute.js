// Turns a transit agency's schedule (GTFS) + live feeds (GTFS-RT) into
// "the next buses from stop X that reach stop Y" with live vs scheduled times.
"use strict";
const { unzip, parseCsv, decodeFeed } = require("./gtfs");
const AGENCIES = require("./agencies");

const TZ = "America/Los_Angeles";
const SOURCES = AGENCIES.ggt.sources;

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

// US federal holidays as observed (Saturday → the Friday before, Sunday → the Monday after): YYYYMMDD → name.
function federalHolidays(year) {
  const ymd = (m, d) => new Date(Date.UTC(year, m - 1, d)).toISOString().slice(0, 10).replace(/-/g, "");
  const weekday = (m, d) => new Date(Date.UTC(year, m - 1, d)).getUTCDay();
  const nth = (m, wd, n) => ymd(m, 1 + ((wd - weekday(m, 1) + 7) % 7) + 7 * (n - 1));
  const last = (m, wd) => { const end = new Date(Date.UTC(year, m, 0)).getUTCDate(); return ymd(m, end - ((weekday(m, end) - wd + 7) % 7)); };
  const fixed = (m, d) => ymd(m, d + ({ 6: -1, 0: 1 }[weekday(m, d)] || 0));
  return {
    [fixed(1, 1)]: "New Year's Day", [nth(1, 1, 3)]: "Martin Luther King Jr. Day", [nth(2, 1, 3)]: "Presidents' Day",
    [last(5, 1)]: "Memorial Day", [fixed(6, 19)]: "Juneteenth", [fixed(7, 4)]: "Independence Day",
    [nth(9, 1, 1)]: "Labor Day", [nth(10, 1, 2)]: "Columbus Day", [fixed(11, 11)]: "Veterans Day",
    [nth(11, 4, 4)]: "Thanksgiving", [fixed(12, 25)]: "Christmas Day",
  };
}

// For agencies that run their weekend timetable on federal holidays: on those dates, weekday-only services
// stop and weekend-only ones run, unless the feed's own calendar_dates already says what runs that day.
function weekendOnHolidays(model, years) {
  const wk = ["monday", "tuesday", "wednesday", "thursday", "friday"], we = ["saturday", "sunday"];
  const only = (c, on, off) => on.every((d) => c[d] === "1") && off.every((d) => c[d] === "0");
  const ids = Object.keys(model.weekly);
  const weekday = ids.filter((id) => only(model.weekly[id], wk, we)), weekend = ids.filter((id) => only(model.weekly[id], we, wk));
  model.holidays = {};
  for (const y of years) {
    for (const [ymd, name] of Object.entries(federalHolidays(y))) {
      model.holidays[ymd] = name;
      for (const id of weekday) (model.exceptions[id] ||= {})[ymd] ??= "2";
      for (const id of weekend) (model.exceptions[id] ||= {})[ymd] ??= "1";
    }
  }
  return model;
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

// The next stop the live data says the bus is heading to: the trip update lists only stops still ahead, and
// the vehicle feed names the stop it is heading to (but reports 0 on stretches like the bridge). Trust the
// further one. stop_sequence may start at 0 (Presidio GO), so "unknown" is null, never 0.
function nextSeqOf(tu, vp) {
  const seqs = [tu?.stops?.[0]?.seq, vp?.seq > 0 ? vp.seq : undefined].filter((x) => x !== undefined);
  return seqs.length ? Math.max(...seqs) : null;
}

// True when the live data says the bus has already left stop `s`.
function passed(tu, vp, s) {
  if (vp && vp.seq !== undefined && vp.seq > s.seq) return true;
  if (tu && tu.stops.length && tu.stops.every((u) => u.seq !== undefined && u.seq > s.seq)) return true;
  return false;
}

/* ---------- main computation ---------- */

function indexLive(live) {
  const tuByTrip = new Map(), vpByTrip = new Map(), vpById = new Map();
  for (const tu of live.tripUpdates || []) if (tu.trip?.tripId) tuByTrip.set(tu.trip.tripId + "|" + (tu.trip.startDate || ""), tu);
  for (const vp of live.vehicles || []) {
    if (vp.trip?.tripId) vpByTrip.set(vp.trip.tripId + "|" + (vp.trip.startDate || ""), vp);
    if (vp.vehicle?.id) vpById.set(vp.vehicle.id, vp);
  }
  const lookup = (m, tripId, ymd) => m.get(tripId + "|" + ymd) || m.get(tripId + "|");
  return { tuByTrip, vpByTrip, vpById, lookup };
}

// Where a trip boards and alights for this commute: the best-ranked `from` stop it picks up at,
// then the best-ranked `to` stop it drops off at after that. Null if it doesn't make the trip.
function legOf(trip, fromRank, toRank) {
  let i = -1;
  trip.stops.forEach((s, k) => {
    if (fromRank.has(s.stop) && s.pickup !== "1" && (i < 0 || fromRank.get(s.stop) < fromRank.get(trip.stops[i].stop))) i = k;
  });
  if (i < 0 || i === trip.stops.length - 1) return null;
  let dest = null;
  for (const s of trip.stops.slice(i + 1)) {
    if (!toRank.has(s.stop) || s.dropoff === "1") continue;
    if (!dest || toRank.get(s.stop) < toRank.get(dest.stop)) dest = s;
  }
  return dest ? { i, origin: trip.stops[i], dest } : null;
}
const rankOf = (ids) => new Map([].concat(ids).map((id, i) => [id, i]));

// `from` and `to` are stop ids in order of preference (a single id works too).
// opts.recent: instead of upcoming buses, list ones that already left `from` and are still on
// their way to `to` — for "I'm already on the bus".
// opts.holdAt: stops where buses wait for their timetable time (a turnaround), so they never leave early.
function departures(model, live, opts) {
  const { now, windowMin = 120, limit = 14, recent = false, days = [-1, 0, 1] } = opts;
  const fromRank = rankOf(opts.from), toRank = rankOf(opts.to), hold = new Set([].concat(opts.holdAt || []));
  const { tuByTrip, vpByTrip, vpById, lookup } = indexLive(live);

  const today = ymdOf(now);
  const out = [];
  for (const ymd of days.map((n) => addDays(today, n))) {
    const base = serviceDayBase(ymd);
    for (const trip of Object.values(model.trips)) {
      const leg = legOf(trip, fromRank, toRank);
      if (!leg) continue;
      const { origin, dest } = leg;
      const sched = base + origin.dep;
      if (sched < now - 3600 || sched > now + windowMin * 60) continue;
      if (!runsOn(model, trip.service, ymd)) continue;

      const tu = lookup(tuByTrip, trip.id, ymd);
      const vp = lookup(vpByTrip, trip.id, ymd);
      const canceled = tu?.trip?.rel === 3;
      const atOrigin = canceled ? null : predictAt(tu, origin, base);
      const atDest = canceled ? null : predictAt(tu, dest, base);
      let pred = atOrigin?.time ?? null;
      // The feed's time there is when the bus arrives; at a turnaround it then waits to leave on schedule.
      if (pred !== null && pred < sched && hold.has(origin.stop)) pred = sched;
      const effective = pred ?? sched;
      // A bus has left once the live data says so, or (live-predicted) its prediction is past,
      // or (untracked) it is two minutes past its scheduled time.
      const left = passed(tu, vp, origin) || effective < now - (pred ? 30 : 120);
      if (recent) {
        if (!left || canceled || (atDest?.time ?? base + dest.arr) < now - 120) continue;
      } else {
        if (left) continue;
        if (effective > now + windowMin * 60) continue;
      }

      // Which physical bus will run this trip, and where is it right now?
      let bus = vp, onEarlierTrip = false;
      if (!bus && tu?.vehicle?.id && vpById.has(tu.vehicle.id)) { bus = vpById.get(tu.vehicle.id); onEarlierTrip = true; }
      const fresh = bus && bus.ts && now - bus.ts < 300;
      let vehicle = null;
      if (bus?.pos && fresh) {
        const nextSeq = onEarlierTrip ? null : nextSeqOf(tu, bus);
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
        origin: { id: origin.stop, name: model.stops[origin.stop]?.name, lat: model.stops[origin.stop]?.lat, lon: model.stops[origin.stop]?.lon },
        dest: { id: dest.stop, name: model.stops[dest.stop]?.name, sched: base + dest.arr, pred: atDest?.time ?? null },
        vehicle,
      });
    }
  }
  out.sort((a, b) => (recent ? -1 : 1) * ((a.pred ?? a.sched) - (b.pred ?? b.sched)));
  return out.slice(0, recent ? 3 : limit);
}

/* ---------- ride mode: one trip, stop by stop ---------- */

const M_PER_DEG_LAT = 110540;
function projector(lat0) {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return (lat, lon) => [lon * kx, lat * M_PER_DEG_LAT];
}
// Distance from p to segment ab, and how far along ab the closest point is (meters).
function toSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return { off: Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy), along: t * Math.sqrt(len2) };
}

// The trip's shape cut to the part between two of its stops (falls back to straight stop-to-stop lines).
function rideLine(model, trip, i, j) {
  const stopPts = trip.stops.map((s) => model.stops[s.stop]).map((st) => [st?.lat, st?.lon]);
  const raw = model.shapes[trip.shape]?.length > 1 ? model.shapes[trip.shape] : stopPts;
  const xy = projector(raw[0][0]);
  const pts = raw.map(([la, lo]) => xy(la, lo));
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  // Walk the stops in order, matching each to the nearest stretch of shape at or after the previous one.
  const along = (stopIdx, fromSeg) => {
    const p = xy(...stopPts[stopIdx]);
    let best = { off: Infinity, at: cum[fromSeg], seg: fromSeg };
    for (let k = fromSeg; k < pts.length - 1; k++) {
      const r = toSegment(p, pts[k], pts[k + 1]);
      if (r.off < best.off) best = { off: r.off, at: cum[k] + r.along, seg: k };
      if (best.off < 40 && r.off > best.off + 500) break;
    }
    return best;
  };
  let seg = 0, start = null, end = null;
  for (let k = 0; k <= j; k++) {
    const b = along(k, seg);
    seg = b.seg;
    if (k === i) start = b.at;
    if (k === j) end = b.at;
  }
  const out = [];
  const interp = (d) => {
    let k = cum.findIndex((c) => c >= d);
    if (k <= 0) return raw[Math.max(k, 0)];
    const t = (d - cum[k - 1]) / (cum[k] - cum[k - 1] || 1);
    return [raw[k - 1][0] + t * (raw[k][0] - raw[k - 1][0]), raw[k - 1][1] + t * (raw[k][1] - raw[k - 1][1])];
  };
  out.push(interp(start));
  for (let k = 0; k < raw.length; k++) if (cum[k] > start && cum[k] < end) out.push(raw[k]);
  out.push(interp(end));
  return simplify(out, 0.00003);
}

function ride(model, live, { trip: tripId, date, from, to, now, holdAt = [] }) {
  const trip = model.trips[tripId];
  if (!trip) return null;
  const base = serviceDayBase(date);
  const { tuByTrip, vpByTrip, lookup } = indexLive(live);
  const tu = lookup(tuByTrip, trip.id, date);
  const vp = lookup(vpByTrip, trip.id, date);

  let i = trip.stops.findIndex((s) => s.stop === from);
  if (i < 0) i = 0;
  let j = trip.stops.findIndex((s, k) => k > i && s.stop === to);
  if (j < 0) j = trip.stops.length - 1;

  const canceled = tu?.trip?.rel === 3;
  const stops = trip.stops.slice(i, j + 1).map((s, k) => {
    const st = model.stops[s.stop] || {};
    const p = canceled ? null : predictAt(tu, s, base);
    let pred = p?.time ?? null;
    if (k === 0 && pred !== null && pred < base + s.dep && [].concat(holdAt).includes(s.stop)) pred = base + s.dep; // see departures()
    return { id: s.stop, seq: s.seq, name: st.name, lat: st.lat, lon: st.lon,
             sched: base + s.arr, pred, skipped: !!p?.skipped };
  });
  const fresh = vp?.pos && vp.ts && now - vp.ts < 300;
  const route = model.routes[trip.route] || { short: trip.route.split("-")[0], color: "#6FBF93", text: "#FFFFFF" };
  return {
    trip: { id: trip.id, date, route: route.short, color: route.color, textColor: route.text, headsign: trip.headsign, canceled },
    stops,
    line: rideLine(model, trip, i, j),
    // The feed's view of progress: the next stop it is heading to.
    feed: {
      nextSeq: nextSeqOf(tu, fresh ? vp : null),
      stopped: !!(fresh && vp.status === 1),
      done: !!tu && !tu.stops.length,
    },
    vehicle: fresh ? { lat: +vp.pos.lat.toFixed(6), lon: +vp.pos.lon.toFixed(6), ts: vp.ts, seq: vp.seq ?? null, status: STATUS[vp.status ?? 2] } : null,
  };
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
  const fromRank = rankOf(from), toRank = rankOf(to);
  const counts = {};
  for (const t of Object.values(model.trips)) {
    if (!legOf(t, fromRank, toRank)) continue;
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
  const stops = [...new Set([].concat(from, to))].map((id) => model.stops[id]).filter(Boolean);
  return { lines, stops };
}

/* ---------- fetching with in-memory caches (one set per agency, see agencies.js) ---------- */

const caches = {};
async function getModel(fetchImpl = fetch, key = "ggt") {
  const agency = AGENCIES[key], c = (caches[key] ||= {});
  const fresh = c.model && Date.now() - c.model.loadedAt < 6 * 3600 * 1000;
  if (fresh) return c.model;
  if (!c.modelPromise) {
    c.modelPromise = (async () => {
      const r = await fetchImpl(agency.sources.schedule, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error("schedule HTTP " + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      const model = buildModel(buf, r.headers.get("last-modified"));
      const y = new Date().getUTCFullYear();
      if (agency.holidaySchedule === "weekend") weekendOnHolidays(model, [y - 1, y, y + 1]);
      c.model = model;
      return model;
    })().catch((e) => { if (c.model) return c.model; throw e; })
       .finally(() => { c.modelPromise = null; });
  }
  return c.modelPromise;
}

async function getLive(fetchImpl = fetch, key = "ggt") {
  const { sources } = AGENCIES[key], c = (caches[key] ||= {});
  if (c.live && Date.now() - c.live.at < 8000) return c.live.data;
  const grab = async (url) => {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(url.split("/").pop() + " HTTP " + r.status);
    return decodeFeed(Buffer.from(await r.arrayBuffer()));
  };
  const [tu, vp] = await Promise.allSettled([grab(sources.tripUpdates), grab(sources.vehicles)]);
  const data = {
    tripUpdates: tu.status === "fulfilled" ? tu.value.tripUpdates : [],
    vehicles: vp.status === "fulfilled" ? vp.value.vehicles : [],
    ts: Math.max(tu.value?.header.ts || 0, vp.value?.header.ts || 0) || null,
    errors: [tu, vp].filter((x) => x.status === "rejected").map((x) => String(x.reason?.message || x.reason)),
  };
  if (!data.errors.length) c.live = { at: Date.now(), data };
  return data;
}

module.exports = { departures, ride, mapLayer, buildModel, getModel, getLive, serviceDayBase, ymdOf, runsOn,
                   federalHolidays, weekendOnHolidays, SOURCES, AGENCIES };
