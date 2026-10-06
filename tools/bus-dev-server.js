// Local preview of /bus/ + /api/ggt and /presidio/ + /api/pgo without network access to the agencies:
//   GGT_FIXTURES=<dir> PGO_FIXTURES=<dir> node tools/bus-dev-server.js
// Each dir holds GTFSTransitData.zip (the schedule), TripUpdates-*.pb and VehiclePositions-*.pb (latest wins).
// Set GGT_NOW=<epoch seconds> to pretend it's another time (e.g. the moment the fixtures were captured).
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const offset = process.env.GGT_NOW ? +process.env.GGT_NOW * 1000 - Date.now() : 0;
if (offset) { const real = Date.now; Date.now = () => real() + offset; }

function fixtures(dir) {
  if (!dir) return null;
  const pick = (p) => path.join(dir, fs.readdirSync(dir).filter((f) => f.startsWith(p) && f.endsWith(".pb")).sort().pop());
  return { schedule: path.join(dir, "GTFSTransitData.zip"), tripupdates: pick("TripUpdates"), vehiclepositions: pick("VehiclePositions") };
}
const FIX = { ggt: fixtures(process.env.GGT_FIXTURES), pgo: fixtures(process.env.PGO_FIXTURES) };
if (FIX.ggt || FIX.pgo) {
  global.fetch = async (url) => {
    const u = String(url).toLowerCase(), set = FIX[u.includes("presidiobus.com") ? "pgo" : "ggt"];
    if (!set) throw new Error("dev fetch: no fixture for " + url);
    const kind = u.includes("tripupdates") ? "tripupdates" : u.includes("vehiclepositions") ? "vehiclepositions" : "schedule";
    return new Response(fs.readFileSync(set[kind]), { status: 200, headers: { "last-modified": "fixture" } });
  };
}
const API = { "/api/ggt": require(path.join(ROOT, "api/ggt.js")), "/api/pgo": require(path.join(ROOT, "api/pgo.js")) };
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2",
                ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const handler = API[url.pathname.replace(/\/$/, "")];
  if (handler) {
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
    return handler(req, res);
  }
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(process.env.PORT || 8787, () => {
  const base = "http://localhost:" + (process.env.PORT || 8787);
  console.log(base + "/bus/  " + base + "/presidio/");
});
