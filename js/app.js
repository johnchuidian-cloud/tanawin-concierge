// Tanawin Concierge — guest app (Tanawin Info, Phase 1).
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
  return b ? { v: b.value || {}, reviewed: b.last_reviewed || null } : { v: {}, reviewed: null };
}

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

  applyOrder(block(c, 'layout').v);
}

// ---------- section order (Lexi-editable via the `layout` block) ----------

const CARD_FOR = {
  wifi: 'wifiCard',
  house_rules: 'rulesCard',
  pool_hours: 'poolCard',
  getting_around: 'mapCard',
  key_info: 'keyCard',
  menu_card: 'menuCard',
  contact: 'contactCard',
};
// Default: wifi first (the most-asked question), house rules second.
const DEFAULT_ORDER = ['wifi', 'house_rules', 'pool_hours', 'getting_around',
  'key_info', 'menu_card', 'contact'];

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

function renderWifi(v) {
  const nets = (v.networks || []).filter(n => n && n.name);
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
  (v.pools || []).forEach(p => {
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
    ? `As of ${b.reviewed} — please confirm at the front desk.`
    : '';
}

function renderMap(v) {
  setFmt($('mapIntro'), v.intro || '');
  const list = $('mapDirections');
  list.innerHTML = '';
  (v.directions || []).forEach(d => {
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
  if (v.image_url) {
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
  if (!marker || marker.x == null) {
    el.classList.add('hidden');
    return;
  }
  el.style.left = marker.x + '%';
  el.style.top = marker.y + '%';
  el.style.width = (2 * (marker.rx || 6.5)) + '%';
  el.style.height = (2 * (marker.ry || marker.rx || 6.5)) + '%';
  el.classList.remove('hidden');
}

function renderKeyInfo(v) {
  const list = $('keyList');
  list.innerHTML = '';
  (v.items || []).forEach(item => {
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
  if (v.globe) entries.push({ label: 'Call (Globe)', value: v.globe, href: `tel:${v.globe.replace(/\s/g, '')}` });
  if (v.smart) entries.push({ label: 'Call (Smart)', value: v.smart, href: `tel:${v.smart.replace(/\s/g, '')}` });
  if (v.messenger) entries.push({ label: 'Messenger', value: `m.me/${v.messenger}`, href: `https://m.me/${v.messenger}` });
  if (v.viber) entries.push({ label: 'Viber', value: v.viber, href: `viber://chat?number=%2B${v.viber.replace(/\D/g, '')}` });
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
  (v.sections || []).forEach(sec => {
    const div = document.createElement('div');
    div.className = 'rules-sec';
    const h = document.createElement('h3');
    h.textContent = sec.title;
    div.appendChild(h);
    const ul = document.createElement('ul');
    (sec.items || []).forEach(item => {
      const li = document.createElement('li');
      setFmt(li, item);
      ul.appendChild(li);
    });
    div.appendChild(ul);
    list.appendChild(div);
  });
}
