// Tanawin Concierge — staff content editor (admin-only).
//
// Auth is Menu's: the same hidden GoTrue accounts (<slug>@tanawin.menu,
// password "tanawin-menu-v1:<PIN>") — one set of PINs across both apps
// because they share the Supabase project. RLS enforces admin-only writes
// on concierge_content; this UI only shows admins in the picker.

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);

let me = null;          // picked roster row
let content = {};       // key -> {value, last_reviewed}

// Local date string — never toISOString(), which shifts a day in UTC+8.
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toast(msg, isError) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', !!isError);
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2600);
}

// ---------- login ----------

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

$('logoutBtn').onclick = async () => {
  await db.auth.signOut();
  location.reload();
};

// ---------- editor ----------

async function showApp() {
  const { data, error } = await db.from('concierge_content').select('*');
  if (error) {
    toast('Could not load content — are you logged in as an admin?', true);
    return;
  }
  content = {};
  (data || []).forEach(row => { content[row.key] = row; });
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  buildEditor();
}

function val(key) { return (content[key] && content[key].value) || {}; }

async function save(key, value, opts = {}) {
  // Merge over the freshest copy of the row before writing. A save must never
  // erase fields this editor build doesn't know about — on 2026-08-05 a
  // stale-bundle editor saved getting_around without the (newer) marker field
  // and silently wiped the map circle. Explicit nulls still win (that's how
  // "Remove circle" deletes), only unknown fields are preserved.
  let base = val(key);
  const { data: fresh } = await db.from('concierge_content')
    .select('value').eq('key', key);
  if (fresh && fresh[0] && fresh[0].value) base = fresh[0].value;
  const payload = {
    key,
    value: { ...base, ...value },
    updated_at: new Date().toISOString(),
    updated_by: me ? me.slug : 'admin',
  };
  if (opts.markReviewed) payload.last_reviewed = todayLocal();
  const { error } = await db.from('concierge_content')
    .upsert(payload, { onConflict: 'key' });
  if (error) {
    toast(`Save failed: ${error.message}`, true);
    return false;
  }
  content[key] = { ...(content[key] || {}), ...payload };
  toast('Saved — guests see this immediately');
  return true;
}

async function markReviewed(key) {
  const { error } = await db.from('concierge_content')
    .update({ last_reviewed: todayLocal(), updated_by: me ? me.slug : 'admin' })
    .eq('key', key);
  if (error) return toast(`Failed: ${error.message}`, true);
  content[key].last_reviewed = todayLocal();
  toast('Marked reviewed today');
  buildEditor();
}

// -- tiny form helpers (everything is plain DOM, no framework) --

function field(labelText, inputEl) {
  const wrap = document.createElement('div');
  wrap.className = 'ed-field';
  const label = document.createElement('label');
  label.textContent = labelText;
  wrap.appendChild(label);
  wrap.appendChild(inputEl);
  return wrap;
}

function textInput(value, placeholder) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value || '';
  if (placeholder) input.placeholder = placeholder;
  return input;
}

function textArea(value) {
  const ta = document.createElement('textarea');
  ta.value = value || '';
  return ta;
}

function blockShell(title, key, hint) {
  const div = document.createElement('div');
  div.className = 'ed-block';
  const h = document.createElement('h2');
  h.textContent = title;
  div.appendChild(h);
  const rev = document.createElement('p');
  rev.className = 'ed-reviewed';
  const reviewed = content[key] && content[key].last_reviewed;
  rev.textContent = reviewed ? `Last reviewed ${reviewed}` : 'Not yet reviewed';
  div.appendChild(rev);
  if (hint) {
    const p = document.createElement('p');
    p.className = 'ed-reviewed';
    p.textContent = hint;
    div.appendChild(p);
  }
  return div;
}

function actions(div, key, onSave) {
  const bar = document.createElement('div');
  bar.className = 'ed-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-btn';
  saveBtn.textContent = 'Save';
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    await onSave();
    saveBtn.disabled = false;
  };
  const revBtn = document.createElement('button');
  revBtn.className = 'review-btn';
  revBtn.textContent = 'Mark reviewed today';
  revBtn.onclick = () => markReviewed(key);
  bar.appendChild(saveBtn);
  bar.appendChild(revBtn);
  div.appendChild(bar);
}

// Rows editor: a list of objects edited as one input per named column.
function rowsEditor(container, rows, columns, addLabel) {
  const state = rows.map(r => ({ ...r }));
  const listEl = document.createElement('div');
  container.appendChild(listEl);
  function draw() {
    listEl.innerHTML = '';
    state.forEach((row, i) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'ed-row';
      columns.forEach(col => {
        const input = textInput(row[col.key], col.placeholder);
        input.oninput = () => { row[col.key] = input.value; };
        rowEl.appendChild(input);
      });
      const del = document.createElement('button');
      del.className = 'row-del';
      del.textContent = '✕';
      del.onclick = () => { state.splice(i, 1); draw(); };
      rowEl.appendChild(del);
      listEl.appendChild(rowEl);
    });
  }
  draw();
  const add = document.createElement('button');
  add.className = 'ed-add';
  add.textContent = addLabel;
  add.onclick = () => { state.push({}); draw(); };
  container.appendChild(add);
  return () => state.filter(r => columns.some(c => (r[c.key] || '').trim()));
}

// ---------- the blocks ----------

function buildEditor() {
  const root = $('blocks');
  root.innerHTML = '';

  // Guest feedback — Google link config plus a read-only inbox of what guests
  // said. Not in the live request queue on purpose: feedback is read over
  // coffee, not chimed about. FIRST block on the page since 2026-08-24: Lexi
  // couldn't find it sitting above House rules, so it now opens the editor and
  // counts unread in the heading.
  {
    const key = 'feedback_config';
    const SEEN_KEY = 'concierge_fb_seen';   // newest feedback she's had on screen
    const div = blockShell('Guest feedback', key,
      'Happy guests (4-5 stars) get a "share on Google" button — once you save your Google Reviews link below. Everything guests write lands here either way, newest first.');
    const badge = document.createElement('span');
    badge.className = 'fb-badge hidden';
    div.querySelector('h2').appendChild(badge);
    const v = val(key);
    const gurl = textInput(v.google_url, 'Your Google Reviews link (https://g.page/r/…)');
    div.appendChild(field('Google Reviews link', gurl));
    actions(div, key, () => {
      const u = gurl.value.trim();
      if (u && !/^https:\/\//.test(u)) {
        toast('The link should start with https://', true);
        return;
      }
      return save(key, { google_url: u });
    });

    const archive = document.createElement('a');
    archive.className = 'fb-archive';
    archive.href = 'reviews.html';
    archive.textContent = 'See all reviews by month →';

    const inbox = document.createElement('div');
    inbox.className = 'fb-inbox';
    const loading = document.createElement('p');
    loading.className = 'ed-reviewed';
    loading.textContent = 'Loading feedback…';
    inbox.appendChild(loading);
    div.appendChild(inbox);
    db.from('concierge_feedback')
      .select('room_name, rating, enjoyed, improve, app_note, created_at')
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data, error }) => {
        inbox.innerHTML = '';
        if (error) return;
        if (!data || !data.length) {
          const p = document.createElement('p');
          p.className = 'ed-reviewed';
          p.textContent = 'No feedback yet.';
          inbox.appendChild(p);
          return;
        }
        // Every created_at comes from one source in one format, so a string
        // compare is safe here (and skips a timezone round-trip).
        const seen = localStorage.getItem(SEEN_KEY) || '';
        // Count on the server, not across these 30 rows: the badge should say
        // 34 when there are 34. The inbox is a window, not the table.
        //
        // No watermark yet means nothing has been read, so ask for the whole
        // count and send NO filter at all. Passing the empty string as a
        // timestamp is a PostgREST 400 (22007 invalid input syntax), which
        // fails silently into "no badge" — on the one open that matters most,
        // the very first one.
        let countQ = db.from('concierge_feedback')
          .select('id', { count: 'exact', head: true });
        if (seen) countQ = countQ.gt('created_at', seen);
        countQ
          .then(({ count, error }) => {
            if (error || !count) return;
            badge.textContent = `${count} new`;
            badge.classList.remove('hidden');
            // Only clear the count when every unread one was actually on this
            // page — beyond a screenful the rest live in the archive, and
            // marking them read on her behalf is how feedback goes unread.
            if (count > data.length) return;
            // And only once it's genuinely been seen: an editor opened and
            // closed in two seconds shouldn't clear it either.
            setTimeout(() => {
              if (!document.hidden) localStorage.setItem(SEEN_KEY, data[0].created_at);
            }, 4000);
          });
        data.forEach(f => {
          const row = document.createElement('div');
          row.className = 'fb-row';
          const head = document.createElement('div');
          head.className = 'fb-head';
          head.textContent = `${'★'.repeat(f.rating)}${'☆'.repeat(5 - f.rating)}  ${f.room_name} · ${new Date(f.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
          if (f.created_at > seen) {
            row.classList.add('fb-unread');
            const pill = document.createElement('span');
            pill.className = 'fb-pill';
            pill.textContent = 'New';
            head.appendChild(pill);
          }
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
          inbox.appendChild(row);
        });
      });
    div.appendChild(archive);
    root.appendChild(div);
  }

  // Welcome message — the first thing a guest reads. Sits above the
  // reorderable cards on the guest page and is not part of Section order.
  {
    const key = 'welcome';
    const div = blockShell('Welcome message', key,
      'The greeting at the very top of the guest page. Leave it blank to hide the card entirely.');
    const v = val(key);
    const msg = textArea(v.message);
    div.appendChild(field('Message', msg));
    actions(div, key, () => save(key, {
      // Not .trim(): that would strip an indent from the first line while
      // leaving it on the others. Drop leading blank lines and trailing
      // whitespace only, so indentation is hers to control.
      message: msg.value.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, ''),
    }));
    root.appendChild(div);
  }

  // Section order — how the guest page's cards are arranged. Arrows always
  // (reliable on phones); drag works on desktop as a bonus.
  {
    const key = 'layout';
    const NAMES = {
      wifi: 'Wifi',
      house_rules: 'House rules',
      pool_hours: 'Pool hours',
      getting_around: 'Getting around Sinagtala',
      key_info: 'Good to know',
      menu_card: '"Hungry?" card',
      contact: 'Contact the front desk',
    };
    const DEFAULT_ORDER = ['wifi', 'house_rules', 'pool_hours', 'getting_around',
      'key_info', 'menu_card', 'contact'];
    const div = blockShell('Section order', key,
      'Guests see the sections in this order (the round side buttons follow too). Move one with the arrows, then Save.');
    const v = val(key);
    let order = (Array.isArray(v.order) && v.order.length ? v.order : DEFAULT_ORDER)
      .filter(k => NAMES[k]);
    DEFAULT_ORDER.forEach(k => { if (!order.includes(k)) order.push(k); });

    const listEl = document.createElement('div');
    div.appendChild(listEl);
    let dragFrom = null;
    function drawOrder() {
      listEl.innerHTML = '';
      order.forEach((k, i) => {
        const row = document.createElement('div');
        row.className = 'order-row';
        row.draggable = true;
        row.ondragstart = () => { dragFrom = i; };
        row.ondragover = e => e.preventDefault();
        row.ondrop = e => {
          e.preventDefault();
          if (dragFrom === null || dragFrom === i) return;
          order.splice(i, 0, order.splice(dragFrom, 1)[0]);
          dragFrom = null;
          drawOrder();
        };
        const name = document.createElement('span');
        name.className = 'order-name';
        name.textContent = `${i + 1}. ${NAMES[k]}`;
        row.appendChild(name);
        const up = document.createElement('button');
        up.className = 'order-btn';
        up.textContent = '▲';
        up.disabled = i === 0;
        up.onclick = () => { order.splice(i - 1, 0, order.splice(i, 1)[0]); drawOrder(); };
        const down = document.createElement('button');
        down.className = 'order-btn';
        down.textContent = '▼';
        down.disabled = i === order.length - 1;
        down.onclick = () => { order.splice(i + 1, 0, order.splice(i, 1)[0]); drawOrder(); };
        row.appendChild(up);
        row.appendChild(down);
        listEl.appendChild(row);
      });
    }
    drawOrder();
    actions(div, key, () => save(key, { order }));
    root.appendChild(div);
  }

  // Wifi — up to two slots; only populated ones show to guests.
  {
    const key = 'wifi';
    const div = blockShell('Wifi', key,
      'Guests see every filled-in network, with a copy button and a scan-to-join QR. Leave a slot blank to hide it.');
    const v = val(key);
    const getRows = rowsEditor(div, (v.networks || []).concat([{}, {}]).slice(0, 2),
      [{ key: 'name', placeholder: 'Network name' }, { key: 'password', placeholder: 'Password' }],
      '+ Add network');
    actions(div, key, () => save(key, { networks: getRows() }));
    root.appendChild(div);
  }

  // Pool hours
  {
    const key = 'pool_hours';
    const div = blockShell('Pool hours (Sinagtala’s)', key,
      'These change without notice — guests see the reviewed date under this block.');
    const v = val(key);
    const intro = textArea(v.intro);
    div.appendChild(field('Intro note', intro));
    const getRows = rowsEditor(div, v.pools || [],
      [{ key: 'name', placeholder: 'Pool' }, { key: 'hours', placeholder: 'Hours' }, { key: 'location', placeholder: 'Location' }],
      '+ Add pool');
    const tip = textArea(v.tip);
    div.appendChild(field('Practical tip', tip));
    actions(div, key, () => save(key, { intro: intro.value.trim(), pools: getRows(), tip: tip.value.trim() }));
    root.appendChild(div);
  }

  // Getting around
  {
    const key = 'getting_around';
    const div = blockShell('Getting around Sinagtala', key,
      'Directions first, map underneath. Remember elevation — say uphill or downhill, not just minutes.');
    const v = val(key);
    const intro = textArea(v.intro);
    div.appendChild(field('Where Tanawin is', intro));
    const getRows = rowsEditor(div, v.directions || [],
      [{ key: 'place', placeholder: 'Place' }, { key: 'walk', placeholder: 'How to walk there (mention uphill/downhill)' }],
      '+ Add direction');

    // Swappable map image — uploads to the concierge-assets bucket, so a new
    // map needs no rebuild. The Tanawin circle is an overlay stored as
    // percentages: tap the picture to move it, so a new map just needs a
    // fresh tap, never image editing.
    // markerTouched: only include the circle in the save when Lexi actually
    // moved or removed it. An untouched save must OMIT the field so the
    // merge-on-save keeps whatever the DB has — an editor that happened to
    // load while the circle was missing must not re-delete it on every save
    // (that's how the circle vanished twice on 2026-08-05).
    let marker = v.marker ? { ...v.marker } : null;
    let markerTouched = false;
    const mapWrap = document.createElement('div');
    mapWrap.className = 'ed-field';
    const mapLabel = document.createElement('label');
    mapLabel.textContent = 'Map image (optional — replaces the old one)';
    mapWrap.appendChild(mapLabel);
    if (v.image_url) {
      const holder = document.createElement('div');
      holder.className = 'map-edit-holder';
      const img = document.createElement('img');
      img.className = 'map-preview';
      img.src = v.image_url;
      const ring = document.createElement('div');
      ring.className = 'map-marker hidden';
      const ringLabel = document.createElement('span');
      ringLabel.className = 'map-marker-label';
      ringLabel.textContent = 'Tanawin';
      ring.appendChild(ringLabel);
      holder.appendChild(img);
      holder.appendChild(ring);
      mapWrap.appendChild(holder);
      const drawRing = () => {
        if (marker && marker.x != null) {
          ring.style.left = marker.x + '%';
          ring.style.top = marker.y + '%';
          ring.style.width = (2 * (marker.rx || 6.5)) + '%';
          ring.style.height = (2 * (marker.ry || marker.rx || 6.5)) + '%';
          ring.classList.remove('hidden');
        } else {
          ring.classList.add('hidden');
        }
      };
      drawRing();
      img.style.cursor = 'crosshair';
      img.onclick = e => {
        markerTouched = true;
        const r = img.getBoundingClientRect();
        marker = {
          x: +(((e.clientX - r.left) / r.width) * 100).toFixed(1),
          y: +(((e.clientY - r.top) / r.height) * 100).toFixed(1),
          rx: (marker && marker.rx) || 6.6,
          ry: (marker && marker.ry) || 4.5,
        };
        drawRing();
      };
      const hint = document.createElement('p');
      hint.className = 'ed-reviewed';
      hint.textContent = 'Tap the picture to move the "Tanawin — you are here" circle (do this again after changing the map). Save to apply.';
      mapWrap.appendChild(hint);
      const clearBtn = document.createElement('button');
      clearBtn.className = 'review-btn';
      clearBtn.textContent = 'Remove circle';
      clearBtn.onclick = () => { markerTouched = true; marker = null; drawRing(); };
      mapWrap.appendChild(clearBtn);
    }
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/*';
    mapWrap.appendChild(file);
    div.appendChild(mapWrap);

    actions(div, key, async () => {
      let imageUrl = v.image_url || null;
      if (file.files && file.files[0]) {
        const f = file.files[0];
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `sinagtala-map.${ext}`;
        const { error } = await db.storage.from('concierge-assets')
          .upload(path, f, { upsert: true, contentType: f.type });
        if (error) return toast(`Map upload failed: ${error.message}`, true);
        imageUrl = `${ASSETS_BASE}/${path}?v=${Date.now()}`;
      }
      const payload = { intro: intro.value.trim(), directions: getRows(), image_url: imageUrl };
      if (markerTouched) payload.marker = marker;
      const ok = await save(key, payload);
      if (ok && file.files && file.files[0]) buildEditor();
    });
    root.appendChild(div);
  }

  // Good to know
  {
    const key = 'key_info';
    const div = blockShell('Good to know', key,
      'The quick facts guests actually ask about — staff hours, last call, breakfast, checkout.');
    const v = val(key);
    const getRows = rowsEditor(div, v.items || [],
      [{ key: 'label', placeholder: 'Label' }, { key: 'value', placeholder: 'Details' }],
      '+ Add item');
    actions(div, key, () => save(key, { items: getRows() }));
    root.appendChild(div);
  }

  // The "Hungry?" Menu card — its wording is editable; the link itself is not
  // (it always goes to the Menu app with the guest's room code attached).
  {
    const key = 'menu_card';
    const div = blockShell('"Hungry?" card (link to the Menu)', key,
      'The terracotta card that sends guests to the Tanawin Menu. Wording only — the link always carries the guest\'s room code.');
    const v = val(key);
    const title = textInput(v.title, 'Hungry?');
    const subtitle = textInput(v.subtitle, 'Order food to your room from the Tanawin Menu');
    div.appendChild(field('Big text', title));
    div.appendChild(field('Small text', subtitle));
    actions(div, key, () => save(key, { title: title.value.trim(), subtitle: subtitle.value.trim() }));
    root.appendChild(div);
  }

  // Request items (Phase 2) — what guests can pick on the Room Items screen.
  {
    const key = 'request_items';
    const div = blockShell('Request items (guest requests)', key,
      'What guests can ask for on the Room Items screen. Fill the second box only if they must specify something — e.g. "Which appliance?" — and a text box appears for them.');
    const v = val(key);
    const getRows = rowsEditor(div, (v.items || []).map(it => ({ label: it.label, note_prompt: it.note_prompt || '' })),
      [{ key: 'label', placeholder: 'Item' },
       { key: 'note_prompt', placeholder: 'If they must specify: ask what? (optional)' }],
      '+ Add item');
    actions(div, key, () => {
      const seen = new Set();
      return save(key, {
        items: getRows().map(r => {
          const label = (r.label || '').trim();
          const prompt = (r.note_prompt || '').trim();
          // stable-ish id from the label; existing ids preserved when unchanged
          const existing = (v.items || []).find(it => it.label === label);
          let id = existing ? existing.id
            : label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
          // duplicate labels must not collapse into one id
          let n = 2;
          const base = id;
          while (seen.has(id)) id = `${base}_${n++}`;
          seen.add(id);
          return {
            id,
            label,
            ...(prompt ? { needs_note: true, note_prompt: prompt } : {}),
          };
        }).filter(it => it.label),
      });
    });
    root.appendChild(div);
  }

  // Request hours (Phase 2) — drives the out-of-hours message and flag.
  {
    const key = 'request_config';
    const div = blockShell('Request hours', key,
      'When requests count as "after hours" — guests can still send them, but they see "staff are back at 7am". Use 24-hour times like 18:00.');
    const v = val(key);
    const open = textInput(v.open, 'e.g. 07:00');
    const lcWeek = textInput(v.last_call_weekday, 'e.g. 18:00');
    const lcWeekend = textInput(v.last_call_weekend, 'e.g. 20:00');
    div.appendChild(field('Staff start (every day)', open));
    div.appendChild(field('Last call — weekdays', lcWeek));
    div.appendChild(field('Last call — weekends', lcWeekend));
    actions(div, key, () => {
      const vals = [open.value.trim(), lcWeek.value.trim(), lcWeekend.value.trim()];
      if (vals.some(t => !/^([01]?\d|2[0-3]):[0-5]\d$/.test(t))) {
        toast('Times must look like 07:00 or 18:00 (24-hour)', true);
        return;
      }
      return save(key, {
        open: vals[0],
        last_call_weekday: vals[1],
        last_call_weekend: vals[2],
      });
    });
    root.appendChild(div);
  }

  // Contact
  {
    const key = 'contact';
    const div = blockShell('Contact the front desk', key,
      'Only filled-in entries show. Numbers as guests should dial them; Messenger is the m.me handle only.');
    const v = val(key);
    const globe = textInput(v.globe, 'Globe number');
    const smart = textInput(v.smart, 'Smart number');
    const messenger = textInput(v.messenger, 'Messenger handle (the part after m.me/)');
    const viber = textInput(v.viber, 'Viber number (with country code, e.g. 63917…)');
    div.appendChild(field('Globe', globe));
    div.appendChild(field('Smart', smart));
    div.appendChild(field('Messenger', messenger));
    div.appendChild(field('Viber', viber));
    actions(div, key, () => save(key, {
      globe: globe.value.trim(),
      smart: smart.value.trim(),
      messenger: messenger.value.trim().replace(/^.*m\.me\//, ''),
      viber: viber.value.trim(),
    }));
    root.appendChild(div);
  }

  // House rules
  {
    const key = 'house_rules';
    const div = blockShell('House rules', key,
      'Each section: a title, then one rule per line.');
    const v = val(key);
    const sections = (v.sections || []).map(s => ({ ...s }));
    const secWrap = document.createElement('div');
    div.appendChild(secWrap);
    function drawSections() {
      secWrap.innerHTML = '';
      sections.forEach((sec, i) => {
        const title = textInput(sec.title, 'Section title');
        title.oninput = () => { sec.title = title.value; };
        const items = textArea((sec.items || []).join('\n'));
        items.oninput = () => { sec.items = items.value.split('\n').map(s => s.trim()).filter(Boolean); };
        const rowEl = document.createElement('div');
        rowEl.className = 'ed-field';
        rowEl.appendChild(title);
        rowEl.appendChild(items);
        const del = document.createElement('button');
        del.className = 'row-del';
        del.textContent = 'Remove section';
        del.onclick = () => { sections.splice(i, 1); drawSections(); };
        rowEl.appendChild(del);
        secWrap.appendChild(rowEl);
      });
    }
    drawSections();
    const add = document.createElement('button');
    add.className = 'ed-add';
    add.textContent = '+ Add section';
    add.onclick = () => { sections.push({ title: '', items: [] }); drawSections(); };
    div.appendChild(add);
    actions(div, key, () => save(key, {
      sections: sections.filter(s => (s.title || '').trim() || (s.items || []).length),
    }));
    root.appendChild(div);
  }
}
