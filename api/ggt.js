// GET /api/ggt?from=40033&to=42203,40053[&map=1]
// Next Golden Gate Transit buses from one stop to another, merged with the live feed.
"use strict";
const { departures, mapLayer, getModel, getLive } = require("./_lib/commute");

const ID = /^[A-Za-z0-9_-]{1,20}$/;

module.exports = async (req, res) => {
  const q = new URL(req.url, "http://x").searchParams;
  const from = q.get("from") || "40033";
  const to = (q.get("to") || "42203,40053").split(",").filter(Boolean).slice(0, 8);
  if (!ID.test(from) || !to.every((t) => ID.test(t))) {
    res.status(400).json({ error: "bad stop id" });
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  try {
    const [model, live] = await Promise.all([getModel(), getLive()]);
    const body = {
      now,
      feed: { ok: !live.errors.length, ts: live.ts, errors: live.errors },
      schedule: { updated: model.lastModified, validUntil: model.validUntil },
      origin: model.stops[from] || null,
      departures: departures(model, live, { from, to, now }),
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
