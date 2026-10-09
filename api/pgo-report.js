// POST /api/pgo-report/   {trip, date, stop, sched, minutes, device, at, page?}
//   The rider's own "my shuttle is running N min late" (negative: early), kept as live data to measure the page
//   against and to learn the runs Presidio GO's feed doesn't track. Stored privately, never in this public repo:
//   these are her commute times. Storage is an Upstash Redis list ("pgo:reports"): in Vercel, Storage → Upstash for
//   Redis, connected to this project, which sets KV_REST_API_URL / KV_REST_API_TOKEN. Without it: 503, and the page
//   keeps the report on her phone and sends it once storage is there.
"use strict";

const ID = /^[A-Za-z0-9_-]{1,20}$/;
const DEVICE = /^[a-z0-9]{8,32}$/;
const STATUS = new Set(["live", "estimated", "scheduled", "canceled", "skipped"]);
const PER_HOUR = 30;

function clean(b, now) {
  if (!b || typeof b !== "object") return null;
  const { trip, date, stop, sched, minutes, device, at, page } = b;
  if (!ID.test(trip || "") || !ID.test(stop || "") || !/^\d{8}$/.test(date || "") || !DEVICE.test(device || "")) return null;
  if (!Number.isInteger(minutes) || minutes < -15 || minutes > 60) return null;
  // When she typed it: up to 30 days ago (it waits on her phone while offline or before storage is set up).
  if (!Number.isInteger(at) || at > now + 300 || at < now - 30 * 86400) return null;
  if (!Number.isInteger(sched) || Math.abs(sched - at) > 6 * 3600) return null;  // a run around then, not a typo'd day
  const out = { at, received: now, trip, date, stop, sched, minutes, device };
  if (page && typeof page === "object") {
    out.page = {
      ...(Number.isInteger(page.shown) && Math.abs(page.shown - at) < 6 * 3600 ? { shown: page.shown } : {}),
      ...(typeof page.label === "string" ? { label: page.label.slice(0, 30) } : {}),
      ...(STATUS.has(page.status) ? { status: page.status } : {}),
    };
  }
  return out;
}

module.exports = async (req, res, deps = {}) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  const now = Math.floor(Date.now() / 1000);
  const report = clean(body, now);
  if (!report) { res.status(400).json({ error: "bad report" }); return; }

  const env = deps.env || process.env;
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL, token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) { res.status(503).json({ error: "storage not set up" }); return; }
  const redis = async (commands) => {
    const r = await (deps.fetch || fetch)(url.replace(/\/$/, "") + "/pipeline", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands), signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error("storage HTTP " + r.status);
    return r.json();
  };
  try {
    const hour = `pgo:reports:rate:${report.device}:${Math.floor(now / 3600)}`;
    const [count] = await redis([["INCR", hour], ["EXPIRE", hour, 7200]]);
    if (count?.result > PER_HOUR) { res.status(429).json({ error: "too many reports" }); return; }
    await redis([["RPUSH", "pgo:reports", JSON.stringify(report)]]);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
