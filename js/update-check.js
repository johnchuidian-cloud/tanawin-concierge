/* Tanawin suite — "Update available" banner. Concierge's implementation,
 * adopting Menu's document-plus-assets mechanism.
 *
 * Suite contract (identical in every app): a dismissible banner, same wording
 * everywhere, that lets someone running an old build refresh into the new
 * one. It NEVER auto-reloads and it fails silent — a failed check is simply
 * "no update", never an error shown to a guest.
 *
 * ⚠️ WHY document-PLUS-assets (defect found 2026-08-18, after first ship):
 * v1 hashed only the document, like the Hub — but Concierge's code lives
 * entirely in external files (js/app.js, js/staff.js, css/*), and most real
 * deploys here touch ONLY those. A document-only hash sat inert for exactly
 * the deploys that matter — and the original verification missed it because
 * its build-stamp methodology edited the HTML every time, guaranteeing a
 * detectable change. Menu hit the identical problem; this is their fix: the
 * "build" is a hash of the document AND every same-origin asset the live DOM
 * loads (script[src] + stylesheet links; CDN assets skipped — they don't
 * move when we deploy). A deploy that adds/removes an asset changes the
 * document too, so that case is still caught.
 *
 * CONCIERGE ADAPTATIONS (kept from v1): the banner never renders while the
 * room-code gate (#gate) or staff login (#login) is on screen — the check
 * still runs and the banner appears at the next check after entry. Plus a
 * window.__twUpdateCheck hook for production verification.
 *
 * Cache-busting is mandatory, not decorative: Cloudflare's edge returns
 * stale copies to repeated identical requests (and serves NO ETag at all),
 * which would make this check silently never fire.
 */
(function () {
  var POLL_MS = 5 * 60 * 1000;
  var loadedBuild = null;     // what this page was loaded as — never updated
  var dismissedBuild = null;  // so a dismissed build never nags again
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

  // Captured once, from the page as loaded. Cross-origin assets (the CDN
  // supabase-js and qrcode libs) are skipped: they don't move when we deploy,
  // and reading them would need CORS we don't control.
  var PARTS = (function () {
    var urls = [location.pathname];
    var nodes = document.querySelectorAll('script[src], link[rel="stylesheet"][href]');
    for (var i = 0; i < nodes.length; i++) {
      var raw = nodes[i].getAttribute('src') || nodes[i].getAttribute('href');
      if (!raw) continue;
      try {
        var u = new URL(raw, location.href);
        if (u.origin === location.origin) urls.push(u.pathname);
      } catch (e) { /* unparseable src — skip it */ }
    }
    return urls;
  })();

  function currentBuild(cb) {
    // Unique per request: a reused timestamp still gets served from the edge.
    var bust = Date.now().toString(36) + Math.random().toString(36).slice(2);
    Promise.all(PARTS.map(function (path) {
      return fetch(path + '?x=' + bust, { cache: 'no-store' })
        .then(function (res) { return res.ok ? res.text() : null; });
    })).then(function (texts) {
      // A partial read would hash to something new and cry wolf. Any miss and
      // we say nothing at all, and try again on the next poll.
      for (var i = 0; i < texts.length; i++) if (texts[i] === null) return;
      cb(hash(texts.join(' ')));
    }).catch(function () { /* offline, 500, blocked — stay quiet */ });
  }

  function ensureStyles() {
    if (document.getElementById('tw-update-style')) return;
    var s = document.createElement('style');
    s.id = 'tw-update-style';
    s.textContent =
      '.tw-update{position:fixed;top:0;left:0;right:0;z-index:9999;' +
      'display:flex;align-items:center;gap:12px;justify-content:center;' +
      'background:#FBFAF6;color:#1F1B16;padding:10px 14px;' +
      'font-family:system-ui,-apple-system,sans-serif;font-size:14px;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.25)}' +
      '.tw-update button{font:inherit;font-weight:600;cursor:pointer;' +
      'border:0;border-radius:8px;padding:6px 14px;' +
      'background:#9A3518;color:#FBFAF6}' +
      '.tw-update .tw-x{background:none;color:#6E6759;font-weight:400;' +
      'padding:6px 8px;font-size:18px;line-height:1}';
    document.head.appendChild(s);
  }

  function setOffset(px) {
    // Push the page down so the banner never covers the sticky topbar.
    document.body.style.paddingTop = px ? px + 'px' : '';
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
      dismissedBuild = build;        // silent until a NEWER build appears
      banner.remove();
      banner = null;
      setOffset(0);
    };

    banner.appendChild(text);
    banner.appendChild(refresh);
    banner.appendChild(close);
    document.body.appendChild(banner);
    setOffset(banner.offsetHeight);
  }

  function check() {
    currentBuild(function (build) {
      if (loadedBuild === null) { loadedBuild = build; return; }   // baseline only
      if (build !== loadedBuild && build !== dismissedBuild) show(build);
    });
  }

  check();                                     // establish the baseline
  setInterval(function () {
    if (!document.hidden) check();             // never poll a hidden tab
  }, POLL_MS);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) check();             // the "phone woke up" case
  });

  // production-verification hook; harmless to leave in
  window.__twUpdateCheck = check;
})();
