// GET /api/pgo/?from=31933&to=8894813[&map=1]   (from/to: stop ids, best first)
//   Next Presidio GO shuttles from one stop to another, merged with the live feed, plus the ones that
//   just left (`recent`). Each one says whether it needs a Presidio GO Pass (`pass`), and `holiday`
//   names the federal holiday when the weekend timetable runs instead.
// GET /api/pgo/?ride=<trip_id>&date=<YYYYMMDD>&from=8894813&to=31980
//   One shuttle, stop by stop, for ride mode.
"use strict";
module.exports = require("./_lib/handler")("pgo");
