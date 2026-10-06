// Local preview of /bus/ + /api/ggt without network access to Golden Gate:
//   GGT_FIXTURES=<dir with GTFSTransitData.zip, TripUpdates-*.pb, VehiclePositions-*.pb> node tools/bus-dev-server.js
// Set GGT_NOW=<epoch seconds> to pretend it's another time (e.g. the moment the fixtures were captured).
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const FX = process.env.GGT_FIXTURES;
const offset = process.env.GGT_NOW ? +process.env.GGT_NOW * 1000 - Date.now() : 0;
if (offset) { const real = Date.now; Date.now = () => real() + offset; }

if (FX) {
  const pick = (p) => path.join(FX, fs.readdirSync(FX).filter((f) => f.startsWith(p) && f.endsWith(".pb")).sort().pop());
  const files = { GTFSTransitData: path.join(FX, "GTFSTransitData.zip"), TripUpdates: pick("TripUpdates"), VehiclePositions: pick("VehiclePositions") };
  global.fetch = async (url) => {
    const key = Object.keys(files).find((k) => String(url).includes(k));
    if (!key) throw new Error("dev fetch: no fixture for " + url);
    const buf = fs.readFileSync(files[key]);
    return new Response(buf, { status: 200, headers: { "last-modified": "fixture" } });
  };
}
const handler = require(path.join(ROOT, "api/ggt.js"));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2",
                ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.replace(/\/$/, "") === "/api/ggt") {
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
}).listen(process.env.PORT || 8787, () => console.log("http://localhost:" + (process.env.PORT || 8787) + "/bus/"));
