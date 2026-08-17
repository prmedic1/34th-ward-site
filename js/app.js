const DATA_V = '20260817a';

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
      const actions = document.querySelector('.race-actions');
      if (actions && !actions.querySelector('.race-kalshi-btn')) {
        actions.insertAdjacentHTML('beforeend',
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
    // "What Happened Recently" = the last few Top Stories, as compact teaser
    // cards (thumbnail + one-line synopsis), not the full old articles. The full
    // write-ups live on the Top Stories archive page.
    const recent = (data && Array.isArray(data.history)) ? data.history.slice(0, 3) : [];
    if (recent.length) {
      document.getElementById('recent-banner').hidden = false;
      document.getElementById('recent-grid').innerHTML = recent.map(renderRecentCard).join('');
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
    const isFresh = (it) => new Date(it.published_at).getTime() >= sevenDaysAgo;
    const byDate = (a, b) => new Date(b.published_at) - new Date(a.published_at);
    // The center "lead" is the biggest LOCAL story: most about the 34th Ward,
    // else a West Loop or citywide resident-impact story; recency breaks ties.
    const roundupKw = /weekly action plan|weekly round-?up|weekly update|weekly digest|action plan/i;
    const localScore = (it) => {
      const t = it.title + ' ' + (it.summary || '');
      const recentBonus = new Date(it.published_at).getTime() >= twoDaysAgo ? 2 : 0;
      // De-prioritize recurring newsletter roundups as the lead; the center
      // should be a real story, not a "weekly action plan" digest.
      const roundup = roundupKw.test(it.title || '') ? 4 : 0;
      return (wardKw.test(t) ? 4 : 0) + (residentKw.test(t) ? 2 : 0) + recentBonus - roundup;
    };
    const fresh = items.filter((it) => publishable(it) && FRONT_ORDER.includes(it.source_id) && isFresh(it));
    const freshestOf = (sid) => fresh.filter((it) => it.source_id === sid).sort(byDate)[0];

    // Center = the biggest local story (from any source, even Politico/Axios).
    // Politico and Axios are the other two of the top-two; if the lead is
    // already one of them, or one has nothing fresh (weekends), the next
    // freshest story fills that flank. The lead is centered on desktop and
    // jumps to the top of the feed on mobile.
    const lead = fresh.slice().sort((a, b) => (localScore(b) - localScore(a)) || byDate(a, b))[0];
    const leadId = lead ? lead.id : null;
    const seen = new Set();
    const top = [];
    const addUniq = (s) => { if (s && !seen.has(s.id)) { seen.add(s.id); top.push(s); } };
    addUniq(lead);
    if (!lead || lead.source_id !== 'politico') addUniq(freshestOf('politico'));
    if (!lead || lead.source_id !== 'axios') addUniq(freshestOf('axios'));
    // Fill the top row to three, preferring a source not already up top so the
    // row never doubles up (e.g. two Axios stories).
    while (top.length < 3) {
      const usedSrc = new Set(top.map((s) => s.source_id));
      const n = fresh.find((it) => !seen.has(it.id) && !usedSrc.has(it.source_id))
        || fresh.find((it) => !seen.has(it.id));
      if (!n) break;
      addUniq(n);
    }
    const flanks = top.filter((s) => s.id !== leadId);
    const topRow = lead ? [flanks[0], lead, flanks[1]] : flanks.slice(0, 3);

    // Dedupe near-identical stories (titles sharing 3+ significant words).
    const sigOf = (it) => (it.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
    const picks = [];
    const used = new Set();
    const sigs = [];
    const isDup = (words) => sigs.some((prev) => words.filter((w) => prev.includes(w)).length >= 3);
    const add = (story, isLead) => {
      if (!story || used.has(story.id)) return;
      const words = sigOf(story);
      if (isDup(words)) return;
      used.add(story.id); sigs.push(words);
      picks.push({ src: sources[story.source_id], story, count: countFor(story.source_id), isLead: !!isLead });
    };
    topRow.forEach((s) => add(s, s && s.id === leadId));
    for (const it of fresh.slice().sort(byDate)) {
      if (picks.length >= FRONT_COUNT) break;
      add(it);
    }

    document.getElementById('frontpage-grid').innerHTML =
      picks.map((p) => renderFrontStory(p.src, p.story, p.count, p.isLead)).join('');
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

// Compact teaser for the "What Happened Recently" strip: a small thumbnail and a
// one-line synopsis. The whole card links to the Top Stories archive, where the
// full old write-ups live.
function renderRecentCard(s) {
  const img = s.image
    ? `<img class="np-recent-img" src="${escapeAttr(s.image)}" alt="${escapeAttr(s.image_alt || '')}" onerror="this.remove()">`
    : '';
  const synopsis = s.type === 'statement' ? (s.intro || '') : (s.summary || '');
  return `
    <a class="np-recent-card" href="top-stories.html">
      ${img}
      <div class="np-recent-body">
        <p class="np-recent-kicker">${escapeHtml(s.kicker || 'Top Story')}</p>
        <h4 class="np-recent-headline">${escapeHtml(s.headline || '')}</h4>
        <p class="np-recent-synopsis">${escapeHtml(synopsis)}</p>
      </div>
    </a>`;
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

function renderFrontStory(src, story, count, isLead) {
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
    <article class="np-story${isLead ? ' np-story--lead' : ''}">
      ${sourceMasthead(src)}
      ${img}
      <h4><a href="source.html?s=${src.id}">${escapeHtml(story.title)}</a></h4>
      <p class="np-summary">${escapeHtml(story.summary)}</p>
      <p class="np-dateline">${date} &middot; <a href="${escapeAttr(story.url)}" target="_blank" rel="noopener">Read original &rarr;</a></p>
      ${more}
    </article>`;
}

// AI search box: opens the chosen assistant with the typed question. Gemini
// has no URL to pre-fill, so we copy the question and open the app.
const aiForm = document.getElementById('ai-search');
if (aiForm) {
  aiForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const q = document.getElementById('ai-q').value.trim();
    if (!q) return;
    const engine = document.getElementById('ai-engine').value;
    const enc = encodeURIComponent(q);
    const note = document.getElementById('ai-search-note');
    if (note) note.hidden = true;
    if (engine === 'claude') {
      window.open('https://claude.ai/new?q=' + enc, '_blank', 'noopener');
    } else if (engine === 'chatgpt') {
      window.open('https://chatgpt.com/?q=' + enc, '_blank', 'noopener');
    } else {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(q).catch(function () {});
      }
      window.open('https://gemini.google.com/app', '_blank', 'noopener');
      if (note) {
        note.textContent = 'Your question was copied - paste it into Gemini (Ctrl+V or Cmd+V).';
        note.hidden = false;
        setTimeout(function () { note.hidden = true; }, 7000);
      }
    }
  });
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
