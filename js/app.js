// Tanawin Concierge — guest app (Tanawin Info, Phase 1).
// settling-test marker 2026-08-18: js-only deploy, no HTML change.
//
// Flow: a room access code (from the printed card's QR ?code= param, or typed
// once) is validated by the concierge_bootstrap RPC, which also returns all
// content. The code persists in localStorage — guest convenience, not a
// security boundary (handoff §3, accepted deliberately).

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);

const CODE_KEY = 'concierge_code';
let roomCode = null;

// ---------- boot ----------

(async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.get('preview') === '1' && await tryPreview()) return;
  const urlCode = (params.get('code') || '').replace(/\D/g, '');
  if (urlCode) {
    // Strip the code from the address bar so shares/screenshots don't carry it.
    history.replaceState(null, '', location.pathname);
  }
  const candidate = urlCode || localStorage.getItem(CODE_KEY) || '';
  if (candidate.length === 6 && await tryCode(candidate)) return;
  showGate();
})();

async function tryCode(code) {
  try {
    const { data, error } = await db.rpc('concierge_bootstrap', { p_access_code: code });
    if (error || !data || !data.ok) return false;
    roomCode = code;
    localStorage.setItem(CODE_KEY, code);
    render(data);
    $('gate').classList.add('hidden');
    $('app').classList.remove('hidden');
    return true;
  } catch {
    return false;
  }
}

// Admin preview: reuses the staff editor's login session (same origin, same
// Supabase project) to read content directly — no room code needed. Renders
// the guest view byte-for-byte, plus a banner only the admin sees.
async function tryPreview() {
  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session) return false;
    const { data: rows, error } = await db.from('concierge_content')
      .select('key, value, last_reviewed');
    if (error || !rows || !rows.length) return false;
    const content = {};
    rows.forEach(r => { content[r.key] = { value: r.value, last_reviewed: r.last_reviewed }; });
    render({ room: { name: 'Guest preview' }, content });
    $('previewBar').classList.remove('hidden');
    $('switchRoom').parentElement.classList.add('hidden');
    $('gate').classList.add('hidden');
    $('app').classList.remove('hidden');
    return true;
  } catch {
    return false;
  }
}

function showGate() {
  $('app').classList.add('hidden');
  $('gate').classList.remove('hidden');
  $('gateCode').focus();
}

$('gateCode').addEventListener('input', async e => {
  const code = e.target.value.replace(/\D/g, '').slice(0, 6);
  e.target.value = code;
  $('gateError').classList.add('hidden');
  if (code.length !== 6) return;
  $('gateBusy').classList.remove('hidden');
  const ok = await tryCode(code);
  $('gateBusy').classList.add('hidden');
  if (!ok) {
    e.target.value = '';
    $('gateError').classList.remove('hidden');
  }
});

$('switchRoom').onclick = () => {
  localStorage.removeItem(CODE_KEY);
  location.reload();
};

// ---------- render ----------

function block(content, key) {
  const b = content[key];
  const v = b && b.value && typeof b.value === 'object' && !Array.isArray(b.value) ? b.value : {};
  return { v, reviewed: (b && b.last_reviewed) || null };
}

// Defensive coercion: one malformed content value (a bad SQL edit, a future
// editor bug) must degrade to an empty card, never crash the whole render.
const arr = x => (Array.isArray(x) ? x : []);
const str = x => (typeof x === 'string' ? x : '');
const obj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});

// Inline formatting in Lexi's text — the same markers Telegram uses:
// **bold**, __italic__, ++underline++. Parsed into real elements (never
// innerHTML), so content can't inject markup.
function fmt(text) {
  const frag = document.createDocumentFragment();
  String(text || '')
    .split(/(\*\*[^*]+\*\*|__[^_]+__|\+\+[^+]+\+\+)/g)
    .forEach(tok => {
      let el = null;
      if (/^\*\*[^*]+\*\*$/.test(tok)) el = document.createElement('strong');
      else if (/^__[^_]+__$/.test(tok)) el = document.createElement('em');
      else if (/^\+\+[^+]+\+\+$/.test(tok)) el = document.createElement('u');
      if (el) {
        el.textContent = tok.slice(2, -2);
        frag.appendChild(el);
      } else if (tok) {
        frag.appendChild(document.createTextNode(tok));
      }
    });
  return frag;
}

function setFmt(el, text) {
  el.textContent = '';
  el.appendChild(fmt(text));
}

// Side tabs: jump-scroll to each section.
document.querySelectorAll('#rail button').forEach(btn => {
  btn.onclick = () => {
    const el = document.getElementById(btn.dataset.target);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
});

function render(data) {
  $('roomChip').textContent = data.room.name;
  const c = data.content || {};

  renderWelcome(block(c, 'welcome').v);
  renderWifi(block(c, 'wifi').v);
  renderPools(block(c, 'pool_hours'));
  renderMap(block(c, 'getting_around').v);
  renderKeyInfo(block(c, 'key_info').v);
  renderContact(block(c, 'contact').v);
  renderRules(block(c, 'house_rules').v);

  // The Menu card's wording is Lexi-editable (menu_card block).
  const mc = block(c, 'menu_card').v;
  if (mc.title) setFmt($('menuTitle'), mc.title);
  if (mc.subtitle) setFmt($('menuSub'), mc.subtitle);

  // Hand the code to Menu so the guest never retypes it at checkout, and
  // flag where they came from so Menu can show its "Back to Concierge" bar
  // (Menu-side feature; QR-direct Menu guests never get the bar).
  $('menuLink').href = roomCode
    ? `${MENU_URL}/?code=${encodeURIComponent(roomCode)}&from=concierge`
    : `${MENU_URL}/?from=concierge`;

  initRequests(c);
  initFeedback(block(c, 'feedback_config').v);
  applyOrder(block(c, 'layout').v);
}

// The greeting guests land on. Lexi-editable like every other guest-visible
// string, so changing the wording never needs a deploy; setFmt gives her the
// same **bold** / __italic__ markers as the rest of the app. An empty message
// hides the card rather than leaving a blank box at the top of the page.
function renderWelcome(v) {
  const card = $('welcomeCard');
  const text = str(v.message);
  card.classList.toggle('hidden', !text);
  if (text) setFmt($('welcomeText'), text);
}

// ---------- feedback (approved 2026-08-07) ----------
//
// Private by default: everything lands in concierge_feedback for the staff.
// The routing trick: 4-5 stars ALSO get a "share it on Google" button — but
// only when Lexi has saved the Google link (feedback_config). Lower ratings
// end at a plain thank-you, so problems come to the desk, not to Google.

let fbGoogleUrl = '';
let fbRating = 0;

function initFeedback(v) {
  fbGoogleUrl = str(v.google_url);
  fbRating = 0;
  $('fbForm').classList.remove('hidden');
  $('fbDone').classList.add('hidden');
  const wrap = $('fbStars');
  wrap.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.textContent = '★';
    b.setAttribute('aria-label', `${i} star${i > 1 ? 's' : ''}`);
    b.onclick = () => {
      fbRating = i;
      [...wrap.children].forEach((el, idx) => el.classList.toggle('lit', idx < i));
    };
    wrap.appendChild(b);
  }
}

$('fbSend').onclick = async () => {
  const btn = $('fbSend');
  if (!roomCode) {
    btn.textContent = 'Not available in preview';
    return;
  }
  if (!fbRating) {
    btn.textContent = 'Tap the stars first';
    setTimeout(() => { btn.textContent = 'Send feedback'; }, 1600);
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const { data, error } = await db.rpc('concierge_submit_feedback', {
      p_access_code: roomCode,
      p_rating: fbRating,
      p_enjoyed: $('fbEnjoyed').value.trim() || null,
      p_improve: $('fbImprove').value.trim() || null,
      p_app_note: $('fbAppNote').value.trim() || null,
    });
    if (error || !data || !data.ok) {
      btn.disabled = false;
      btn.textContent = data && data.reason === 'rate_limited'
        ? 'Thanks! We\'ve got plenty from your room today.'
        : 'Could not send. Please try again.';
      return;
    }
    $('fbForm').classList.add('hidden');
    const done = $('fbDone');
    done.innerHTML = '';
    const big = document.createElement('div');
    big.className = 'big';
    big.textContent = fbRating >= 4 ? '🧡' : '🙏';
    const text = document.createElement('p');
    text.textContent = fbRating >= 4
      ? 'Thank you! That made our day.'
      : 'Thank you for telling us. We\'ll do better, and the front desk is always ready to make things right during your stay.';
    done.appendChild(big);
    done.appendChild(text);
    if (fbRating >= 4 && fbGoogleUrl) {
      const g = document.createElement('a');
      g.className = 'fb-google';
      g.href = fbGoogleUrl;
      g.target = '_blank';
      g.rel = 'noopener';
      g.textContent = '⭐ Share it on Google. It helps us a lot.';
      done.appendChild(g);
    }
    done.classList.remove('hidden');
  } catch {
    btn.disabled = false;
    btn.textContent = 'No connection. Please try again.';
  }
};

// ---------- section order (Lexi-editable via the `layout` block) ----------

const CARD_FOR = {
  wifi: 'wifiCard',
  house_rules: 'rulesCard',
  requests: 'requestCard',
  pool_hours: 'poolCard',
  getting_around: 'mapCard',
  key_info: 'keyCard',
  menu_card: 'menuCard',
  contact: 'contactCard',
  feedback: 'feedbackCard',
};
// Default: wifi first (the most-asked question), house rules second,
// requests third (the third most-asked: room/kitchen items); feedback last.
const DEFAULT_ORDER = ['wifi', 'house_rules', 'requests', 'pool_hours',
  'getting_around', 'key_info', 'menu_card', 'contact', 'feedback'];

function applyOrder(v) {
  const order = (Array.isArray(v.order) && v.order.length ? v.order : DEFAULT_ORDER)
    .filter(k => CARD_FOR[k]);
  // Sections this build knows but the saved order doesn't (future cards)
  // append at the end rather than disappearing.
  DEFAULT_ORDER.forEach(k => { if (!order.includes(k)) order.push(k); });
  const main = $('content');
  const footer = main.querySelector('.footer');
  order.forEach(k => {
    const card = $(CARD_FOR[k]);
    if (card) main.insertBefore(card, footer);
  });
  // The side rail follows the same order.
  const rail = $('rail');
  order.forEach(k => {
    const btn = rail.querySelector(`[data-target="${CARD_FOR[k]}"]`);
    if (btn) rail.appendChild(btn);
  });
}

// ---------- requests (Phase 2) ----------
//
// Guests submit through concierge_submit_request (code-validated server-side,
// dining codes rejected, 10/room/hour). Sent request ids live in localStorage
// as claim tickets; statuses come from the concierge_request_status peephole.

const REQ_KEY = 'concierge_my_requests';
// How long a ticket stays live to this device. saveMyRequests drops rows past
// it, pendingRequests stops polling for them, and refreshMyRequests stops
// asking after them — one number so those three can't drift apart.
const TICKET_WINDOW_MS = 48 * 3600 * 1000;
const KIND_LABEL = {
  towel_change: 'Bath towel change',
  bin_clearing: 'Bin clearing',
  room_items: 'Room items',
  problem: 'Problem report',
};
const STATUS_LABEL = {
  new: 'Sent, waiting for staff',
  acknowledged: 'Acknowledged, on it!',
  done: 'Done',
  cancelled: 'Cancelled',
};
let reqItems = [];    // Lexi's request_items list (via bootstrap)
let reqConfig = {};   // request_config: open / last-call times
let reqState = null;  // open sheet state: {kind, qty:{}, notes:{}}

function initRequests(content) {
  reqItems = arr(block(content, 'request_items').v.items).filter(i => i && typeof i === 'object');
  reqConfig = block(content, 'request_config').v || {};
  renderMyRequests();
  refreshMyRequests();
}

// Tickets are scoped to the room code that created them — a device that
// switches rooms (front desk, a guest's next stay) must not show the old
// room's requests. Legacy tickets without a code are dropped.
function myRequests() {
  try {
    return JSON.parse(localStorage.getItem(REQ_KEY) || '[]')
      .filter(r => r.code && r.code === roomCode);
  } catch { return []; }
}

function allStoredRequests() {
  try { return JSON.parse(localStorage.getItem(REQ_KEY) || '[]').filter(r => r.code); } catch { return []; }
}

function saveMyRequests(list) {
  // `list` is the CURRENT room's tickets — merge back with other rooms'
  // so switching rooms never wipes anyone's history. Per room: newest 8;
  // everything older than 48h drops.
  const cutoff = Date.now() - TICKET_WINDOW_MS;
  const fresh = r => new Date(r.created).getTime() > cutoff;
  const others = allStoredRequests().filter(r => r.code !== roomCode && fresh(r));
  localStorage.setItem(REQ_KEY, JSON.stringify(
    others.concat(list.filter(fresh).slice(-8))));
}

// `flipped` (optional Set of request ids) marks the rows whose status just
// changed, so the guest notices the change instead of finding a different word
// than the one they last looked at.
function renderMyRequests(flipped) {
  const wrap = $('myRequests');
  wrap.innerHTML = '';
  myRequests().slice().reverse().forEach(r => {
    const row = document.createElement('div');
    row.className = 'myreq-row';
    if (flipped && flipped.has(r.id)) row.classList.add('myreq-flip');
    const kind = document.createElement('span');
    kind.className = 'myreq-kind';
    const t = new Date(r.created);
    kind.textContent = `${KIND_LABEL[r.kind] || r.kind} · ${t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    // What exactly was asked for — two "Room items" requests must be
    // tellable apart (Lexi's test feedback).
    if (r.summary) {
      const detail = document.createElement('span');
      detail.className = 'myreq-detail';
      detail.textContent = r.summary;
      kind.appendChild(detail);
    }
    const st = document.createElement('span');
    st.className = `myreq-status st-${r.status || 'new'}`;
    st.textContent = STATUS_LABEL[r.status] || STATUS_LABEL.new;
    const right = document.createElement('div');
    right.className = 'myreq-right';
    right.appendChild(st);
    row.appendChild(kind);
    row.appendChild(right);
    // A still-new request can be taken back before staff pick it up.
    if (!r.status || r.status === 'new') {
      const cancel = document.createElement('button');
      cancel.className = 'myreq-cancel';
      cancel.textContent = 'Cancel';
      cancel.onclick = async () => {
        cancel.disabled = true;
        try {
          const { data } = await db.rpc('concierge_cancel_request', { p_id: r.id });
          if (data && data.ok) {
            const list = myRequests();
            const mine = list.find(x => x.id === r.id);
            if (mine) mine.status = 'cancelled';
            saveMyRequests(list);
            renderMyRequests();
          } else {
            // staff already picked it up — show the fresh status instead
            refreshMyRequests();
            cancel.remove();
          }
        } catch {
          cancel.disabled = false;
        }
      };
      right.appendChild(cancel);
    }
    wrap.appendChild(row);
  });
  syncPolling();
}

async function refreshMyRequests() {
  const list = myRequests();
  if (!list.length) return;
  const flipped = new Set();
  for (const r of list) {
    // Same test the poller uses. These disagreed until 2026-08-24: polling
    // stopped at 48h but this loop kept asking after tickets it had given up
    // on, so a forgotten tab still fired RPCs for them on every return.
    if (!isOpenTicket(r)) continue;
    try {
      const { data } = await db.rpc('concierge_request_status', { p_id: r.id });
      if (data && data.ok && data.status !== r.status) {
        r.status = data.status;
        flipped.add(r.id);
      }
    } catch { /* offline — try again next tick */ }
  }
  if (flipped.size) {
    saveMyRequests(list);
    renderMyRequests(flipped);
  }
}

// ---------- live status ----------
//
// Concierge deliberately runs NO realtime subscription. Beyond the anon-select
// problem, Menu found (2026-08-24) that postgres_changes ships WHOLE ROWS: a
// subscription to concierge_requests would push every problem photo over the
// websocket to every subscriber, blob and all. If this ever becomes realtime,
// it must be a per-ticket broadcast channel carrying status only.
//
// While a ticket is still open AND the guest is actually looking at the page,
// re-read the status peephole every 10s so "Acknowledged, on it!" appears on
// its own. Deliberately a poll, not realtime: anon has no select on
// concierge_requests (a subscription would leak every room's photos and notes
// — if this ever becomes realtime, use a per-ticket broadcast channel keyed by
// the request uuid, status only). And never a page reload — a guest may be
// halfway through typing another request.

const POLL_MS = 10000;
let pollTimer = null;

// Still worth asking about: not finished, and inside the same window
// saveMyRequests keeps — a request staff never closed shouldn't have a
// forgotten open tab polling for it days later.
function isOpenTicket(r) {
  return (!r.status || r.status === 'new' || r.status === 'acknowledged') &&
    new Date(r.created).getTime() > Date.now() - TICKET_WINDOW_MS;
}

function pendingRequests() {
  return myRequests().filter(isOpenTicket);
}

// Idempotent: safe to call after any render. Polls only when there is
// something to learn and someone to see it.
function syncPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
  if (document.hidden || !pendingRequests().length) return;
  pollTimer = setInterval(refreshMyRequests, POLL_MS);
}

document.addEventListener('visibilitychange', () => {
  // Coming back from a locked phone: catch up at once rather than waiting out
  // a full interval, since that's exactly when staff have had time to act.
  if (!document.hidden) refreshMyRequests();
  syncPolling();
});

// Out-of-hours check mirrors the server's (which has the final say) so the
// guest is warned BEFORE sending, not only after.
function isOutOfHours() {
  const now = new Date();
  const hm = now.getHours() * 60 + now.getMinutes();
  const parse = (s, fallback) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
    return m ? (+m[1]) * 60 + (+m[2]) : fallback;
  };
  const weekend = now.getDay() === 0 || now.getDay() === 6;
  const lastCall = weekend
    ? parse(reqConfig.last_call_weekend, 20 * 60)
    : parse(reqConfig.last_call_weekday, 18 * 60);
  const open = parse(reqConfig.open, 7 * 60);
  return hm >= lastCall || hm < open;
}

const OOH_TEXT = 'Staff are done for the day. Your request is saved, and they\'ll handle it when they\'re back at 7am.';

document.querySelectorAll('.req-btn').forEach(btn => {
  btn.onclick = () => openReqSheet(btn.dataset.kind);
});
$('reqCancel').onclick = closeReqSheet;
$('reqBackdrop').onclick = closeReqSheet;

function closeReqSheet() {
  reqState = null;
  $('reqSheet').classList.add('hidden');
  $('reqBackdrop').classList.add('hidden');
}

function openReqSheet(kind) {
  reqState = { kind, qty: {}, notes: {} };
  $('reqTitle').textContent = KIND_LABEL[kind];
  $('reqOoh').textContent = OOH_TEXT;
  $('reqOoh').classList.toggle('hidden', !isOutOfHours());
  $('reqActions').classList.remove('hidden');
  $('reqSend').disabled = false;
  $('reqSend').textContent = 'Send request';
  const body = $('reqBody');
  body.innerHTML = '';

  if (kind === 'towel_change' || kind === 'bin_clearing') {
    const p = document.createElement('p');
    p.className = 'req-confirm-text';
    p.textContent = kind === 'towel_change'
      ? 'We\'ll bring fresh bath towels and take the used ones.'
      : 'We\'ll come and clear your bins.';
    body.appendChild(p);
  }

  if (kind === 'room_items') {
    reqItems.forEach((item, idx) => {
      // Keyed by list position, not id — two items that end up with the same
      // id (duplicate labels in the editor) must never share a counter.
      const k = `${idx}|${item.id}`;
      const row = document.createElement('div');
      row.className = 'req-item-row';
      const label = document.createElement('div');
      label.className = 'req-item-label';
      label.textContent = item.label;
      const stepper = document.createElement('div');
      stepper.className = 'req-stepper';
      const minus = document.createElement('button');
      minus.className = 'req-step-btn';
      minus.textContent = '−';
      const qty = document.createElement('span');
      qty.className = 'req-qty';
      const plus = document.createElement('button');
      plus.className = 'req-step-btn';
      plus.textContent = '+';
      const noteInput = document.createElement('input');
      noteInput.className = 'req-item-note hidden';
      noteInput.placeholder = item.note_prompt || 'Please specify';
      noteInput.oninput = () => { reqState.notes[k] = noteInput.value; };
      const draw = () => {
        const n = reqState.qty[k] || 0;
        qty.textContent = n;
        minus.disabled = n === 0;
        noteInput.classList.toggle('hidden', !(item.needs_note && n > 0));
      };
      minus.onclick = () => { reqState.qty[k] = Math.max(0, (reqState.qty[k] || 0) - 1); draw(); };
      plus.onclick = () => { reqState.qty[k] = Math.min(10, (reqState.qty[k] || 0) + 1); draw(); };
      draw();
      stepper.appendChild(minus);
      stepper.appendChild(qty);
      stepper.appendChild(plus);
      row.appendChild(label);
      row.appendChild(stepper);
      body.appendChild(row);
      body.appendChild(noteInput);
    });
  }

  if (kind === 'problem') {
    const note = document.createElement('textarea');
    note.className = 'req-note';
    note.placeholder = 'What\'s the problem? e.g. "The aircon in our room is dripping."';
    note.oninput = () => { reqState.notes.__main = note.value; };
    body.appendChild(note);
    // No photo attachment, by Lexi's decision (2026-08-24): a guest shouldn't
    // have to photograph a fault to be taken seriously, and the picture lands
    // in their own camera roll on the way. A problem is attended to on the
    // strength of the description. The `photo_data` column and p_photo
    // parameter stay in place, unused, so the six existing rows and Menu's
    // reader keep working — nothing new is ever written to them.
  }

  if (kind === 'room_items') {
    const note = document.createElement('textarea');
    note.className = 'req-note';
    note.placeholder = 'Anything else we should know? (optional)';
    note.oninput = () => { reqState.notes.__main = note.value; };
    body.appendChild(note);
  }

  $('reqBackdrop').classList.remove('hidden');
  $('reqSheet').classList.remove('hidden');
}

$('reqSend').onclick = async () => {
  if (!reqState) return;
  if (!roomCode) {  // admin preview has no room code
    $('reqSend').textContent = 'Not available in preview';
    return;
  }
  const { kind } = reqState;
  let items = null;
  if (kind === 'room_items') {
    items = reqItems
      .map((it, idx) => ({ it, k: `${idx}|${it.id}` }))
      .filter(({ k }) => (reqState.qty[k] || 0) > 0)
      .map(({ it, k }) => ({
        id: it.id,
        label: it.label,
        qty: reqState.qty[k],
        note: (reqState.notes[k] || '').trim() || undefined,
      }));
    if (!items.length) {
      $('reqSend').textContent = 'Pick at least one item';
      setTimeout(() => { $('reqSend').textContent = 'Send request'; }, 1600);
      return;
    }
  }
  if (kind === 'problem' && !(reqState.notes.__main || '').trim()) {
    $('reqSend').textContent = 'Please describe the problem';
    setTimeout(() => { $('reqSend').textContent = 'Send request'; }, 1600);
    return;
  }

  $('reqSend').disabled = true;
  $('reqSend').textContent = 'Sending…';
  try {
    const { data, error } = await db.rpc('concierge_submit_request', {
      p_access_code: roomCode,
      p_kind: kind,
      p_items: items,
      p_note: (reqState.notes.__main || '').trim() || null,
    });
    if (error || !data) throw new Error('network');
    if (!data.ok) {
      $('reqSend').disabled = false;
      $('reqSend').textContent = data.reason === 'rate_limited'
        ? 'Too many requests this hour. Please ask the front desk.'
        : 'Could not send. Please try again.';
      return;
    }
    let summary = '';
    if (kind === 'room_items' && items) {
      summary = items
        .map(it => it.label + (it.note ? ` (${it.note})` : '') + (it.qty > 1 ? ` ×${it.qty}` : ''))
        .join(', ');
    } else if (kind === 'problem') {
      summary = (reqState.notes.__main || '').trim();
    }
    if (summary.length > 70) summary = summary.slice(0, 67) + '…';
    const list = myRequests();
    list.push({ id: data.id, kind, status: 'new', created: new Date().toISOString(), summary: summary || undefined, code: roomCode });
    saveMyRequests(list);
    renderMyRequests();
    const body = $('reqBody');
    body.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'req-done-msg';
    const big = document.createElement('div');
    big.className = 'big';
    big.textContent = '✓';
    const text = document.createElement('p');
    text.textContent = data.out_of_hours
      ? OOH_TEXT
      : 'Request sent! Staff have been notified.';
    msg.appendChild(big);
    msg.appendChild(text);
    body.appendChild(msg);
    $('reqOoh').classList.add('hidden');
    $('reqActions').classList.add('hidden');
    setTimeout(closeReqSheet, 2600);
  } catch {
    $('reqSend').disabled = false;
    $('reqSend').textContent = 'No connection. Please try again.';
  }
};

function renderWifi(v) {
  const nets = arr(v.networks).filter(n => n && typeof n === 'object' && str(n.name));
  const wrap = $('wifiNets');
  wrap.innerHTML = '';
  $('wifiEmpty').classList.toggle('hidden', nets.length > 0);
  nets.forEach(net => {
    const div = document.createElement('div');
    div.className = 'wifi-net';
    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'wifi-name';
    name.textContent = net.name;
    info.appendChild(name);
    if (net.password) {
      const row = document.createElement('div');
      row.className = 'wifi-pass-row';
      const pass = document.createElement('span');
      pass.className = 'wifi-pass';
      pass.textContent = net.password;
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      btn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(net.password);
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800);
        } catch { /* clipboard unavailable — the password is visible anyway */ }
      };
      row.appendChild(pass);
      row.appendChild(btn);
      info.appendChild(row);
    }
    div.appendChild(info);
    const qrEl = wifiQr(net);
    if (qrEl) div.appendChild(qrEl);
    wrap.appendChild(div);
  });
}

// Standard WIFI: QR — scan with the phone camera to join. Regenerates from
// the stored values whenever Lexi changes them.
function wifiQr(net) {
  if (typeof qrcode !== 'function' || !net.password) return null;
  try {
    const esc = s => String(s).replace(/([\\;,:"])/g, '\\$1');
    const qr = qrcode(0, 'M');
    qr.addData(`WIFI:T:WPA;S:${esc(net.name)};P:${esc(net.password)};;`);
    qr.make();
    const holder = document.createElement('div');
    holder.className = 'wifi-qr';
    holder.innerHTML = qr.createSvgTag({ cellSize: 2.6, margin: 2 });
    const label = document.createElement('div');
    label.className = 'wifi-qr-label';
    label.textContent = 'Scan to join';
    holder.appendChild(label);
    return holder;
  } catch {
    return null;
  }
}

function renderPools(b) {
  const v = b.v;
  setFmt($('poolIntro'), v.intro || '');
  const list = $('poolList');
  list.innerHTML = '';
  arr(v.pools).filter(p => p && typeof p === 'object').forEach(p => {
    const row = document.createElement('div');
    row.className = 'pool-row';
    const left = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'pool-name';
    name.textContent = p.name;
    const loc = document.createElement('div');
    loc.className = 'pool-loc';
    loc.textContent = p.location || '';
    left.appendChild(name);
    left.appendChild(loc);
    const hours = document.createElement('div');
    hours.className = 'pool-hours';
    hours.textContent = p.hours || '';
    row.appendChild(left);
    row.appendChild(hours);
    list.appendChild(row);
  });
  setFmt($('poolTip'), v.tip || '');
  $('poolTip').classList.toggle('hidden', !v.tip);
  // Third-party content: show the quiet staleness note (handoff §10).
  $('poolAsOf').textContent = b.reviewed
    ? `As of ${b.reviewed}. Please confirm at the front desk.`
    : '';
}

function renderMap(v) {
  setFmt($('mapIntro'), v.intro || '');
  const list = $('mapDirections');
  list.innerHTML = '';
  arr(v.directions).filter(d => d && typeof d === 'object').forEach(d => {
    const row = document.createElement('div');
    row.className = 'dir-row';
    const place = document.createElement('div');
    place.className = 'dir-place';
    place.textContent = d.place;
    const walk = document.createElement('div');
    walk.className = 'dir-walk';
    setFmt(walk, d.walk || '');
    row.appendChild(place);
    row.appendChild(walk);
    list.appendChild(row);
  });
  const wrap = $('mapWrap');
  if (str(v.image_url)) {
    $('mapImage').src = v.image_url;
    wrap.classList.remove('hidden');
    positionMapMarker($('mapMarker'), v.marker);
  } else {
    wrap.classList.add('hidden');
  }
}

// marker = {x, y, rx, ry} — all percentages of the image box, so the ellipse
// scales with the responsive image.
function positionMapMarker(el, marker) {
  const m = obj(marker);
  const num = (x, lo, hi, fb) => {
    const n = Number(x);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb;
  };
  const x = num(m.x, 0, 100, null);
  const y = num(m.y, 0, 100, null);
  if (x === null || y === null) {
    el.classList.add('hidden');
    return;
  }
  // radii clamped so a corrupt value can't paint a giant blob over the map
  const rx = num(m.rx, 1, 40, 6.5);
  const ry = num(m.ry, 1, 40, rx);
  el.style.left = x + '%';
  el.style.top = y + '%';
  el.style.width = (2 * rx) + '%';
  el.style.height = (2 * ry) + '%';
  el.classList.remove('hidden');
}

function renderKeyInfo(v) {
  const list = $('keyList');
  list.innerHTML = '';
  arr(v.items).filter(i => i && typeof i === 'object').forEach(item => {
    const row = document.createElement('div');
    row.className = 'key-row';
    const label = document.createElement('div');
    label.className = 'key-label';
    label.textContent = item.label;
    const value = document.createElement('div');
    value.className = 'key-value';
    setFmt(value, item.value);
    row.appendChild(label);
    row.appendChild(value);
    list.appendChild(row);
  });
}

function renderContact(v) {
  const list = $('contactList');
  list.innerHTML = '';
  const entries = [];
  const globe = str(v.globe), smart = str(v.smart), messenger = str(v.messenger), viber = str(v.viber);
  if (globe) entries.push({ label: 'Call (Globe)', value: globe, href: `tel:${globe.replace(/\s/g, '')}` });
  if (smart) entries.push({ label: 'Call (Smart)', value: smart, href: `tel:${smart.replace(/\s/g, '')}` });
  if (messenger) entries.push({ label: 'Messenger', value: `m.me/${messenger}`, href: `https://m.me/${encodeURIComponent(messenger)}` });
  if (viber) entries.push({ label: 'Viber', value: viber, href: `viber://chat?number=%2B${viber.replace(/\D/g, '')}` });
  $('contactEmpty').classList.toggle('hidden', entries.length > 0);
  entries.forEach(e => {
    const a = document.createElement('a');
    a.className = 'contact-btn';
    a.href = e.href;
    const strong = document.createElement('strong');
    strong.textContent = e.label;
    const span = document.createElement('span');
    span.textContent = e.value;
    a.appendChild(strong);
    a.appendChild(span);
    list.appendChild(a);
  });
}

function renderRules(v) {
  const list = $('rulesList');
  list.innerHTML = '';
  arr(v.sections).filter(sec => sec && typeof sec === 'object').forEach(sec => {
    const div = document.createElement('div');
    div.className = 'rules-sec';
    const h = document.createElement('h3');
    h.textContent = sec.title;
    div.appendChild(h);
    const ul = document.createElement('ul');
    arr(sec.items).forEach(item => {
      const li = document.createElement('li');
      setFmt(li, item);
      ul.appendChild(li);
    });
    div.appendChild(ul);
    list.appendChild(div);
  });
}
