// The commute API, one endpoint per agency (api/ggt.js, api/pgo.js):
// GET ?from=<stop ids>&to=<stop ids>[&map=1]   (stop ids best first)
//   Next buses from one stop to another, merged with the live feed,
//   plus the ones that just left (`recent`) for "I'm already on it".
// GET ?ride=<trip_id>&date=<YYYYMMDD>&from=<stop>&to=<stop>
//   One bus, stop by stop, for ride mode (from/to: the single stops you board and leave at).
"use strict";
const { departures, ride, mapLayer, getModel, getLive, ymdOf, AGENCIES } = require("./commute");

const ID = /^[A-Za-z0-9_-]{1,20}$/;

// Presidio GO: does boarding this run here need a Presidio GO Pass? (See passOnly in agencies.js.)
function needsPass(agency, model, d) {
  const trip = model.trips[d.trip];
  if (!agency.passOnly || !trip) return false;
  const board = trip.stops.find((s) => s.stop === d.origin.id), turn = trip.stops.find((s) => s.stop === agency.turnaround);
  const half = board && turn && board.seq < turn.seq ? "toDowntown" : "fromDowntown";
  return agency.passOnly[half].includes(d.trip);
}

module.exports = (key) => async (req, res) => {
  const agency = AGENCIES[key];
  const q = new URL(req.url, "http://x").searchParams;
  const from = (q.get("from") || agency.defaults.from.join(",")).split(",").filter(Boolean).slice(0, 8);
  const to = (q.get("to") || agency.defaults.to.join(",")).split(",").filter(Boolean).slice(0, 8);
  const rideTrip = q.get("ride"), rideDate = q.get("date");
  if (!from.length || !to.length || ![...from, ...to].every((t) => ID.test(t)) || (rideTrip && (!ID.test(rideTrip) || !/^\d{8}$/.test(rideDate || "")))) {
    res.status(400).json({ error: "bad request" });
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const holdAt = agency.turnaround ? [agency.turnaround] : [];
  try {
    const [model, live] = await Promise.all([getModel(fetch, key), getLive(fetch, key)]);
    const feed = { ok: !live.errors.length, ts: live.ts, errors: live.errors };
    if (rideTrip) {
      const r = ride(model, live, { trip: rideTrip, date: rideDate, from: from[0], to: to[0], now, holdAt });
      if (!r) { res.setHeader("Cache-Control", "no-store"); res.status(404).json({ now, error: "unknown trip" }); return; }
      res.setHeader("Cache-Control", "public, s-maxage=8, stale-while-revalidate=20");
      res.status(200).json({ now, feed, ...r });
      return;
    }
    const body = {
      now, feed,
      schedule: { updated: model.lastModified, validUntil: model.validUntil },
      origin: model.stops[from[0]] || null,
      origins: from.map((id) => model.stops[id]).filter(Boolean),
      departures: departures(model, live, { from, to, now, holdAt, atStopMeters: agency.atStopMeters }),
      recent: departures(model, live, { from, to, now, holdAt, atStopMeters: agency.atStopMeters, recent: true }),
    };
    // Nothing soon (late night, weekends for the commute-only routes): say when the next one is.
    if (!body.departures.length) {
      const next = departures(model, { tripUpdates: [], vehicles: [] }, { from, to, now, windowMin: 4 * 24 * 60, limit: 1, days: [0, 1, 2, 3, 4] })[0];
      body.later = next ? { route: next.route, color: next.color, textColor: next.textColor, sched: next.sched, origin: next.origin } : null;
      if (next && agency.passOnly) body.later.pass = needsPass(agency, model, next);
    }
    if (agency.passOnly) for (const d of [...body.departures, ...body.recent]) d.pass = needsPass(agency, model, d);
    if (model.holidays?.[ymdOf(now)]) body.holiday = model.holidays[ymdOf(now)];
    if (q.get("map")) body.map = mapLayer(model, from, to);
    res.setHeader("Cache-Control", q.get("map") ? "public, s-maxage=3600, stale-while-revalidate=86400"
                                                : "public, s-maxage=8, stale-while-revalidate=20");
    res.status(200).json(body);
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ now, error: `${agency.name} data unavailable: ` + (e.message || e) });
  }
};
