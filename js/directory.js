const DATA_V = '20260703f';
const PAGE_SIZE = 60;

let allBusinesses = [];
let filtered = [];
let shown = 0;

document.getElementById('year').textContent = new Date().getFullYear();

fetch('data/businesses.json?d=' + DATA_V)
  .then((r) => r.json())
  .then((data) => {
    allBusinesses = data.businesses;
    document.getElementById('biz-count').textContent =
      allBusinesses.length.toLocaleString() + ' businesses';
    populateFilters();
    applyFilters();
  })
  .catch((err) => {
    console.error('Failed to load directory', err);
    document.getElementById('biz-list').innerHTML =
      '<p class="empty-state">Unable to load the directory right now.</p>';
  });

function populateFilters() {
  const catSel = document.getElementById('biz-category');
  const zipSel = document.getElementById('biz-zip');

  const cats = new Map();
  const zips = new Map();
  for (const b of allBusinesses) {
    for (const l of b.licenses) cats.set(l, (cats.get(l) || 0) + 1);
    if (b.zip) zips.set(b.zip, (zips.get(b.zip) || 0) + 1);
  }
  [...cats.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, n]) => {
      catSel.insertAdjacentHTML(
        'beforeend',
        `<option value="${escapeAttr(cat)}">${escapeHtml(cat)} (${n})</option>`
      );
    });
  [...zips.entries()]
    .sort()
    .forEach(([zip, n]) => {
      zipSel.insertAdjacentHTML(
        'beforeend',
        `<option value="${zip}">${zip} (${n})</option>`
      );
    });
}

['biz-search', 'biz-category', 'biz-zip'].forEach((id) => {
  document.getElementById(id).addEventListener('input', applyFilters);
});

document.getElementById('load-more').addEventListener('click', () => {
  renderChunk();
});

function applyFilters() {
  const q = document.getElementById('biz-search').value.trim().toLowerCase();
  const cat = document.getElementById('biz-category').value;
  const zip = document.getElementById('biz-zip').value;

  filtered = allBusinesses.filter((b) => {
    if (cat && !b.licenses.includes(cat)) return false;
    if (zip && b.zip !== zip) return false;
    if (q && !b.name.toLowerCase().includes(q) && !b.address.toLowerCase().includes(q))
      return false;
    return true;
  });

  document.getElementById('biz-list').innerHTML = '';
  shown = 0;
  document.getElementById('result-count').textContent =
    filtered.length.toLocaleString() + ' result' + (filtered.length === 1 ? '' : 's');
  document.getElementById('biz-empty').hidden = filtered.length > 0;
  renderChunk();
}

function renderChunk() {
  const list = document.getElementById('biz-list');
  const chunk = filtered.slice(shown, shown + PAGE_SIZE);
  list.insertAdjacentHTML('beforeend', chunk.map(renderBusiness).join(''));
  shown += chunk.length;
  document.getElementById('load-more').hidden = shown >= filtered.length;
}

function renderBusiness(b) {
  const mapsUrl =
    'https://www.google.com/maps/search/' +
    encodeURIComponent(`${b.address}, Chicago, IL ${b.zip}`);
  const webLink = b.website
    ? `<a href="${escapeAttr(b.website)}" target="_blank" rel="noopener">Website</a>`
    : `<a href="https://www.google.com/search?q=${encodeURIComponent(
        b.name + ' Chicago ' + b.address
      )}" target="_blank" rel="noopener">Find online</a>`;
  const phone = b.phone
    ? ` &middot; <a href="tel:${escapeAttr(b.phone)}">${escapeHtml(b.phone)}</a>`
    : '';
  const tags = b.licenses
    .slice(0, 3)
    .map((l) => `<span class="license-tag">${escapeHtml(l)}</span>`)
    .join('');
  return `
    <div class="biz-row">
      <div class="biz-main">
        <strong>${escapeHtml(b.name)}</strong>
        <span class="biz-tags">${tags}</span>
      </div>
      <div class="biz-detail">
        <a href="${mapsUrl}" target="_blank" rel="noopener">${escapeHtml(b.address)}</a>,
        ${b.zip}${phone} &middot; ${webLink}
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}
