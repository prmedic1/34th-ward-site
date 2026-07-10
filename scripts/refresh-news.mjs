#!/usr/bin/env node
/**
 * Cloud news refresh for 34thward.com, run by GitHub Actions every morning
 * (works even when the owner's computer is off - that was the whole point).
 *
 * It reads the day's newsletters straight from Gmail over IMAP, has Claude
 * summarize them into feed items following the site's editorial rules, merges
 * them into data/feed.json, and rotates the daily Business Spotlight.
 *
 * Needs three GitHub repository secrets (Settings > Secrets and variables >
 * Actions):
 *   GMAIL_ADDRESS       - chicagojustice@gmail.com
 *   GMAIL_APP_PASSWORD  - a Google "app password" (needs 2-Step Verification on)
 *   ANTHROPIC_API_KEY   - a key from console.anthropic.com
 *
 * If any secret is missing the script logs a note and exits cleanly, so the
 * rest of the daily refresh (odds, happy hours) still runs.
 *
 * Node 20+, deps: imapflow, mailparser (installed by the workflow).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GMAIL = process.env.GMAIL_ADDRESS || 'chicagojustice@gmail.com';
const APP_PW = process.env.GMAIL_APP_PASSWORD || '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = 'claude-haiku-4-5-20251001';

// Each newsletter sender maps to a source_id + display name + canonical link.
const SOURCES = {
  'illinoisplaybook@email.politico.com': { id: 'politico', name: 'POLITICO Illinois Playbook', url: 'https://www.politico.com/newsletters/illinois-playbook' },
  'chicago@axios.com': { id: 'axios', name: 'Axios Chicago', url: 'https://www.axios.com/local/chicago' },
  'bill@ward34.org': { id: 'conway', name: "Conway's Corner (34th Ward Office Newsletter)", url: 'https://www.ward34.org/' },
  'info@indivisiblegwlchi.org': { id: 'igwl', name: 'Indivisible Greater West Loop', url: 'https://www.indivisiblegwlchi.org/' },
  'info@wcachicago.org': { id: 'wca', name: 'The WCA Weekly', url: 'https://www.wcachicago.org/' },
  'marketing@westloop.org': { id: 'wlco', name: 'West Loop Community Organization', url: 'https://www.westloop.org/' },
  'tog515@gmail.com': { id: 'skyline', name: 'Skyline (Inside Publications)', url: 'https://insideonline.com/' }
};

// Curated spotlight rotation of well-known ward businesses. The script picks
// the next one not seen recently and has Claude write a fresh blurb.
// Each entry has a fallback "image" for when the site has no og:image, so a
// spotlight is never photo-less. The script still prefers a live og:image.
const SPOTLIGHT_POOL = [
  { name: 'Monteverde Restaurant & Pastificio', address: '1020 W. Madison St, West Loop', website: 'https://www.monteverdechicago.com/', image: 'https://monteverdechicago.com/wp-content/uploads/2023/09/Burrata-e-Ham-PB-4-scaled.jpg' },
  { name: 'Sepia', address: '123 N. Jefferson St, West Loop', website: 'https://www.sepiachicago.com/' },
  { name: 'The Publican', address: '837 W. Fulton Market, Fulton Market', website: 'https://www.thepublicanrestaurant.com/' },
  { name: "Lou Mitchell's", address: '565 W. Jackson Blvd, West Loop', website: 'https://www.loumitchells.com/', image: 'images/lou-mitchells.jpg' },
  { name: 'Green Street Smoked Meats', address: '112 N. Green St, West Loop', website: 'https://greenstreetmeats.com/', image: 'images/green-street-smoked-meats.jpg' },
  { name: "Formento's", address: '925 W. Randolph St, West Loop', website: 'https://www.formentos.com/' },
  { name: 'El Che Steakhouse & Bar', address: '845 W. Washington Blvd, West Loop', website: 'https://www.elchechicago.com/' },
  { name: 'The Original Pancake House', address: '1124 W. Madison St, West Loop', website: 'https://ophchicagoland.com/', image: 'images/original-pancake-house.jpg' },
  { name: 'Bar Siena', address: '832 W. Randolph St, West Loop', website: 'https://www.barsiena.com/' },
  { name: 'Gibsons Italia', address: '233 N. Canal St, Fulton River District', website: 'https://gibsonssteakhouse.com/italia/' }
];

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

async function fetchNewsletters() {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: GMAIL, pass: APP_PW }, logger: false
  });
  await client.connect();
  const out = [];
  const lock = await client.getMailboxLock('INBOX');
  try {
    const since = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    for (const [addr, meta] of Object.entries(SOURCES)) {
      let uids;
      try { uids = await client.search({ since, from: addr }); }
      catch { uids = []; }
      if (!uids || !uids.length) continue;
      // Newest 1-2 per sender is plenty.
      const pick = uids.slice(-2);
      for await (const msg of client.fetch(pick, { source: true })) {
        try {
          const p = await simpleParser(msg.source);
          const text = (p.text || p.html || '').replace(/\s+\n/g, '\n').slice(0, 7000);
          out.push({
            source_id: meta.id, source_name: meta.name, source_url: meta.url,
            subject: p.subject || '', date: (p.date || new Date()).toISOString(),
            text
          });
        } catch { /* skip unparseable */ }
      }
    }
  } finally {
    lock.release();
  }
  await client.logout();
  return out;
}

async function askClaude(emails, spotlightCandidate, recentTitles) {
  const today = new Date().toISOString().slice(0, 10);
  const emailBlocks = emails.map((e, i) =>
    `--- EMAIL ${i + 1} ---\nsource_id: ${e.source_id}\nsource: ${e.source_name}\nsubject: ${e.subject}\ndate: ${e.date}\n${e.text}`
  ).join('\n\n');

  const prompt = `You are the daily editor for 34thward.com, a community news site for Chicago's 34th Ward (the West Loop, Greektown, the Loop, Printers Row, South Loop). Today is ${today}.

From the newsletters below, extract the news items most relevant to 34th Ward residents (local government, local businesses, community events, civic organizations, neighborhood happenings). Prefer local Chicago and ward-specific stories over national politics.

STRICT EDITORIAL RULES:
1. No em dashes anywhere. Use commas, hyphens, or separate sentences.
2. Do NOT center coverage on Ald. Bill Conway personally. Report the community impact; his newsletter is just a source.
3. Never include an event whose date has already passed relative to ${today}. Drop it entirely.
4. If an item names a specific person alongside an allegation, lawsuit, arrest, or dispute, set "flagged_for_review": true (still include it).
5. Summaries are factual, specific (addresses, dates, dollar amounts, program names), and 2 to 4 sentences.
6. Skip pure administrative content (e.g. "no newsletter next week").

Also write a fresh 2 to 3 sentence Business Spotlight blurb for this ward business (warm, factual, no em dashes): ${spotlightCandidate.name} at ${spotlightCandidate.address}.

Do not repeat any of these already-published headlines: ${recentTitles.slice(0, 20).join(' | ')}

Return ONLY valid JSON, no prose, in exactly this shape:
{
  "items": [
    { "source_id": "politico|axios|conway|igwl|wca|wlco|skyline", "category": "elected_official|business|civic_org|religious_org|newsletter", "title": "Headline, no em dashes", "summary": "2-4 sentences, no em dashes", "flagged_for_review": false }
  ],
  "spotlight_blurb": "2-3 sentence blurb"
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt + '\n\nNEWSLETTERS:\n' + emailBlocks }]
    })
  });
  if (!res.ok) throw new Error('Anthropic HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const data = await res.json();
  const raw = (data.content && data.content[0] && data.content[0].text) || '';
  const jsonStart = raw.indexOf('{');
  const jsonEnd = raw.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd < 0) throw new Error('No JSON in model reply');
  return JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
}

async function ogImage(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (34thward-bot)' }, redirect: 'follow' });
    if (!r.ok) return '';
    const html = await r.text();
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return m ? m[1] : '';
  } catch { return ''; }
}

async function main() {
  if (!APP_PW || !ANTHROPIC_KEY) {
    console.log('News refresh skipped: set GMAIL_APP_PASSWORD and ANTHROPIC_API_KEY repo secrets to enable it.');
    return;
  }

  const feedPath = join(ROOT, 'data', 'feed.json');
  const spotPath = join(ROOT, 'data', 'spotlight.json');
  const feed = JSON.parse(await readFile(feedPath, 'utf8'));
  const spot = JSON.parse(await readFile(spotPath, 'utf8'));

  const emails = await fetchNewsletters();
  if (!emails.length) {
    console.log('No newsletters found in the last 2 days; nothing to add.');
    return;
  }

  // Choose the next spotlight business not used in the recent history.
  const recentNames = new Set([
    spot.current && spot.current.name,
    ...(spot.history || []).slice(-Math.min(30, SPOTLIGHT_POOL.length - 1)).map((h) => h.name)
  ].filter(Boolean));
  const candidate = SPOTLIGHT_POOL.find((b) => !recentNames.has(b.name)) || SPOTLIGHT_POOL[0];

  const recentTitles = (feed.items || []).slice(0, 25).map((it) => it.title);
  const result = await askClaude(emails, candidate, recentTitles);

  // Merge feed items.
  const existingIds = new Set((feed.items || []).map((it) => it.id));
  const existingTK = new Set((feed.items || []).map((it) => it.source_id + '|' + (it.title || '').toLowerCase()));
  const byId = Object.fromEntries(Object.values(SOURCES).map((s) => [s.id, s]));
  const emailBySource = {};
  emails.forEach((e) => { emailBySource[e.source_id] = e; });

  let added = 0;
  const fresh = [];
  for (const it of (result.items || [])) {
    const src = byId[it.source_id];
    if (!src || !it.title || !it.summary) continue;
    const dateStr = (emailBySource[it.source_id] || {}).date || new Date().toISOString();
    const ymd = dateStr.slice(0, 10).replace(/-/g, '');
    const id = `${it.source_id}-${ymd}-${slug(it.title)}`;
    const tk = it.source_id + '|' + it.title.toLowerCase();
    if (existingIds.has(id) || existingTK.has(tk)) continue;
    existingIds.add(id); existingTK.add(tk);
    fresh.push({
      id,
      category: it.category || 'newsletter',
      source_id: it.source_id,
      source_name: src.name,
      source_type: 'email_newsletter',
      title: it.title,
      summary: it.summary,
      url: src.url,
      published_at: dateStr,
      flagged_for_review: !!it.flagged_for_review
    });
    added++;
  }

  if (added) {
    feed.items = fresh.concat(feed.items || []);
    // Trim items older than 21 days if the list gets long.
    if (feed.items.length > 60) {
      const cutoff = Date.now() - 21 * 24 * 3600 * 1000;
      feed.items = feed.items.filter((it) => new Date(it.published_at).getTime() > cutoff || feed.items.indexOf(it) < 40);
    }
    feed.generated_at = new Date().toISOString();
    await writeFile(feedPath, JSON.stringify(feed, null, 1) + '\n');
  }

  // Rotate spotlight.
  if (result.spotlight_blurb) {
    const img = (await ogImage(candidate.website)) || candidate.image || '';
    if (spot.current) {
      spot.history = spot.history || [];
      spot.history.push(spot.current);
    }
    spot.current = {
      date: new Date().toISOString().slice(0, 10),
      name: candidate.name,
      address: candidate.address,
      website: candidate.website,
      image: img || (spot.current && spot.current.image) || '',
      blurb: result.spotlight_blurb
    };
    await writeFile(spotPath, JSON.stringify(spot, null, 1) + '\n');
  }

  console.log(`News refresh: added ${added} feed item(s) from ${emails.length} newsletter(s); spotlight -> ${candidate.name}.`);
}

main().catch((e) => {
  // Never fail the whole workflow just because news could not refresh.
  console.error('News refresh error (non-fatal):', e.message);
  process.exit(0);
});
