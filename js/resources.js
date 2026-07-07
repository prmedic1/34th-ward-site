const DATA_V = '20260703f';
let allResources = [];
let activeCategory = '';

document.getElementById('year').textContent = new Date().getFullYear();

fetch('data/resources.json?d=' + DATA_V)
  .then((r) => r.json())
  .then((data) => {
    allResources = data.resources;
    const chipRow = document.getElementById('resource-chips');
    chipRow.innerHTML =
      '<button class="chip active" data-cat="">All</button>' +
      data.categories
        .map((c) => `<button class="chip" data-cat="${escapeAttr(c)}">${escapeHtml(c)}</button>`)
        .join('');
    chipRow.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        chipRow.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        activeCategory = chip.dataset.cat;
        render();
      });
    });
    render();
  })
  .catch((err) => {
    console.error('Failed to load resources', err);
    document.getElementById('resource-grid').innerHTML =
      '<p class="empty-state">Unable to load resources right now.</p>';
  });

document.getElementById('resource-search').addEventListener('input', render);

function render() {
  const q = document.getElementById('resource-search').value.trim().toLowerCase();
  const matches = allResources.filter((r) => {
    if (activeCategory && r.category !== activeCategory) return false;
    if (!q) return true;
    const haystack = `${r.title} ${r.keywords} ${r.body} ${r.category}`.toLowerCase();
    return q.split(/\s+/).every((word) => haystack.includes(word));
  });

  document.getElementById('resource-grid').innerHTML = matches.map(renderResource).join('');
  document.getElementById('resource-empty').hidden = matches.length > 0;
}

function renderResource(r) {
  const links = r.links
    .map(
      (l) =>
        `<a class="read-more" href="${escapeAttr(l.url)}"${
          l.url.startsWith('http') ? ' target="_blank" rel="noopener"' : ''
        }>${escapeHtml(l.label)} &rarr;</a>`
    )
    .join('<br>');
  return `
    <article class="card">
      <div class="card-meta"><span class="category-tag">${escapeHtml(r.category)}</span></div>
      <h4>${escapeHtml(r.title)}</h4>
      <p class="summary">${escapeHtml(r.body)}</p>
      ${links}
    </article>
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
