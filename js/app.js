const DATA_V = '20260908a';
// Daily-refreshed data must revalidate on every load, so the morning update
// shows right away instead of a returning browser serving yesterday's copy.
const NOCACHE = { cache: 'no-cache' };

document.getElementById('year').textContent = new Date().getFullYear();

fetch('data/mayor_race.json?d=' + DATA_V, NOCACHE)
  .then((r) => r.json())
  .then((data) => {
    document.getElementById('race-date').textContent = data.election_date;

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

fetch('data/spotlight.json?d=' + DATA_V, NOCACHE)
  .then((r) => r.json())
  .then((data) => {
    const s = data.current;
    if (!s || !s.name) return;
    const simg = document.getElementById('spotlight-img');
    if (s.image) {
      simg.src = s.image;
      simg.onerror = () => { simg.style.display = 'none'; };
      // Ad-style graphics (a logo/headshot promo) show whole; storefront photos
      // stay cropped to fill the frame.
      simg.classList.toggle('spotlight-img--contain', s.image_fit === 'contain');
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
fetch('data/featured.json?d=' + DATA_V, NOCACHE)
  .then((r) => r.json())
  .then((data) => {
    // A pinned top story can carry an "expires" date (YYYY-MM-DD). After that
    // day it stops leading the front page and drops into the recent strip; its
    // own article page and the archive stay live so any inbound links keep working.
    const todayStr = new Date().toISOString().slice(0, 10);
    const isExpired = (s) => s && s.expires && todayStr > s.expires;
    const cur0 = data && data.current;
    const hist0 = (data && Array.isArray(data.history)) ? data.history : [];
    // A shared deep link (?story=slug) always features that story as the lead,
    // even after it has stopped leading on its own, so links from other outlets
    // land on the full homepage with the story up top. It looks in the current
    // story and the archive, so the link keeps working after the story is retired.
    const wanted = new URLSearchParams(location.search).get('story');
    let lead = (cur0 && !isExpired(cur0)) ? cur0 : null;
    if (wanted) {
      const match = [cur0].concat(hist0).filter(Boolean).find((s) => s.slug === wanted);
      if (match) lead = match;
    }
    if (lead) {
      document.getElementById('top-story').innerHTML = renderTopStory(lead);
    }
    // "What Happened Recently" = the last few Top Stories, as compact teaser
    // cards (thumbnail + one-line synopsis), not the full old articles. The full
    // write-ups live on the Top Stories archive page.
    const recentPool = hist0.slice();
    if (cur0 && isExpired(cur0) && lead !== cur0) recentPool.unshift(cur0);
    const recent = recentPool.filter((s) => s !== lead).slice(0, 3);
    if (recent.length) {
      document.getElementById('recent-banner').hidden = false;
      document.getElementById('recent-grid').innerHTML = recent.map(renderRecentCard).join('');
    }
  })
  .catch((err) => console.error('Failed to load top story', err));

// Community meetings carve-out on the front page (data/meetings.json).
fetch('data/meetings.json?d=' + DATA_V, NOCACHE)
  .then((r) => r.json())
  .then((data) => {
    const today = new Date().toISOString().slice(0, 10);
    // Drop any meeting whose date has already passed; the box scrolls to fit
    // however many remain.
    const up = (data.meetings || [])
      .filter((m) => m.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!up.length) return;
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const when = (m) => {
      const p = m.date.split('-'); const d = new Date(+p[0], +p[1] - 1, +p[2]);
      const day = m.date === today ? 'Today' : (MON[d.getMonth()] + ' ' + d.getDate());
      return day + (m.time ? ' &middot; ' + escapeHtml(m.time) : '');
    };
    document.getElementById('meetings-list').innerHTML = up.map((m) => {
      const name = m.url
        ? `<a class="meeting-link" href="${escapeAttr(m.url)}" target="_blank" rel="noopener">${escapeHtml(m.title)}</a>`
        : escapeHtml(m.title);
      return `<div class="meeting"><p class="meeting-when">${when(m)}</p>` +
        `<p class="meeting-name">${name}</p>` +
        (m.org ? `<p class="meeting-org">${escapeHtml(m.org)}</p>` : '') +
        (m.location ? `<p class="meeting-where">${escapeHtml(m.location)}</p>` : '') +
        `<p class="meeting-desc">${escapeHtml(m.desc || '')}</p></div>`;
    }).join('');
    document.getElementById('community-meetings').hidden = false;
    // The box is a filler at the top of the right front-page column, so its
    // arrival changes the column heights - rebalance once it is in the DOM.
    if (window.__balanceFront) window.__balanceFront();
  })
  .catch((err) => console.error('Failed to load meetings', err));

// The Front Page: six stories, newspaper style. One story per source first
// (for variety), then backfill from productive sources so it always fills six.
const FRONT_ORDER = ['blockclub', 'wlco', 'wca', 'axios', 'politico', 'conway', 'igwl', 'wardwatch', 'eater', 'cbs', 'abc7'];
const FRONT_COUNT = 6;

Promise.all([
  fetch('data/news_sources.json?d=' + DATA_V, NOCACHE).then((r) => r.json()),
  fetch('data/feed.json?d=' + DATA_V, NOCACHE).then((r) => r.json()),
  fetch('data/featured.json?d=' + DATA_V, NOCACHE).then((r) => r.json()).catch(() => ({}))
])
  .then(([srcData, feedData, featData]) => {
    const sources = Object.fromEntries(srcData.sources.map((s) => [s.id, s]));
    // Don't repeat the pinned Top Story down in the front page.
    const topStory = featData && featData.current;
    const excludeRe = topStory && topStory.exclude_kw ? new RegExp(topStory.exclude_kw, 'i') : null;
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
    const fresh = items.filter((it) => publishable(it) && FRONT_ORDER.includes(it.source_id) && isFresh(it) && !(excludeRe && excludeRe.test((it.title || '') + ' ' + (it.summary || ''))));
    // Politico and Axios are curated once-a-day newsletters. Look back a little
    // further than the 7-day window so they still lead on quiet weekends.
    const recentOf = (sid) => {
      const cut = Date.now() - 16 * 24 * 3600 * 1000;
      return items.filter((it) => it.source_id === sid && publishable(it)
        && new Date(it.published_at).getTime() >= cut
        && !(excludeRe && excludeRe.test((it.title || '') + ' ' + (it.summary || ''))))
        .sort(byDate)[0];
    };

    // Dedupe near-identical stories (titles sharing 3+ significant words).
    const sigOf = (it) => (it.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
    const ONCE = new Set(['politico', 'axios']);
    const picks = [];
    const used = new Set();
    const sigs = [];
    const isDup = (words) => sigs.some((prev) => words.filter((w) => prev.includes(w)).length >= 3);
    const add = (story, isLead) => {
      if (!story || used.has(story.id)) return;
      const once = ONCE.has(story.source_id);
      // Politico and Axios are curated once-a-day sources: never let a second
      // item from either onto the page (yesterday's can linger in the feed).
      if (once && picks.some((p) => p.story.source_id === story.source_id)) return;
      const words = sigOf(story);
      // The two curated sources always run (one each) even if they echo another
      // headline; every other story is dropped when it duplicates one already up.
      if (!once && isDup(words)) return;
      used.add(story.id); sigs.push(words);
      picks.push({ src: sources[story.source_id], story, count: countFor(story.source_id), isLead: !!isLead });
    };

    // Front page section: Politico first, then Axios - one of each, never more.
    add(recentOf('politico'));
    add(recentOf('axios'));
    // Then the biggest local story from another source, as the emphasized lead.
    const lead = fresh.slice()
      .sort((a, b) => (localScore(b) - localScore(a)) || byDate(a, b))
      .find((it) => !used.has(it.id) && !ONCE.has(it.source_id));
    add(lead, true);
    // Backfill the rest of the six, freshest first.
    for (const it of fresh.slice().sort(byDate)) {
      if (picks.length >= FRONT_COUNT) break;
      add(it);
    }

    const gridEl = document.getElementById('frontpage-grid');
    const feedEl = gridEl.parentElement;
    gridEl.innerHTML = picks.map((p) => renderFrontStory(p.src, p.story, p.count, p.isLead)).join('');
    // Two desktop columns that END TOGETHER. The LEFT column is all stories; the
    // RIGHT column is the community-meetings card (pinned at the top) followed by
    // the remaining stories. The card is capped at half the column height and
    // always has stories beneath it; whatever space the card and its stories do
    // not fill, the card absorbs (scrolling its own list) so the bottoms line up.
    const originalOrder = [...gridEl.children];
    function balanceFront() {
      const meetingsEl = document.getElementById('community-meetings');
      // Tear down: meetings card back to its home above the grid, stories flat,
      // and drop any explicit filler height left over from a previous pass.
      if (meetingsEl) { meetingsEl.style.height = ''; feedEl.insertBefore(meetingsEl, gridEl); }
      gridEl.classList.remove('np-grid--balanced');
      originalOrder.forEach((c) => gridEl.appendChild(c));
      [...gridEl.querySelectorAll('.fp-col')].forEach((c) => c.remove());
      if (window.matchMedia('(max-width: 820px)').matches || originalOrder.length < 2) return;

      // Build the two flex columns and switch the grid to flex so every
      // measurement below is taken at the REAL (narrow) column width.
      const colA = document.createElement('div'), colB = document.createElement('div');
      colA.className = 'fp-col'; colB.className = 'fp-col';
      originalOrder.forEach((c) => c.remove());
      gridEl.appendChild(colA); gridEl.appendChild(colB);
      gridEl.classList.add('np-grid--balanced');

      // Measure the meetings card at its natural (full-content) height; it may
      // end up scrolled shorter than this or stretched a little past it.
      const haveMeet = meetingsEl && !meetingsEl.hidden;
      let natBox = 0;
      if (haveMeet) { colB.appendChild(meetingsEl); meetingsEl.style.height = ''; natBox = meetingsEl.getBoundingClientRect().height || 1; }

      // Read every story's height at the true column width.
      originalOrder.forEach((c) => colA.appendChild(c));
      const st = originalOrder.map((c) => ({ c, h: c.getBoundingClientRect().height || 1 }));
      originalOrder.forEach((c) => c.remove());

      // Politico and Axios are pinned to the TOP of the LEFT column, in order,
      // so Axios always sits directly under Politico. Everything else balances.
      const PRI = { politico: 1, axios: 1 };
      const pinned = st.filter((x) => PRI[x.c.dataset.src]);
      const rest = st.filter((x) => !PRI[x.c.dataset.src]);
      pinned.forEach((x) => colA.appendChild(x.c));
      const pinnedH = pinned.reduce((s, x) => s + x.h, 0);

      if (!haveMeet) {
        // No meetings card: even the two stacks by height, keeping pinned on top.
        let ha = pinnedH, hb = 0; const colOf = [];
        rest.map((x, i) => i).sort((a, b) => rest[b].h - rest[a].h)
          .forEach((i) => { if (ha <= hb) { colOf[i] = colA; ha += rest[i].h; } else { colOf[i] = colB; hb += rest[i].h; } });
        rest.forEach((x, i) => colOf[i].appendChild(x.c));
        return;
      }

      // Split the REST so the card height needed to level the bottoms
      // (leftStories - rightStories) lands near min(naturalCard, half a column).
      const m = rest.length;
      const restTotal = rest.reduce((s, x) => s + x.h, 0);
      let best = null;
      for (let mask = 0; mask < (1 << m); mask++) {
        let Rb = 0; for (let i = 0; i < m; i++) if (mask & (1 << i)) Rb += rest[i].h;
        const La = pinnedH + (restTotal - Rb);                   // left column stories (pinned + rest-in-A)
        const boxOuter = La - Rb;                                // card height that levels the bottoms
        if (boxOuter < 60) continue;                             // card must be a real box
        const cap = La / 2;                                      // never over half the column
        if (boxOuter > cap + 0.5) continue;
        const score = Math.abs(boxOuter - Math.min(natBox, cap));
        if (!best || score < best.score) best = { mask, score };
      }
      if (best) {
        rest.forEach((x, i) => ((best.mask & (1 << i)) ? colB : colA).appendChild(x.c));
      } else if (rest.length) {
        // Fallback (e.g. one giant story): smallest story under the card.
        const idx = rest.map((x, i) => i).sort((a, b) => rest[a].h - rest[b].h);
        rest.forEach((x, i) => (i === idx[0] ? colB : colA).appendChild(x.c));
      }

      // Size the card so the columns bottom out together (measured, so borders
      // and margins are accounted for), then hard-cap it at half the column.
      const half = colA.getBoundingClientRect().height / 2;
      let boxH = natBox + (colA.getBoundingClientRect().height - colB.getBoundingClientRect().height);
      if (boxH > half) boxH = half;
      if (boxH < 120) boxH = 120;
      meetingsEl.style.height = boxH + 'px';
    }
    window.__balanceFront = balanceFront;
    balanceFront();
    window.addEventListener('load', balanceFront);
    // Story thumbnails and source logos change card heights as they decode;
    // rebalance once they settle so the measured heights are real.
    gridEl.querySelectorAll('img').forEach((im) => {
      if (!im.complete) im.addEventListener('load', () => { clearTimeout(window.__fpTimer); window.__fpTimer = setTimeout(balanceFront, 120); });
    });
    window.addEventListener('resize', () => { clearTimeout(window.__fpTimer); window.__fpTimer = setTimeout(balanceFront, 150); });
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
  const img2 = s.image2
    ? `<img class="np-lead-img2" src="${escapeAttr(s.image2)}" alt="${escapeAttr(s.image2_alt || '')}" onerror="this.remove()">`
    : '';
  const media = (img || img2) ? `<div class="np-lead-media${(img && img2) ? ' np-lead-media-two' : ''}">${img}${img2}</div>` : '';
  // Optional colored "flag" ribbon across the top of the card (e.g. breaking news).
  const flag = s.flag ? `<div class="np-lead-flag">${escapeHtml(s.flag)}</div>` : '';
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
    <article class="np-lead${s.flag ? ' has-flag' : ''}">
      ${flag}
      ${media}
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
    <article class="np-story${isLead ? ' np-story--lead' : ''}" data-src="${escapeAttr(src.id)}">
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
