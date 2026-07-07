const DATA_V = '20260707a';

document.getElementById('year').textContent = new Date().getFullYear();

fetch('data/mayor_race.json?d=' + DATA_V)
  .then((r) => r.json())
  .then((data) => {
    document.getElementById('race-date').textContent = data.election_date;
    document.getElementById('race-updated').textContent = new Date(data.updated_at)
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const statusLabel = { declared: 'Declared', rumored: 'Rumored', incumbent: 'Incumbent' };
    const sorted = [...data.candidates].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    document.getElementById('race-strip').innerHTML = sorted
      .map((c) => {
        const img = c.image
          ? `<img src="${escapeAttr(c.image)}" alt="${escapeAttr(c.name)}" loading="lazy" onerror="this.outerHTML='<span class=\\'race-avatar\\'>${c.name.charAt(0)}</span>'">`
          : `<span class="race-avatar">${escapeHtml(c.name.charAt(0))}</span>`;
        const pct = c.kalshi_pct != null
          ? `<span class="race-pct">${c.kalshi_pct}%</span>`
          : `<span class="race-pct race-pct-none">no market<br>yet</span>`;
        const badge = c.badge
          ? `<span class="race-badge race-badge-${c.badgeColor}">${escapeHtml(c.badge)}</span>`
          : '';
        const badgeClass = c.badgeColor ? ` badge-${c.badgeColor}` : '';
        return `
          <div class="race-card${badgeClass}">
            ${badge}
            ${img}
            ${pct}
            <strong>${escapeHtml(c.name)}</strong>
            <span class="race-role">${escapeHtml(c.role)}</span>
            <span class="race-status race-status-${c.status}">${statusLabel[c.status] || c.status}</span>
          </div>`;
      })
      .join('');
    document.getElementById('mayor-race').hidden = false;
  })
  .catch((err) => console.error('Failed to load mayor race', err));

fetch('data/spotlight.json?d=' + DATA_V)
  .then((r) => r.json())
  .then((data) => {
    const s = data.current;
    if (!s || !s.name) return;
    const simg = document.getElementById('spotlight-img');
    if (s.image) {
      simg.src = s.image;
      simg.onerror = () => { simg.style.display = 'none'; };
    } else {
      simg.style.display = 'none';
    }
    document.getElementById('spotlight-name').textContent = s.name;
    document.getElementById('spotlight-address').textContent = s.address;
    document.getElementById('spotlight-blurb').textContent = s.blurb;
    document.getElementById('spotlight-link').href = s.website;
    document.getElementById('spotlight').hidden = false;
  })
  .catch((err) => console.error('Failed to load spotlight', err));

// The Front Page: six stories, one per source, newspaper style
const FRONT_ORDER = ['axios', 'politico', 'skyline', 'conway', 'wca', 'igwl'];

Promise.all([
  fetch('data/news_sources.json?d=' + DATA_V).then((r) => r.json()),
  fetch('data/feed.json?d=' + DATA_V).then((r) => r.json())
])
  .then(([srcData, feedData]) => {
    const sources = Object.fromEntries(srcData.sources.map((s) => [s.id, s]));
    const items = feedData.items.sort(
      (a, b) => new Date(b.published_at) - new Date(a.published_at)
    );
    document.getElementById('last-updated-time').textContent = new Date(
      feedData.generated_at
    ).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

    const grid = document.getElementById('frontpage-grid');
    grid.innerHTML = FRONT_ORDER.map((sid) => {
      const src = sources[sid];
      const story = items.find((it) => it.source_id === sid && !it.flagged_for_review && !it.front_exclude);
      if (!src || !story) return '';
      return renderFrontStory(src, story, items.filter((it) => it.source_id === sid).length);
    }).join('');
  })
  .catch((err) => {
    console.error('Failed to load front page', err);
    document.getElementById('frontpage-grid').innerHTML =
      '<p class="empty-state">Unable to load updates right now.</p>';
  });

function sourceMasthead(src, small) {
  const logo = src.logo
    ? `<img class="np-logo" src="${escapeAttr(src.logo)}" alt="${escapeAttr(src.name)} logo" onerror="this.remove()">`
    : `<span class="np-monogram">${escapeHtml(src.monogram || src.name.charAt(0))}</span>`;
  const editor = src.editor_image
    ? `<img class="np-editor" src="${escapeAttr(src.editor_image)}" alt="${escapeAttr(src.editor)}" onerror="this.remove()">`
    : '';
  return `
    <div class="np-masthead${small ? ' small' : ''}">
      ${logo}
      <div class="np-masthead-text">
        <span class="np-source-name">${escapeHtml(src.name)}</span>
        <span class="np-editor-name">${escapeHtml(src.editor)}</span>
      </div>
      ${editor}
    </div>`;
}

function renderFrontStory(src, story, count) {
  const date = new Date(story.published_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
  const img = story.image
    ? `<img class="np-story-img" src="${escapeAttr(story.image)}" alt="" onerror="this.remove()">`
    : '';
  const more = count > 1
    ? `<a class="np-more" href="source.html?s=${src.id}">More from ${escapeHtml(src.name)} (${count}) &rarr;</a>`
    : `<a class="np-more" href="source.html?s=${src.id}">Section page &rarr;</a>`;
  return `
    <article class="np-story">
      ${sourceMasthead(src)}
      ${img}
      <h4><a href="source.html?s=${src.id}">${escapeHtml(story.title)}</a></h4>
      <p class="np-summary">${escapeHtml(story.summary)}</p>
      <p class="np-dateline">${date} &middot; <a href="${escapeAttr(story.url)}" target="_blank" rel="noopener">Read original &rarr;</a></p>
      ${more}
    </article>`;
}

const signupForm = document.getElementById('signup-form');
if (signupForm) {
  signupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('signup-email').value.trim();
    const wants = [
      document.getElementById('opt-daily').checked ? 'Daily breaking news' : null,
      document.getElementById('opt-weekly').checked ? 'Weekly events digest' : null
    ].filter(Boolean).join(' + ') || 'Daily breaking news';
    const subject = encodeURIComponent('Sign me up for the 34thward.com email');
    const body = encodeURIComponent(
      `Please add me to the list.\n\nEmail: ${email}\nSubscriptions: ${wants}`
    );
    window.location.href = `mailto:chicagojustice@gmail.com?subject=${subject}&body=${body}`;
    document.getElementById('signup-confirm').hidden = false;
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}
