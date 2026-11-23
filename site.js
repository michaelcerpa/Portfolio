/* site.js — the three pages (About, Projects, Articles) and the music player.
   The words themselves are in index.html. This file only opens and closes things. */
(function () {
  // ---------- pages ----------
  // A menu word opens its page as a sheet of paper over the wall. Each page has its own address
  // (mcerpa.com/#about, #projects, #articles), so links and the back button work.
  var panel = document.getElementById('panel'), scroller = panel.querySelector('.panel__scroll');
  var sections = Array.prototype.slice.call(panel.querySelectorAll('[data-panel]'));
  var ids = sections.map(function (s) { return s.dataset.panel; });
  // The sections carry ids so the menu works as plain links without JavaScript. With it, drop them:
  // otherwise the browser tries to scroll the page to the section and nudges the sheet out of place.
  sections.forEach(function (s) { s.removeAttribute('id'); });
  var OLD = { work: 'projects' };                       // addresses from the previous site
  var last = null;

  function current() {
    var id = decodeURIComponent(location.hash.slice(1));
    id = OLD[id] || id;
    return ids.indexOf(id) >= 0 ? id : null;
  }
  function render() {
    var id = current();
    document.querySelectorAll('[data-go]').forEach(function (a) { if (a.dataset.go === id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    document.body.classList.toggle('has-panel', !!id);
    document.body.dataset.open = id || '';
    panel.hidden = !id;
    if (id) { sections.forEach(function (s) { s.hidden = s.dataset.panel !== id; }); scroller.scrollTop = 0; panel.scrollTop = 0; }
    else if (last && document.contains(last)) last.focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent('sheet:change', { detail: { id: id } }));
  }
  function shut() { if (current()) { history.pushState(null, '', location.pathname + location.search); render(); } }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-go]');
    if (a) { e.preventDefault(); last = a; if (current() === a.dataset.go) shut(); else location.hash = a.dataset.go; return; }   // the same word again closes it
    if (e.target.closest('[data-home]')) { e.preventDefault(); return shut(); }                                                   // so does the name
    if (e.target.closest('.panel__close')) return shut();
    if (current() && !e.target.closest('#panel, .hud, .player')) shut();                                                          // and a click on the wall
  });
  addEventListener('hashchange', render);
  addEventListener('keydown', function (e) { if (e.key === 'Escape') shut(); });
  render();

  // The pages' artwork is not needed to draw the globe, so it is fetched a moment later, once the globe is up.
  // By the time anyone opens a page it is already there.
  addEventListener('load', function () { setTimeout(function () { document.querySelectorAll('img[loading="lazy"]').forEach(function (i) { i.loading = 'eager'; }); }, 2500); });

  // ---------- music ----------
  // One song. It never starts by itself: browsers only allow sound after a press, and it would be rude anyway.
  // It plays a song file at assets/audio/track.mp3 (or track.m4a). Until that file exists, the player stays hidden.
  var TRACK = { files: ['assets/audio/track.mp3', 'assets/audio/track.m4a'] };
  (function () {
    var box = document.getElementById('player'), pp = document.getElementById('pp'), stop = document.getElementById('stop'), time = document.getElementById('time');
    if (!box) return;
    var fmt = function (s) { s = Math.floor(s || 0); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); };
    var au = new Audio(), fi = 0, ready = false;
    function paint() {
      time.textContent = fmt(au.currentTime) + ' / ' + (isFinite(au.duration) && au.duration ? fmt(au.duration) : '-:--');
      box.classList.toggle('is-playing', !au.paused); pp.setAttribute('aria-label', au.paused ? 'Play' : 'Pause');
    }
    au.preload = 'metadata'; au.loop = true; au.volume = 0.7;
    au.addEventListener('loadedmetadata', function () { ready = true; box.hidden = false; paint(); });
    ['play', 'pause', 'timeupdate'].forEach(function (ev) { au.addEventListener(ev, paint); });
    au.addEventListener('error', function () { if (++fi < TRACK.files.length) au.src = TRACK.files[fi]; });   // no file: the player stays hidden
    au.src = TRACK.files[0];
    pp.addEventListener('click', function () { if (!ready) return; if (au.paused) { var p = au.play(); if (p && p.catch) p.catch(function () {}); } else au.pause(); });
    stop.addEventListener('click', function () { if (!ready) return; au.pause(); try { au.currentTime = 0; } catch (e) {} paint(); });
  })();
})();
