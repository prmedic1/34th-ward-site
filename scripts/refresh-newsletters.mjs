#!/usr/bin/env node
/**
 * Newsletter refresh for 34thward.com, run by GitHub Actions each morning.
 *
 * Reads the owner's email newsletters (Politico Illinois Playbook, Axios
 * Chicago, Indivisible Greater West Loop, Conway's Corner, WCA, Skyline) over
 * Gmail IMAP, then summarizes the ward-relevant items with GitHub Models
 * (free, using the workflow's built-in GITHUB_TOKEN - no paid API key), and
 * merges them into data/feed.json.
 *
 * This runs alongside refresh-news.mjs (public RSS feeds). The RSS script is
 * the always-on backbone; this adds the email-only sources on top.
 *
 * Needs ONE GitHub repository secret:
 *   GMAIL_APP_PASSWORD  - a Google "app password" (requires 2-Step Verification)
 * Optional: GMAIL_ADDRESS (defaults to chicagojustice@gmail.com).
 * GITHUB_TOKEN is provided automatically by Actions; the workflow grants it
 * "models: read" so it can call GitHub Models.
 *
 * If the secret or token is missing it exits cleanly (nothing breaks).
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
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.MODELS_TOKEN || '';
const MODEL = 'openai/gpt-4o-mini';

const SOURCES = {
  'illinoisplaybook@email.politico.com': { id: 'politico', name: 'POLITICO Illinois Playbook', url: 'https://www.politico.com/newsletters/illinois-playbook' },
  'chicago@axios.com': { id: 'axios', name: 'Axios Chicago', url: 'https://www.axios.com/local/chicago' },
  'info@indivisiblegwlchi.org': { id: 'igwl', name: 'Indivisible Greater West Loop', url: 'https://www.indivisiblegwlchi.org/' },
  'bill@ward34.org': { id: 'conway', name: "Conway's Corner (34th Ward Office Newsletter)", url: 'https://www.ward34.org/' },
  'info@wcachicago.org': { id: 'wca', name: 'The WCA Weekly', url: 'https://www.wcachicago.org/' },
  'marketing@westloop.org': { id: 'wlco', name: 'West Loop Community Organization', url: 'https://www.westloop.org/' },
  'tog515@gmail.com': { id: 'skyline', name: 'Skyline (Inside Publications)', url: 'https://insideonline.com/' }
};

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
      for await (const msg of client.fetch(uids.slice(-1), { source: true })) {
        try {
          const p = await simpleParser(msg.source);
          const text = (p.text || p.html || '').replace(/\s+\n/g, '\n').slice(0, 8000);
          out.push({
            source_id: meta.id, source_name: meta.name, source_url: meta.url,
            subject: p.subject || '', date: (p.date || new Date()).toISOString(), text
          });
        } catch { /* skip */ }
      }
    }
  } finally {
    lock.release();
  }
  await client.logout();
  return out;
}

async function summarize(emails) {
  const today = new Date().toISOString().slice(0, 10);
  const blocks = emails.map((e, i) =>
    `--- EMAIL ${i + 1} ---\nsource_id: ${e.source_id}\nsource: ${e.source_name}\nsubject: ${e.subject}\ndate: ${e.date}\n${e.text}`
  ).join('\n\n');

  const system = 'You are the daily editor for 34thward.com, a community news site for Chicago\'s 34th Ward (West Loop, Greektown, the Loop, Printers Row, South Loop). You return ONLY valid JSON, no prose.';
  const user = `Today is ${today}. From the newsletters below, extract the items most relevant to 34th Ward residents (local government, local businesses, community events, neighborhood happenings). Prefer local Chicago and ward-specific stories over national politics. Aim for 1 to 3 items per newsletter, up to 8 total.

STRICT RULES:
1. No em dashes anywhere. Use commas or hyphens.
2. Do NOT center coverage on Ald. Bill Conway personally. Report community impact; his newsletter is just a source.
3. Never include an event whose date already passed relative to ${today}. Drop it.
4. OMIT entirely any item that names a specific person alongside an allegation, lawsuit, arrest, or accusation. Do not include it at all.
5. Summaries: factual, specific (addresses, dates, dollar amounts, program names), 2 to 4 sentences.
6. Skip administrative filler (e.g. "no newsletter next week").

Return ONLY this JSON:
{"items":[{"source_id":"politico|axios|igwl|conway|wca|wlco|skyline","category":"elected_official|business|civic_org|religious_org|newsletter","title":"headline, no em dashes","summary":"2-4 sentences, no em dashes"}]}

NEWSLETTERS:
${blocks}`;

  const res = await fetch('https://models.github.ai/inference/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + GH_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, temperature: 0.2, max_tokens: 2000,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    })
  });
  if (!res.ok) throw new Error('GitHub Models HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const data = await res.json();
  const raw = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('No JSON in model reply');
  return JSON.parse(raw.slice(a, b + 1));
}

async function main() {
  if (!APP_PW) {
    console.log('Newsletter refresh skipped: set the GMAIL_APP_PASSWORD repo secret to enable it.');
    return;
  }
  if (!GH_TOKEN) {
    console.log('Newsletter refresh skipped: no GITHUB_TOKEN (grant the workflow models: read).');
    return;
  }

  const feedPath = join(ROOT, 'data', 'feed.json');
  const feed = JSON.parse(await readFile(feedPath, 'utf8'));

  const emails = await fetchNewsletters();
  if (!emails.length) {
    console.log('No newsletters in the last 2 days.');
    return;
  }

  const result = await summarize(emails);
  const byId = Object.fromEntries(Object.values(SOURCES).map((s) => [s.id, s]));
  const emailBySource = {};
  emails.forEach((e) => { emailBySource[e.source_id] = e; });

  const existingIds = new Set((feed.items || []).map((it) => it.id));
  const existingTK = new Set((feed.items || []).map((it) => it.source_id + '|' + (it.title || '').toLowerCase()));

  let added = 0;
  const fresh = [];
  for (const it of (result.items || [])) {
    const src = byId[it.source_id];
    if (!src || !it.title || !it.summary) continue;
    const dateStr = (emailBySource[it.source_id] || {}).date || new Date().toISOString();
    const id = `${it.source_id}-${dateStr.slice(0, 10).replace(/-/g, '')}-${slug(it.title)}`;
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
      flagged_for_review: false
    });
    added++;
  }

  if (added) {
    feed.items = fresh.concat(feed.items || []);
    if (feed.items.length > 80) {
      const old = Date.now() - 21 * 24 * 3600 * 1000;
      feed.items = feed.items.filter((it, i) => i < 50 || new Date(it.published_at).getTime() > old);
    }
    feed.generated_at = new Date().toISOString();
    await writeFile(feedPath, JSON.stringify(feed, null, 1) + '\n');
  }

  console.log(`Newsletter refresh: added ${added} item(s) from ${emails.length} newsletter(s).`);
}

main().catch((e) => {
  console.error('Newsletter refresh error (non-fatal):', e.message);
  process.exit(0);
});
