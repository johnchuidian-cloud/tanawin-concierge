// Tanawin Concierge — guest reviews, by month (admin-only).
//
// The editor's inbox shows the newest few; this is the archive behind it.
// Two rules shape the whole file:
//   1. Counts come from concierge_feedback_months() — one row per month,
//      aggregated in SQL. Never "select everything and count in JS": that is
//      the shape that silently truncates once the table outgrows PostgREST's
//      row cap, and then quietly reports a wrong total.
//   2. A month's own reviews are paged with .range(). A month can hold more
//      than one screenful, and a page that stops early without saying so is
//      worse than one that makes you tap.

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);

const PAGE = 50;
let months = [];
let current = null;   // {month, n, ...} being read
let offset = 0;

function toast(msg, isError) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', !!isError);
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2600);
}

function monthLabel(m) {
  // 'YYYY-MM' -> 'August 2026'. Day 1 at noon: no timezone can drag noon
  // into a different month the way midnight can.
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1, 12).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
}

// PH is UTC+8 year-round (no DST), so a fixed offset is both correct and
// simpler than any Date arithmetic — and it matches how the SQL side cuts
// the months.
function monthRange(m) {
  const [y, mo] = m.split('-').map(Number);
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  return { from: `${m}-01T00:00:00+08:00`, to: `${next}-01T00:00:00+08:00` };
}

function stars(n) { return '★'.repeat(n) + '☆'.repeat(5 - n); }

(async function boot() {
  $('hubBtn').href = HUB_URL;
  const { data: { session } } = await db.auth.getSession();
  // No session at all: this page has no login of its own on purpose — one
  // place to sign in, and it's the editor.
  if (!session) { location.replace('staff.html'); return; }

  const { data, error } = await db.rpc('concierge_feedback_months');
  if (error) {
    $('monthsList').innerHTML = '';
    toast('Could not load reviews.', true);
    return;
  }
  months = data || [];
  renderMonths();
})();

function renderMonths() {
  const list = $('monthsList');
  list.innerHTML = '';
  if (!months.length) {
    const p = document.createElement('p');
    p.className = 'ed-reviewed';
    // Zero rows is also what a non-admin sees — the RPC gates inside the
    // query — so the wording has to fit both without implying a fault.
    p.textContent = 'No reviews to show yet.';
    list.appendChild(p);
    return;
  }
  months.forEach(m => {
    const row = document.createElement('button');
    row.className = 'month-row';
    const left = document.createElement('span');
    left.className = 'month-name';
    left.textContent = monthLabel(m.month);
    const right = document.createElement('span');
    right.className = 'month-stat';
    right.textContent = `${m.n} review${m.n === 1 ? '' : 's'} · ★ ${Number(m.avg_rating).toFixed(1)}`;
    row.appendChild(left);
    row.appendChild(right);
    row.appendChild(barFor(m));
    row.onclick = () => openMonth(m);
    list.appendChild(row);
  });
}

// Five stacked slivers, widest rating first — enough to see "mostly fives"
// at a glance without reading a number.
function barFor(m) {
  const bar = document.createElement('span');
  bar.className = 'month-bar';
  const total = m.n || 1;
  [5, 4, 3, 2, 1].forEach(star => {
    const n = m[`s${star}`] || 0;
    if (!n) return;
    const seg = document.createElement('span');
    seg.className = `month-seg seg-${star}`;
    seg.style.width = `${(n / total) * 100}%`;
    seg.title = `${n} × ${star} star`;
    bar.appendChild(seg);
  });
  return bar;
}

async function openMonth(m) {
  current = m;
  offset = 0;
  $('monthsView').classList.add('hidden');
  $('monthView').classList.remove('hidden');
  $('monthTitle').textContent = monthLabel(m.month);
  $('monthRows').innerHTML = '';
  $('monthSummary').textContent = `${m.n} review${m.n === 1 ? '' : 's'} · average ★ ${Number(m.avg_rating).toFixed(1)}`;
  window.scrollTo(0, 0);
  await loadPage();
}

$('backBtn').onclick = () => {
  $('monthView').classList.add('hidden');
  $('monthsView').classList.remove('hidden');
  window.scrollTo(0, 0);
};

async function loadPage() {
  const btn = $('moreBtn');
  btn.disabled = true;
  const { from, to } = monthRange(current.month);
  const { data, error } = await db.from('concierge_feedback')
    .select('room_name, rating, enjoyed, improve, app_note, created_at')
    .gte('created_at', from)
    .lt('created_at', to)
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE - 1);
  btn.disabled = false;
  if (error) { toast('Could not load that month.', true); return; }
  (data || []).forEach(addRow);
  offset += (data || []).length;
  // The month's true total came from SQL, so "showing 50 of 120" is a fact
  // rather than a guess at what didn't load.
  const done = offset >= current.n || !data || !data.length;
  btn.classList.toggle('hidden', done);
  $('monthSummary').textContent = done
    ? `${current.n} review${current.n === 1 ? '' : 's'} · average ★ ${Number(current.avg_rating).toFixed(1)}`
    : `Showing ${offset} of ${current.n} · average ★ ${Number(current.avg_rating).toFixed(1)}`;
}

$('moreBtn').onclick = loadPage;

function addRow(f) {
  const row = document.createElement('div');
  row.className = 'fb-row';
  const head = document.createElement('div');
  head.className = 'fb-head';
  head.textContent = `${stars(f.rating)}  ${f.room_name} · ${new Date(f.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}`;
  row.appendChild(head);
  [['Enjoyed', f.enjoyed], ['Improve', f.improve], ['About the app', f.app_note]].forEach(([label, text]) => {
    if (!text) return;
    const p = document.createElement('p');
    p.className = 'fb-text';
    const b = document.createElement('strong');
    b.textContent = label + ': ';
    p.appendChild(b);
    p.appendChild(document.createTextNode(text));
    row.appendChild(p);
  });
  $('monthRows').appendChild(row);
}
