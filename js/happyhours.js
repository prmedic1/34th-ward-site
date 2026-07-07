const DATA_V = '20260703f';
const SHEET_CSV =
  'https://docs.google.com/spreadsheets/d/1mS4Z7yT5R5KXaj9sZWtRThiRQhJa0zkyYBG8Jwslubc/export?format=csv';
const PAGE = 40;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
let allDeals = [];
let wardArea = [];
let filtered = [];
let shown = 0;

document.getElementById('year').textContent = new Date().getFullYear();

// Prefer the live sheet; fall back to the saved snapshot if it's unreachable.
fetch(SHEET_CSV)
  .then((r) => {
    if (!r.ok) throw new Error('sheet ' + r.status);
    return r.text();
  })
  .then((csv) => {
    allDeals = parseCsv(csv);
    setStatus('Updated live from the neighborhood spreadsheet');
    init();
  })
  .catch(() => {
    fetch('data/happy_hours_sheet.json?d=' + DATA_V)
      .then((r) => r.json())
      .then((data) => {
        allDeals = data.deals;
        wardArea = data.ward_area || [];
        setStatus('Showing the latest saved snapshot');
        init();
      })
      .catch((err) => {
        console.error('Failed to load happy hours', err);
        document.getElementById('hh-list').innerHTML =
          '<p class="empty-state">Unable to load deals right now.</p>';
      });
  });

// Ward-area neighborhoods for the default filter (from the snapshot; hard-coded fallback)
fetch('data/happy_hours_sheet.json?d=' + DATA_V)
  .then((r) => r.json())
  .then((d) => { if (d.ward_area) wardArea = d.ward_area; })
  .catch(() => {});

function setStatus(msg) {
  document.getElementById('hh-status').textContent = msg;
}

function init() {
  document.getElementById('hh-count').textContent = allDeals.length;
  buildFilters();
  ['hh-search', 'hh-hood', 'hh-cuisine', 'hh-day'].forEach((id) =>
    document.getElementById(id).addEventListener('input', apply)
  );
  ['hh-now', 'hh-approved', 'hh-oysters', 'hh-patio'].forEach((id) =>
    document.getElementById(id).addEventListener('change', apply)
  );
  document.getElementById('hh-more').addEventListener('click', renderMore);
  apply();
}

function buildFilters() {
  const hoodSel = document.getElementById('hh-cuisine');
  const hoods = new Map();
  const cuisines = new Map();
  allDeals.forEach((d) => {
    (d.hood || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((h) =>
      hoods.set(h, (hoods.get(h) || 0) + 1)
    );
    (d.cuisine || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((c) =>
      cuisines.set(c, (cuisines.get(c) || 0) + 1)
    );
  });

  const hSel = document.getElementById('hh-hood');
  hSel.innerHTML =
    '<option value="__ward">West Loop &amp; downtown area</option><option value="">All Chicago neighborhoods</option>' +
    [...hoods.keys()].sort().map((h) => `<option value="${escapeAttr(h)}">${escapeHtml(h)}</option>`).join('');

  const cSel = document.getElementById('hh-cuisine');
  cSel.innerHTML =
    '<option value="">Any cuisine</option>' +
    [...cuisines.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `<option value="${escapeAttr(c)}">${escapeHtml(c)} (${n})</option>`).join('');
}

function apply() {
  const q = document.getElementById('hh-search').value.trim().toLowerCase();
  const hood = document.getElementById('hh-hood').value;
  const cuisine = document.getElementById('hh-cuisine').value;
  const day = document.getElementById('hh-day').value;
  const onNow = document.getElementById('hh-now').checked;
  const approved = document.getElementById('hh-approved').checked;
  const oysters = document.getElementById('hh-oysters').checked;
  const patio = document.getElementById('hh-patio').checked;
  const todayName = DAYS[new Date().getDay()];

  filtered = allDeals.filter((d) => {
    if (hood === '__ward') {
      if (!wardArea.some((w) => (d.hood || '').includes(w))) return false;
    } else if (hood && !(d.hood || '').includes(hood)) return false;
    if (cuisine && !(d.cuisine || '').includes(cuisine)) return false;
    if (approved && !d.approved) return false;
    if (oysters && !d.oysters) return false;
    if (patio && !isPatio(d)) return false;
    const days = d.days || [];
    if (day === 'today' && !days.includes(todayName)) return false;
    else if (day && day !== 'today' && !days.includes(day)) return false;
    if (onNow && !isOnNow(d)) return false;
    if (q) {
      const hay = `${d.name} ${d.deal} ${d.cuisine} ${d.hood}`.toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });

  // On-now deals float to the top
  filtered.sort((a, b) => (isOnNow(b) ? 1 : 0) - (isOnNow(a) ? 1 : 0) || (b.approved ? 1 : 0) - (a.approved ? 1 : 0));

  document.getElementById('hh-list').innerHTML = '';
  shown = 0;
  document.getElementById('hh-result-count').textContent =
    filtered.length.toLocaleString() + ' happy hour' + (filtered.length === 1 ? '' : 's');
  document.getElementById('hh-empty').hidden = filtered.length > 0;
  renderMore();
}

function renderMore() {
  const list = document.getElementById('hh-list');
  filtered.slice(shown, shown + PAGE).forEach((d) => list.insertAdjacentHTML('beforeend', renderDeal(d)));
  shown += Math.min(PAGE, filtered.length - shown);
  document.getElementById('hh-more').hidden = shown >= filtered.length;
}

function isPatio(d) {
  const p = (d.patio || '').toLowerCase();
  return p && p !== 'no' && p !== 'none';
}

function parseTime(t) {
  const m = (t || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h * 60 + parseInt(m[2], 10);
}

function isOnNow(d) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  if (!(d.days || []).includes(DAYS[now.getDay()])) return false;
  const s = parseTime(d.start);
  const e = parseTime(d.end);
  if (s == null || e == null) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  return e > s ? mins >= s && mins <= e : mins >= s || mins <= e;
}

function shortDays(days) {
  if (days.length === 7) return 'Every day';
  const abbr = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };
  const idx = days.map((d) => DAYS.indexOf(d)).filter((i) => i >= 0).sort((a, b) => a - b);
  let contiguous = idx.length > 1 && idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  if (contiguous) return `${abbr[DAYS[idx[0]]]}-${abbr[DAYS[idx[idx.length - 1]]]}`;
  return days.map((d) => abbr[d] || d).join(', ');
}

function renderDeal(d) {
  const now = isOnNow(d);
  const time = d.start && d.end ? `${d.start} - ${d.end}` : '';
  const badges = [];
  if (now) badges.push('<span class="hh-badge hh-now-badge">On now</span>');
  if (d.approved) badges.push('<span class="hh-badge hh-approved-badge">&#9733; Approved</span>');
  if (d.oysters) badges.push('<span class="hh-badge">Oysters</span>');
  if (isPatio(d)) badges.push('<span class="hh-badge">Patio</span>');
  const maps = 'https://www.google.com/maps/search/' + encodeURIComponent(`${d.name} ${d.hood} Chicago`);
  return `
    <article class="hh-item${now ? ' is-now' : ''}">
      <div class="hh-item-head">
        <h4>${escapeHtml(d.name)}</h4>
        <span class="hh-badges">${badges.join('')}</span>
      </div>
      <p class="hh-meta">${escapeHtml(d.hood)}${d.cuisine ? ' &middot; ' + escapeHtml(d.cuisine) : ''}</p>
      <p class="hh-when"><strong>${escapeHtml(shortDays(d.days))}</strong>${time ? ' &middot; ' + escapeHtml(time) : ''}</p>
      <p class="hh-deal">${escapeHtml(d.deal)}</p>
      <a class="hh-map" href="${maps}" target="_blank" rel="noopener">Map &amp; details &rarr;</a>
    </article>`;
}

// Minimal RFC-4180-ish CSV parser (handles quoted fields with commas/newlines)
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  const header = rows.shift().map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  const iName = idx('Restaurant'), iHood = idx('Location'), iDays = idx('Days'),
    iStart = idx('Start Time'), iEnd = idx('End Time'), iDeal = idx('Deal'),
    iOyster = idx('Oyster Deals'), iPatio = idx('Outside Dining'),
    iGf = idx('GF Safe Snacks'), iCuisine = idx('Cuisine'), iAppr = idx('Elizabeth Approved');

  return rows
    .filter((r) => (r[iName] || '').trim())
    .map((r) => ({
      name: (r[iName] || '').trim(),
      hood: (r[iHood] || '').trim(),
      days: (r[iDays] || '').split(',').map((s) => s.trim()).filter(Boolean),
      start: (r[iStart] || '').trim(),
      end: (r[iEnd] || '').trim(),
      deal: (r[iDeal] || '').trim(),
      oysters: !!(r[iOyster] || '').trim(),
      patio: (r[iPatio] || '').trim(),
      gf: (r[iGf] || '').trim(),
      cuisine: (r[iCuisine] || '').trim(),
      approved: !!(r[iAppr] || '').trim()
    }));
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}
function escapeAttr(str) {
  return String(str == null ? '' : str).replace(/"/g, '&quot;');
}
