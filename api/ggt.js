// GET /api/ggt/?from=40033&to=40053[&map=1]   (from/to: stop ids, best first)
//   Next Golden Gate Transit buses from one stop to another, merged with the live feed,
//   plus the ones that just left (`recent`) for "I'm already on it".
// GET /api/ggt/?ride=<trip_id>&date=<YYYYMMDD>&from=40033&to=42203
//   One bus, stop by stop, for ride mode (from/to: the single stops you board and leave at).
"use strict";
module.exports = require("./_lib/handler")("ggt");
