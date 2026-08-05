const DATA_V = '20260805c';

document.getElementById('year').textContent = new Date().getFullYear();

fetch('data/mayor_race.json?d=' + DATA_V)
  .then((r) => r.json())
  .then((data) => {
    document.getElementById('race-date').textContent = data.election_date;
    document.getElementById('race-updated').textContent = new Date(data.updated_at)
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const statusLabel = { declared: 'Declared', rumored: 'Rumored', incumbent: 'Incumbent' };
    const sorted = [...data.candidates].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
    document.getElementById('race-strip').innerHTML = sorted
      .map((c) => {
        const img = c.image
          ? `<img src="${escapeAttr(c.image)}" alt="${escapeAttr(c.name)}" loading="lazy" onerror="this.outerHTML='<span class=\\'race-avatar\\'>${c.name.charAt(0)}</span>'">`
          : `<span class="race-avatar">${escapeHtml(c.name.charAt(0))}</span>`;
        const pct = `<span class="race-pct">${c.pct != null ? c.pct : c.kalshi_pct}%</span>`;
        const badge = c.badge
          ? `<span class="race-badge race-badge-${c.badgeColor}">${escapeHtml(c.badge)}</span>`
          : '';
        const badgeClass = c.badgeColor ? ` badge-${c.badgeColor}` : '';
        const inner = `
            ${badge}
            ${img}
            ${pct}
            <strong>${escapeHtml(c.name)}</strong>
            <span class="race-role">${escapeHtml(c.role)}</span>
            <span class="race-status race-status-${c.status}">${statusLabel[c.status] || c.status}</span>`;
        // Link the card to the candidate's campaign or official political site.
        return c.campaign_url
          ? `<a class="race-card${badgeClass}" href="${escapeAttr(c.campaign_url)}" target="_blank" rel="noopener" title="${escapeAttr(c.name)} website">${inner}</a>`
          : `<div class="race-card${badgeClass}">${inner}</div>`;
      })
      .join('');

    // "Predict the winner" button linking to the Kalshi market.
    if (data.kalshi_url) {
      const header = document.querySelector('.race-header');
      if (header && !header.querySelector('.race-kalshi-btn')) {
        header.insertAdjacentHTML('beforeend',
          `<a class="race-kalshi-btn" href="${escapeAttr(data.kalshi_url)}" target="_blank" rel="noopener">Predict the winner &rarr;</a>`);
      }
    }
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

// Pinned Top Story (data/featured.json): the single most interesting thing in
// the ward right now. Swap it any time by editing that file.
fetch('data/featured.json?d=' + DATA_V)
  .then((r) => r.json())
  .then((data) => {
    if (data && data.current) {
      document.getElementById('top-story').innerHTML = renderTopStory(data.current);
    }
    // "What Happened Recently" = the previous Top Story (the last big story in
    // the neighborhood), not a repeat of the front page.
    const prev = data && Array.isArray(data.history) && data.history[0];
    if (prev) {
      document.getElementById('recent-banner').hidden = false;
      document.getElementById('recent-grid').innerHTML = renderTopStory(prev);
    }
  })
  .catch((err) => console.error('Failed to load top story', err));

// The Front Page: six stories, newspaper style. One story per source first
// (for variety), then backfill from productive sources so it always fills six.
const FRONT_ORDER = ['blockclub', 'wlco', 'wca', 'axios', 'politico', 'conway', 'igwl', 'wardwatch', 'eater', 'cbs', 'abc7'];
const FRONT_COUNT = 6;

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

    // Lead each source with its FRESHEST story; ward-relevance only breaks
    // ties among stories from the last two days, so the page always feels
    // current instead of surfacing an old-but-local story.
    const wardKw = /west loop|greektown|fulton market|fulton river|printers row|south loop|near west side|little italy|taylor street|\bthe loop\b|34th ward|randolph|w\.? madison|halsted|west town|wacker|willis tower|union station/i;
    // Citywide issues that affect every Chicago resident, used as the fallback
    // when a source has nothing directly about the ward.
    const residentKw = /\bschools?\b|\bcps\b|chicago public schools|\bcrime\b|\bpolice\b|shooting|public safety|\btax(es|ed)?\b|property tax|\bbudget\b|\bpension\b|\bcta\b|\btransit\b|\bmigrant|\brent\b|\bhousing\b|city council|ordinance|\bcomed\b|utilit/i;
    const publishable = (it) => !it.flagged_for_review && !it.front_exclude;
    const countFor = (sid) => items.filter((it) => it.source_id === sid).length;
    const twoDaysAgo = Date.now() - 2 * 24 * 3600 * 1000;
    const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const score = (it) => {
      const t = it.title + ' ' + (it.summary || '');
      const ts = new Date(it.published_at).getTime();
      // Freshness is the gate so the front page is always today's news, not an
      // old but on-topic story. Among recent items, West Loop relevance leads
      // and a citywide resident-impact story (schools, crime, taxes) is the
      // fallback.
      const fresh = ts >= twoDaysAgo ? 6 : ts >= sevenDaysAgo ? 2 : 0;
      const ward = wardKw.test(t) ? 2 : 0;
      const resident = residentKw.test(t) ? 1 : 0;
      return fresh + ward + resident;
    };
    const bestOf = (list) => list.slice().sort((a, b) =>
      (score(b) - score(a)) || (new Date(b.published_at) - new Date(a.published_at)))[0];
    const used = new Set();
    const picks = [];
    const isFresh = (it) => new Date(it.published_at).getTime() >= sevenDaysAgo;

    // Pass 1: the best RECENT story from each source, for variety. Sources with
    // nothing from the last week are skipped so the page never shows a stale
    // (or leftover placeholder) story just to represent a quiet source.
    FRONT_ORDER.forEach((sid) => {
      if (picks.length >= FRONT_COUNT) return;
      const src = sources[sid];
      const eligible = items.filter((it) => it.source_id === sid && publishable(it) && !used.has(it.id) && isFresh(it));
      if (!src || !eligible.length) return;
      const story = bestOf(eligible);
      used.add(story.id);
      picks.push({ src, story, count: countFor(sid) });
    });

    // Pass 2: fill any remaining slots with the next newest stories from any
    // listed source (recent only), so the grid is always current news.
    for (const it of items) {
      if (picks.length >= FRONT_COUNT) break;
      if (used.has(it.id) || !publishable(it) || !FRONT_ORDER.includes(it.source_id) || !isFresh(it)) continue;
      const src = sources[it.source_id];
      if (!src) continue;
      used.add(it.id);
      picks.push({ src, story: it, count: countFor(it.source_id) });
    }

    document.getElementById('frontpage-grid').innerHTML =
      picks.map((p) => renderFrontStory(p.src, p.story, p.count)).join('');
  })
  .catch((err) => {
    console.error('Failed to load front page', err);
    document.getElementById('frontpage-grid').innerHTML =
      '<p class="empty-state">Unable to load updates right now.</p>';
  });

function renderTopStory(s) {
  const img = s.image
    ? `<img class="np-lead-img" src="${escapeAttr(s.image)}" alt="${escapeAttr(s.image_alt || '')}" onerror="this.remove()">`
    : '';
  let body;
  if (s.type === 'statement') {
    const paras = (s.paragraphs || []).map((p) => `<p>${escapeHtml(p)}</p>`).join('');
    body = `
      ${s.intro ? `<p class="np-lead-intro">${escapeHtml(s.intro)}</p>` : ''}
      <blockquote class="np-lead-statement">${paras}</blockquote>
      ${s.attribution ? `<p class="np-lead-attr">${escapeHtml(s.attribution)}</p>` : ''}`;
  } else {
    const read = s.url
      ? `<p class="np-lead-attr">Read the full story at <a href="${escapeAttr(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.source_name || 'the source')}</a></p>`
      : '';
    body = `<p class="np-lead-summary">${escapeHtml(s.summary || '')}</p>${read}`;
  }
  return `
    <article class="np-lead">
      ${img}
      <div class="np-lead-body">
        <p class="np-lead-kicker">${escapeHtml(s.kicker || 'Top Story')}</p>
        <h4 class="np-lead-headline">${escapeHtml(s.headline || '')}</h4>
        ${body}
      </div>
    </article>`;
}

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
