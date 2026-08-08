// Tanawin Concierge — Room Cards (staff-side poster printer, handoff §8).
//
// Auth is Menu's GoTrue, same as the editor. An authenticated staff session
// can read rooms (incl. codes) and the wifi content; the poster composes a
// WIFI: QR + the room's ?code= deep-link QR, printed via the browser's print
// dialog at exact 11x8.5in. This is what makes code rotation routine: change
// a code, print a fresh card, swap the paper.

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);

let me = null;
let rooms = [];
let networks = [];
let chosenNet = 0;
let currentRoom = null;

function toast(msg, isError) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', !!isError);
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2600);
}

// ---------- login (mirrors staff.js) ----------

(async function boot() {
  $('hubBtn').href = HUB_URL;
  const { data: { session } } = await db.auth.getSession();
  if (session) return showApp();
  const { data: roster } = await db.from('staff')
    .select('slug, name, role')
    .eq('is_active', true)
    .eq('role', 'admin')
    .order('sort_order');
  const picker = $('loginPicker');
  (roster || []).forEach(u => {
    const btn = document.createElement('button');
    btn.className = 'picker-btn';
    btn.textContent = u.name;
    btn.onclick = () => pickUser(u);
    picker.appendChild(btn);
  });
  $('login').classList.remove('hidden');
})();

function pickUser(u) {
  me = u;
  $('loginPicker').classList.toggle('hidden', !!u);
  $('loginPinWrap').classList.toggle('hidden', !u);
  if (u) {
    $('loginWho').textContent = `Hi ${u.name} — enter your PIN`;
    $('loginPin').value = '';
    $('loginPin').focus();
  }
}

$('pickSomeoneElse').onclick = () => pickUser(null);

$('loginPin').oninput = async e => {
  const pin = e.target.value.replace(/\D/g, '').slice(0, 4);
  e.target.value = pin;
  $('loginError').classList.add('hidden');
  if (pin.length !== 4 || !me) return;
  const { error } = await db.auth.signInWithPassword({
    email: `${me.slug}@tanawin.menu`,
    password: `tanawin-menu-v1:${pin}`,
  });
  if (error) {
    $('loginPin').value = '';
    $('loginError').textContent = 'PIN incorrect — try again';
    $('loginError').classList.remove('hidden');
    return;
  }
  showApp();
};

// ---------- the cards page ----------

async function showApp() {
  const [roomsRes, wifiRes] = await Promise.all([
    db.from('rooms').select('name, code, kind').eq('is_active', true).order('name'),
    db.from('concierge_content').select('value').eq('key', 'wifi'),
  ]);
  if (roomsRes.error || wifiRes.error) {
    toast('Could not load rooms — are you logged in?', true);
    return;
  }
  rooms = roomsRes.data || [];
  const wifiVal = (wifiRes.data && wifiRes.data[0] && wifiRes.data[0].value) || {};
  networks = (Array.isArray(wifiVal.networks) ? wifiVal.networks : [])
    .filter(n => n && n.name && n.password);
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  buildNetChoice();
  buildRoomList();
}

function buildNetChoice() {
  const wrap = $('netChoice');
  wrap.innerHTML = '';
  if (!networks.length) {
    const p = document.createElement('span');
    p.className = 'muted';
    p.textContent = 'No wifi saved yet — cards will print with the app QR only.';
    wrap.appendChild(p);
    return;
  }
  networks.forEach((n, i) => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (i === chosenNet ? ' selected' : '');
    chip.textContent = n.name;
    chip.onclick = () => {
      chosenNet = i;
      wrap.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      if (currentRoom) showPoster(currentRoom);  // live-refresh the preview
    };
    wrap.appendChild(chip);
  });
}

function buildRoomList() {
  const list = $('roomList');
  list.innerHTML = '';
  rooms.forEach(room => {
    const row = document.createElement('div');
    row.className = 'room-row';
    const left = document.createElement('div');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = room.name;
    left.appendChild(name);
    if (room.kind === 'dining') {
      const kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = 'dining';
      left.appendChild(kind);
    }
    const btn = document.createElement('button');
    btn.className = 'print-btn';
    btn.textContent = 'Make card';
    btn.onclick = () => showPoster(room);
    row.appendChild(left);
    row.appendChild(btn);
    list.appendChild(row);
  });
}

const escWifi = s => String(s).replace(/([\\;,:"])/g, '\\$1');

function qrSvg(data) {
  const qr = qrcode(0, 'M');
  qr.addData(data);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

function showPoster(room) {
  currentRoom = room;
  const net = networks[chosenNet];
  const area = $('printArea');
  area.innerHTML = '';

  const poster = document.createElement('div');
  poster.className = 'poster';

  const band = document.createElement('div');
  band.className = 'band';
  band.innerHTML = '<div class="word">Tanaw<span class="i">&#305;<span class="fl">&#10040;</span></span>n</div>';
  const proom = document.createElement('div');
  proom.className = 'proom';
  proom.textContent = room.name;
  band.appendChild(proom);
  poster.appendChild(band);

  const panels = document.createElement('div');
  panels.className = 'panels';

  const panel = (title, svg, caption) => {
    const p = document.createElement('div');
    p.className = 'panel';
    const h = document.createElement('h2');
    h.textContent = title;
    p.appendChild(h);
    const holder = document.createElement('div');
    holder.innerHTML = svg;  // qrcode-generator output only — our own SVG
    p.appendChild(holder.firstElementChild);
    const cap = document.createElement('p');
    cap.append(...caption);
    p.appendChild(cap);
    return p;
  };

  if (net) {
    const strong = document.createElement('strong');
    strong.textContent = net.name;
    panels.appendChild(panel('📶 Join our wifi',
      qrSvg(`WIFI:T:WPA;S:${escWifi(net.name)};P:${escWifi(net.password)};;`),
      ['Point your phone camera here and tap the prompt — it connects you to ', strong, ', no typing.']));
  }
  panels.appendChild(panel('🛎 Guest services',
    qrSvg(`https://tanawin-concierge.tanawinbnb.workers.dev/?code=${room.code}`),
    ['Scan for the guest app: wifi details, pool hours, the map, house info — plus food orders and room requests straight from your phone.']));
  poster.appendChild(panels);

  const foot = document.createElement('div');
  foot.className = 'pfoot';
  foot.textContent = 'Tanawin Bed & Breakfast · Sinagtala, Brgy Tala, Orani, Bataan — the front desk is happy to help';
  poster.appendChild(foot);

  area.appendChild(poster);
  $('previewWrap').classList.add('active');
  $('previewWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('printBtn').onclick = () => window.print();
