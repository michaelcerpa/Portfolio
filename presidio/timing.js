/* Which departure time to show, and how to label it. Pure functions, shared by the page (window.Timing)
   and the tests (require).

   The rule: a time later than the timetable is shown only when the shuttle is actually on that run (its GPS
   reports this trip). Before that, Presidio GO's estimate just carries the lateness of the shuttle's previous
   loop forward, and shuttles often make it up before the next run (the 6:34 from Lombard Gate starts 1 minute
   after the 5:45 loop ends). So until the shuttle is on the run, the time to be at the stop is the timetable
   time, or the estimate when that is earlier; a later estimate is only a note. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Timing = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // The shuttle's GPS says it is running this trip.
  const onRun = (d) => d.status === "live";

  const pick = (d, pred, sched) => (pred == null ? sched : onRun(d) ? pred : Math.min(pred, sched));
  // When it leaves your stop / reaches the other end, by the rule above.
  const departs = (d) => pick(d, d.pred, d.sched);
  const arrives = (d) => pick(d, d.dest?.pred, d.dest?.sched);

  // A later estimate we are not showing as the time (shuttle not on the run yet), else null.
  const lateEstimate = (d) => (!onRun(d) && d.pred != null && d.pred - d.sched >= 60 ? d.pred : null);

  // [css class, label] for the status chip.
  function status(d) {
    if (d.status === "canceled") return ["canceled", "canceled"];
    if (d.status === "skipped") return ["canceled", "skips stop"];
    if (d.atStop) return ["ontime", "at your stop"];  // its GPS has it at the stop right now
    if (d.overdue) return ["late", "running late"];  // past its time, not here, and no estimate still ahead
    if (d.pred == null) return ["sched", "timetable"];
    const late = d.pred - d.sched;
    if (Math.abs(late) < 60) return ["ontime", "on time"];
    const m = Math.round(late / 60);
    if (m < 0) return ["early", `${-m} min early`];
    if (!onRun(d)) return ["maybe", "may run late"];
    return [m >= 5 ? "verylate" : "late", `${m} min late`];
  }

  // What the page shows next to a time: only things that are real right now (canceled, at the stop, past its time with
  // the shuttle not here yet, or the live lateness of a shuttle that is on the run), else null.
  function label(d) {
    if (d.status === "canceled" || d.status === "skipped" || d.atStop || d.overdue) return status(d);
    return onRun(d) && d.pred != null ? status(d) : null;
  }

  return { onRun, departs, arrives, lateEstimate, status, label };
});
