const DATA_V = '20260703f';

document.getElementById('year').textContent = new Date().getFullYear();

const params = new URLSearchParams(window.location.search);
const SID = params.get('s') || 'politico';

Promise.all([
  fetch('data/news_sources.json?d=' + DATA_V).then((r) => r.json()),
  fetch('data/feed.json?d=' + DATA_V).then((r) => r.json())
])
  .then(([srcData, feedData]) => {
    const src = srcData.sources.find((s) => s.id === SID) || srcData.sources[0];
    document.title = `${src.name} | The Official 34th Ward Neighborhood Page`;

    const logo = src.logo
      ? `<img class="np-logo big" src="${escapeAttr(src.logo)}" alt="${escapeAttr(src.name)} logo" onerror="this.remove()">`
      : `<span class="np-monogram big">${escapeHtml(src.monogram || src.name.charAt(0))}</span>`;
    const editor = src.editor_image
      ? `<img class="np-editor big" src="${escapeAttr(src.editor_image)}" alt="${escapeAttr(src.editor)}" onerror="this.remove()">`
      : '';
    document.getElementById('section-masthead').innerHTML = `
      ${logo}
      <div class="np-masthead-text">
        <h2>${escapeHtml(src.name)}</h2>
        <p class="np-editor-name">Edited by ${escapeHtml(src.editor)}</p>
        <p class="np-desc">${escapeHtml(src.description)}</p>
        <a href="${escapeAttr(src.site)}" target="_blank" rel="noopener" class="read-more">Visit ${escapeHtml(src.name)} &rarr;</a>
      </div>
      ${editor}`;

    const items = feedData.items
      .filter((it) => it.source_id === SID && !it.flagged_for_review)
      .sort((a, b) => new Date(b.published_at) - new Date(a.published_at));

    document.getElementById('section-empty').hidden = items.length > 0;
    document.getElementById('section-list').innerHTML = items
      .map((it) => {
        const date = new Date(it.published_at).toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric'
        });
        const img = it.image
          ? `<img class="np-list-img" src="${escapeAttr(it.image)}" alt="" onerror="this.remove()">`
          : '';
        return `
          <article class="np-list-story">
            ${img}
            <div class="np-list-body">
              <h4>${escapeHtml(it.title)}</h4>
              <p class="np-summary">${escapeHtml(it.summary)}</p>
              <p class="np-dateline">${date} &middot; <a href="${escapeAttr(it.url)}" target="_blank" rel="noopener">Read original &rarr;</a></p>
            </div>
          </article>`;
      })
      .join('');
  })
  .catch((err) => {
    console.error('Failed to load section', err);
    document.getElementById('section-list').innerHTML =
      '<p class="empty-state">Unable to load this section right now.</p>';
  });

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}
