// The transit agencies the commute pages read, and the quirks of each service that its feeds don't say.
"use strict";

module.exports = {
  ggt: {
    name: "Golden Gate Transit",
    sources: {
      schedule: "https://realtime.goldengate.org/gtfsstatic/GTFSTransitData.zip",
      tripUpdates: "https://realtime.goldengate.org/gtfsrealtime/TripUpdates",
      vehicles: "https://realtime.goldengate.org/gtfsrealtime/VehiclePositions",
    },
    defaults: { from: ["40033"], to: ["40053"] },
  },

  // Presidio GO, the Presidio Trust's free shuttle (GMV Syncromatics feeds, no key).
  pgo: {
    name: "Presidio GO",
    sources: {
      schedule: "https://presidiobus.com/gtfs.zip",
      tripUpdates: "https://presidiobus.com/gtfs-rt/tripupdates",
      vehicles: "https://presidiobus.com/gtfs-rt/vehiclepositions",
    },
    defaults: { from: ["31933"], to: ["8894813"] },
    // "On federal holidays, the shuttle runs on a weekend schedule" (presidio.gov). The feed's calendar
    // doesn't list them, so the weekday service is swapped for the weekend one on those days.
    holidaySchedule: "weekend",
    // The Downtown route is one loop that turns around at 50 Beale St (Beale & Mission). Shuttles get there
    // about 5 minutes before the timetable time and wait, so a departure from there never leaves early.
    turnaround: "8894813",
    // The feed marks a stop done the moment a shuttle pulls up; it can sit there another minute (5 at 50 Beale).
    atStopMeters: 60,
    approachMeters: 300,  // GPS this close and short of the stop along the route = still pulling up (feed drops the stop early)
    keepVehiclesS: 60,    // the vehicle feed sometimes blinks empty for a poll; keep the last positions this long
    // Weekday runs the official timetable marks with * (Presidio GO Pass holders only). One run can be open
    // on its way downtown and pass-only on its way back, so each half of the loop has its own list.
    passOnly: {
      toDowntown: ["PD0730", "PD0745", "PD0800", "PD0815", "PD0830", "PD0845", "PD1615", "PD1630", "PD1700", "PD1730", "PD1800"],
      fromDowntown: ["PD0700", "PD0715", "PD0730", "PD0745", "PD0800", "PD0815", "PD0830", "PD1600", "PD1630", "PD1700", "PD1730"],
    },
  },
};
