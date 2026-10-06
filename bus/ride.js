/* Ride mode math: where along the trip are you, how many stops are left, is yours next?
   Pure functions, shared by the page (window.RideCore) and the tests (require). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RideCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const AT_STOP_M = 35;       // within this many meters of a stop (along the route) = at the stop
  const PHONE_MAX_OFF_M = 150; // phone farther than this from the route isn't on this bus
  const BUS_MAX_OFF_M = 200;

  // Flatten the ride's line to meters and measure where each stop sits along it.
  function geometry(line, stops) {
    const lat0 = line[0][0], kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
    const xy = (lat, lon) => [lon * kx, lat * ky];
    const pts = line.map(([la, lo]) => xy(la, lo));
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    function project(lat, lon, fromSeg = 0) {
      const p = xy(lat, lon);
      let best = { off: Infinity, d: 0, seg: fromSeg };
      for (let k = fromSeg; k < pts.length - 1; k++) {
        const a = pts[k], b = pts[k + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
        const off = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
        if (off < best.off) best = { off, d: cum[k] + t * Math.sqrt(len2), seg: k };
      }
      if (pts.length === 1) best = { off: Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]), d: 0, seg: 0 };
      return best;
    }
    // Stops in order: each one searched from the previous stop's stretch onward.
    let seg = 0;
    const stopDist = stops.map((s) => { const r = project(s.lat, s.lon, seg); seg = r.seg; return r.d; });
    return { project, stopDist, length: cum[cum.length - 1] };
  }

  // input: { phone: {lat, lon, acc, ts}|null, vehicle: {lat, lon, ts}|null, feed: {nextSeq, stopped, done}|null, now, minD }
  function progress(geo, stops, input) {
    const { phone, vehicle, feed, now } = input;
    const last = stops.length - 1;
    let d = null, source = null;

    if (phone && now - phone.ts < 45 && (phone.acc ?? 0) <= 120) {
      const r = geo.project(phone.lat, phone.lon);
      if (r.off <= PHONE_MAX_OFF_M) { d = r.d; source = "phone"; }
    }
    if (d === null && vehicle && now - vehicle.ts < 180) {
      const r = geo.project(vehicle.lat, vehicle.lon);
      if (r.off <= BUS_MAX_OFF_M) { d = r.d; source = "bus"; }
    }
    // Never slide backwards more than GPS jitter.
    if (d !== null && input.minD != null) d = Math.max(d, input.minD - 40);

    const beforeOrigin = feed && feed.nextSeq != null && (feed.nextSeq < stops[0].seq || (feed.nextSeq === stops[0].seq && !feed.stopped));
    let atIdx = -1, nextIdx;
    if (d !== null) {
      let best = AT_STOP_M;
      geo.stopDist.forEach((sd, i) => { const g = Math.abs(sd - d); if (g <= best) { best = g; atIdx = i; } });
      nextIdx = atIdx >= 0 ? atIdx + 1 : geo.stopDist.findIndex((sd) => sd > d);
      if (nextIdx === -1) nextIdx = last + 1;
      // Standing at your stop before the bus comes is "waiting", not riding.
      if (source === "phone" && atIdx === 0 && beforeOrigin) return result("waiting");
      if (source === "bus" && d < AT_STOP_M && beforeOrigin) return result("waiting");
    } else if (feed && feed.nextSeq != null) {
      source = "feed";
      if (feed.done) { nextIdx = last + 1; }
      else if (beforeOrigin) return result("waiting");
      else {
        nextIdx = stops.findIndex((s) => s.seq >= feed.nextSeq);
        if (nextIdx === -1) nextIdx = last + 1;
        else if (feed.stopped && stops[nextIdx].seq === feed.nextSeq) { atIdx = nextIdx; nextIdx++; }
      }
    } else {
      source = "timetable";
      const t = (s) => s.pred ?? s.sched;
      if (t(stops[0]) > now) return result("waiting");
      nextIdx = stops.findIndex((s) => t(s) > now);
      if (nextIdx === -1) nextIdx = last + 1;
    }

    if (atIdx === last || nextIdx > last) return result("arrived");
    return result(nextIdx === last ? "next" : "riding");

    function result(state) {
      const stopsLeft = state === "arrived" ? 0 : state === "waiting" ? last : last - nextIdx + 1;
      return {
        state, source, d, atIdx, nextIdx: state === "waiting" ? 0 : nextIdx, stopsLeft,
        metersLeft: d !== null ? Math.max(0, geo.stopDist[last] - d) : null,
      };
    }
  }

  return { geometry, progress, AT_STOP_M };
});
