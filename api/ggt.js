// GET /api/ggt/?from=40033&to=42203,40053[&map=1]
//   Next Golden Gate Transit buses from one stop to another, merged with the live feed,
//   plus the ones that just left (`recent`) for "I'm already on it".
// GET /api/ggt/?ride=<trip_id>&date=<YYYYMMDD>&from=40033&to=42203
//   One bus, stop by stop, for ride mode.
"use strict";
const { departures, ride, mapLayer, getModel, getLive } = require("./_lib/commute");

const ID = /^[A-Za-z0-9_-]{1,20}$/;

module.exports = async (req, res) => {
  const q = new URL(req.url, "http://x").searchParams;
  const from = q.get("from") || "40033";
  const to = (q.get("to") || "42203,40053").split(",").filter(Boolean).slice(0, 8);
  const rideTrip = q.get("ride"), rideDate = q.get("date");
  if (!ID.test(from) || !to.every((t) => ID.test(t)) || (rideTrip && (!ID.test(rideTrip) || !/^\d{8}$/.test(rideDate || "")))) {
    res.status(400).json({ error: "bad request" });
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  try {
    const [model, live] = await Promise.all([getModel(), getLive()]);
    const feed = { ok: !live.errors.length, ts: live.ts, errors: live.errors };
    if (rideTrip) {
      const r = ride(model, live, { trip: rideTrip, date: rideDate, from, to: to[0], now });
      if (!r) { res.setHeader("Cache-Control", "no-store"); res.status(404).json({ now, error: "unknown trip" }); return; }
      res.setHeader("Cache-Control", "public, s-maxage=8, stale-while-revalidate=20");
      res.status(200).json({ now, feed, ...r });
      return;
    }
    const body = {
      now, feed,
      schedule: { updated: model.lastModified, validUntil: model.validUntil },
      origin: model.stops[from] || null,
      departures: departures(model, live, { from, to, now }),
      recent: departures(model, live, { from, to, now, recent: true }),
    };
    if (q.get("map")) body.map = mapLayer(model, from, to);
    res.setHeader("Cache-Control", q.get("map") ? "public, s-maxage=3600, stale-while-revalidate=86400"
                                                : "public, s-maxage=8, stale-while-revalidate=20");
    res.status(200).json(body);
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ now, error: "Golden Gate Transit data unavailable: " + (e.message || e) });
  }
};
