/* wall.js — the wall of TVs behind the home page.
   Builds 49 screens (7 across, 7 down), bends them into a wide-lens bulge, and plays one short
   silent clip on each. Every screen shows a different clip. The wall never moves.

   Kept light on purpose:
   - a screen plays only while it is inside the window and not hidden behind an open page
   - phones load smaller copies of the clips and play at most 22 at once
   - if the device drops frames, the outer screens fall back to still pictures
   - visitors who ask for reduced motion get still pictures only                                */
(function () {
  var root = document.documentElement, wall = document.getElementById('wall');

  // WHAT PLAYS WHERE. 'column,row': clip. 0,0 is the middle screen; row 1 is the row above it.
  // Calm and dark clips sit on the left, behind the name and menu. The far corners are mostly off screen.
  var CLIPS = {
    '-3,3': 'red-lamp-2',   '-2,3': 'night-ridge',  '-1,3': 'cirrus',        '0,3': 'sutro',          '1,3': 'sierra-view',     '2,3': 'city-sky',      '3,3': 'ridge-line-2',
    '-3,2': 'night-rest',   '-2,2': 'night-climb',  '-1,2': 'alpenglow',     '0,2': 'chairlift-far',  '1,2': 'road-climb',      '2,2': 'dawn-skis',     '3,2': 'road-far',
    '-3,1': 'dawn-line',    '-2,1': 'night-run',    '-1,1': 'dawn-climber',  '0,1': 'road-descent',   '1,1': 'ski-turns',       '2,1': 'chairlift',     '3,1': 'bridge-fog-2',
    '-3,0': 'sunrise-lake-2', '-2,0': 'red-lamp',   '-1,0': 'ocean-sunset',  '0,0': 'scree-descent',  '1,0': 'redwoods',        '2,0': 'golden-hills',  '3,0': 'lift-ride',
    '-3,-1': 'bridge-fog',  '-2,-1': 'night-snow',  '-1,-1': 'sunrise-lake', '0,-1': 'ridge-line',    '1,-1': 'summit-skis',    '2,-1': 'hilltop-stop', '3,-1': 'lift-sun',
    '-3,-2': 'night-blue',  '-2,-2': 'night-faces', '-1,-2': 'night-poles',  '0,-2': 'bridge-riders', '1,-2': 'sunrise-selfie', '2,-2': 'ski-pov',      '3,-2': 'ocean-sunset-2',
    '-3,-3': 'shadow',      '-2,-3': 'night-run-2', '-1,-3': 'redwoods-2',   '0,-3': 'headlamp',      '1,-3': 'ski-spray',      '2,-3': 'night-walk',   '3,-3': 'scree-2'
  };
  var cells = Object.keys(CLIPS).map(function (k) { var p = k.split(','); return [+p[0], +p[1], CLIPS[k]]; });
  cells.sort(function (p, q) { return (q[0] * q[0] * 1.4 + q[1] * q[1]) - (p[0] * p[0] * 1.4 + p[1] * p[1]); });   // far screens first, so near ones are painted on top

  // Phones get lighter copies of the clips (240x184 at 15 frames a second), in assets/tv/s/.
  var SMALL = Math.min(innerWidth, innerHeight) < 600 || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 600);
  // On a phone the wall is a different shape: see the note in styles.css. One column step there is wider, in degrees.
  var PHONE = { step: 38 };
  var html = '';
  cells.forEach(function (c, i) {
    var ring = Math.max(Math.abs(c[0]), Math.abs(c[1]));
    // --a / --b: where the set sits on the bulge (--ap: on the tighter phone wall).  --z / --k: a trace of unevenness, like sets stacked by hand.
    html += '<div class="tv" data-col="' + Math.abs(c[0]) + '" style="--a:' + (c[0] * 13.9).toFixed(1) + 'deg;--ap:' + (c[0] * PHONE.step).toFixed(1) + 'deg;--b:' + (c[1] * 11.8).toFixed(1) + 'deg;--z:' + ((((i * 37) % 9) - 4) * 0.12).toFixed(2) + 'deg;--k:' + (0.958 + ((i * 53) % 4) * 0.004).toFixed(3) + '">' +
      '<div class="set"><span class="tube" style="background-image:url(assets/tv/' + c[2] + '.jpg)">' +
      '<video muted loop playsinline preload="none" data-src="assets/tv/' + (SMALL ? 's/' : '') + c[2] + '.mp4" data-ring="' + ring + '" data-d="' + (c[0] * c[0] + c[1] * c[1]) + '"></video></span>' +
      '<span class="deck"><b></b><i></i><i></i><i></i><i class="led"></i></span></div></div>';
  });
  wall.innerHTML = html;

  // Fill the window. On a phone the whole width of the pillar of screens fits, edge to edge.
  function fit() { var n = innerWidth < 760; root.style.setProperty('--s', (n ? Math.max(innerWidth / 760, innerHeight / 1900) : Math.max(innerWidth / 1500, innerHeight / 1060)).toFixed(4)); }
  fit();

  // ---- playback ----
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var vids = Array.prototype.slice.call(wall.querySelectorAll('video'));
  vids.sort(function (a, b) { return a.dataset.d - b.dataset.d; });          // nearest the middle first
  var panel = document.getElementById('panel');
  var maxRing = 3;            // 3 = every screen, 2 = the outer ring shows stills, 1 = only the middle nine play
  var refused = false;        // the browser said no to auto-play (Low Power Mode, strict settings)

  function tune() {
    if (still) return;
    // On a phone at most 22 screens play at once, and the ones showing the most picture go first.
    var cap = SMALL ? 22 : 99, shown = [];
    var pr = document.body.classList.contains('has-panel') && !panel.hidden ? panel.getBoundingClientRect() : null;
    vids.forEach(function (v) {
      var r = v.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      var on = r.width > 8 && r.height > 8 && area > 0;
      if (on && pr && cx > pr.left && cx < pr.right && cy > pr.top && cy < pr.bottom) on = false;      // behind the open page
      if (on && (+v.dataset.ring > maxRing || document.hidden)) on = false;
      if (on) shown.push([v, area]); else if (!v.paused) v.pause();
    });
    if (shown.length > cap) {
      shown.sort(function (a, b) { return b[1] - a[1]; });
      shown.splice(cap).forEach(function (x) { if (!x[0].paused) x[0].pause(); });
    }
    shown.forEach(function (x) {
      var v = x[0];
      if (refused) return;
      if (!v.getAttribute('src')) v.setAttribute('src', v.dataset.src);
      v.muted = true;
      if (v.paused) {
        var p = v.play();
        if (p && p.catch) p.catch(function (e) { if (e && e.name === 'NotAllowedError') refused = true; });
      }
    });
  }
  // If auto-play was refused, the screens show their still frames, and the first tap, click or key press starts them.
  ['pointerdown', 'keydown'].forEach(function (ev) { addEventListener(ev, function () { if (refused) { refused = false; tune(); } }, { passive: true }); });
  var rt; addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { fit(); tune(); }, 120); });
  addEventListener('pageshow', tune);
  document.addEventListener('visibilitychange', tune);
  document.addEventListener('sheet:change', function () { setTimeout(tune, 30); });
  tune();

  // Watchdog: for the first few seconds, watch for dropped video frames and slow screen updates.
  // If the device is struggling, drop the outer ring of screens to stills, then the next ring.
  window.TVWALL = { videos: vids, health: null };
  function watch(round) {
    if (still || document.hidden || maxRing <= 1 || round > 3) return;
    var n = 0, slow = 0, t0 = 0, last = 0, q0 = quality();
    function quality() { var d = 0, t = 0; vids.forEach(function (v) { if (!v.paused && v.getVideoPlaybackQuality) { var q = v.getVideoPlaybackQuality(); d += q.droppedVideoFrames; t += q.totalVideoFrames; } }); return [d, t]; }
    requestAnimationFrame(function step(t) {
      if (!t0) t0 = last = t; else { if (t - last > 50) slow++; n++; last = t; }
      if (t - t0 < 3500) return requestAnimationFrame(step);
      var q1 = quality(), frames = q1[1] - q0[1], dropped = q1[0] - q0[0];
      var bad = (n > 30 && slow / n > 0.3) || (frames > 100 && dropped / frames > 0.12);   // under about 20 screen updates a second, or 1 video frame in 8 dropped
      window.TVWALL.health = { round: round, slowShare: +(slow / Math.max(1, n)).toFixed(2), droppedShare: +(dropped / Math.max(1, frames)).toFixed(2), maxRing: maxRing };
      if (bad) { maxRing--; tune(); setTimeout(function () { watch(round + 1); }, 1200); }
    });
  }
  setTimeout(function () { watch(1); }, 2500);

  // Opening or closing a page: one short flash of TV snow over the wall. The snow is drawn once, here.
  (function () {
    var c = document.createElement('canvas'); c.width = c.height = 110;
    var x = c.getContext('2d'), d = x.createImageData(110, 110);
    for (var i = 0; i < d.data.length; i += 4) { var v = Math.random() < 0.5 ? 20 + Math.random() * 60 : 150 + Math.random() * 105; d.data[i] = d.data[i + 1] = v; d.data[i + 2] = v + 12; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0);
    root.style.setProperty('--noise', 'url(' + c.toDataURL() + ')');
    var flick = document.getElementById('flick'), t, first = true;
    document.addEventListener('sheet:change', function () {
      if (first) { first = false; return; }            // not on page load
      if (still) return;
      flick.classList.add('on'); clearTimeout(t);
      t = setTimeout(function () { flick.classList.remove('on'); }, 140);
    });
  })();
})();
