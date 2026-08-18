/* Tanawin suite — "Update available" banner.
 *
 * Suite contract: a dismissible banner, identical wording in every app, that
 * lets someone running an old build refresh into the new one. It NEVER
 * auto-reloads (that would destroy half-typed work in the other apps) and it
 * fails silent — a failed check is simply "no update", never an error shown
 * to a user.
 *
 * ⚠️ MECHANISM — learned the hard way, 2026-08-18:
 * Cloudflare Workers static assets serve NO ETag and NO Last-Modified header
 * (verified on the live Hub: the only cache-ish header is cf-cache-status).
 * An ETag/HEAD-based check therefore never fires on this platform — it just
 * sits silently inert, which is the worst kind of broken.
 * So this fetches the document itself and compares a cheap hash of the bytes.
 * Self-maintaining: nothing to bump on deploy, and no build step needed.
 *
 * Apps WITH a build step should prefer stamping a build id into a tiny
 * /version.json instead — same contract, far less data per poll than
 * re-fetching a whole document.
 *
 * Cache-busting is mandatory, not decorative: Cloudflare's edge cache returns
 * stale copies to repeated identical requests (cf-cache-status: HIT), which
 * would make this check silently never fire.
 *
 * CONCIERGE ADAPTATION of the Hub's reference (same mechanism, same wording):
 * the banner stays hidden while the room-code gate (#gate) or the staff login
 * (#login) is on screen — per the work order. The check still runs and the
 * banner appears at the next check after the screen is passed.
 */
(function () {
  var POLL_MS = 5 * 60 * 1000;
  var loadedHash = null;     // the build this page was loaded as — never updated
  var dismissedHash = null;  // the build the user dismissed, so we don't re-nag
  var banner = null;

  function hash(str) {
    // FNV-1a, 32-bit. Not cryptographic — we only need "did the bytes change".
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h.toString(36);
  }

  function currentBuild(cb) {
    // Unique param per request — a reused timestamp still gets served from cache.
    var bust = Date.now().toString(36) + Math.random().toString(36).slice(2);
    fetch(location.pathname + '?x=' + bust, { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.text() : null; })
      .then(function (text) { if (text) cb(hash(text)); })
      .catch(function () { /* offline, 500, blocked — stay quiet */ });
  }

  function ensureStyles() {
    if (document.getElementById('tw-update-style')) return;
    var s = document.createElement('style');
    s.id = 'tw-update-style';
    s.textContent =
      '.tw-update{position:fixed;top:0;left:0;right:0;z-index:9999;' +
      'display:flex;align-items:center;gap:12px;justify-content:center;' +
      'background:#FBFAF6;color:#1F1B16;padding:10px 14px;' +
      'font-family:-apple-system,system-ui,sans-serif;font-size:14px;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.25)}' +
      '.tw-update button{font:inherit;font-weight:600;cursor:pointer;' +
      'border:0;border-radius:8px;padding:6px 14px;' +
      'background:#9A3518;color:#FBFAF6}' +
      '.tw-update .tw-x{background:none;color:#6E6759;font-weight:400;' +
      'padding:6px 8px;font-size:18px;line-height:1}';
    document.head.appendChild(s);
  }

  function gateOnScreen() {
    var ids = ['gate', 'login'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el && !el.classList.contains('hidden')) return true;
    }
    return false;
  }

  function show(build) {
    if (banner) return;
    if (gateOnScreen()) return;   // never on the code gate / login screen
    ensureStyles();
    banner = document.createElement('div');
    banner.className = 'tw-update';
    banner.setAttribute('role', 'status');

    var text = document.createElement('span');
    text.textContent = 'Update available';

    var refresh = document.createElement('button');
    refresh.textContent = 'Refresh';
    refresh.onclick = function () { location.reload(); };

    var close = document.createElement('button');
    close.className = 'tw-x';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.onclick = function () {
      dismissedHash = build;          // silent until a NEWER build appears
      banner.remove();
      banner = null;
    };

    banner.appendChild(text);
    banner.appendChild(refresh);
    banner.appendChild(close);
    document.body.appendChild(banner);
  }

  function check() {
    currentBuild(function (build) {
      if (loadedHash === null) { loadedHash = build; return; }   // baseline only
      if (build !== loadedHash && build !== dismissedHash) show(build);
    });
  }

  check();                                     // establish the baseline
  setInterval(function () {
    if (!document.hidden) check();             // don't poll a hidden tab
  }, POLL_MS);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) check();             // the "phone woke up" case
  });

  // production-verification hook; harmless to leave in
  window.__twUpdateCheck = check;
})();
