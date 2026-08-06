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
