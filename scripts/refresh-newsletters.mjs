#!/usr/bin/env node
/**
 * Newsletter refresh for 34thward.com, run by GitHub Actions each morning.
 *
 * Reads the owner's email newsletters (Politico Illinois Playbook, Axios
 * Chicago, Indivisible Greater West Loop, Conway's Corner, WCA, Skyline) over
 * Gmail IMAP, then summarizes the ward-relevant items with Groq
 * (free tier, no cost), and merges them into data/feed.json.
 *
 * This runs alongside refresh-news.mjs (public RSS feeds). The RSS script is
 * the always-on backbone; this adds the email-only sources on top.
 *
 * Needs TWO GitHub repository secrets:
 *   GMAIL_APP_PASSWORD  - a Google "app password" (requires 2-Step Verification)
 *   GROQ_API_KEY        - a free Groq API key (console.groq.com, starts with gsk_)
 * Optional: GMAIL_ADDRESS (defaults to chicagojustice@gmail.com).
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
const GROQ_KEY = process.env.GROQ_API_KEY || '';
// Groq retires/renames models over time (llama-3.3-70b-versatile started
// returning HTTP 404 "model does not exist" in Aug 2026), which silently broke
// this whole pipeline. So we no longer hardcode one model: we ask Groq which
// models the key can use and try our preferred ones in order, falling through
// on any "model unavailable" error. Update MODEL_PREFS if you want a different
// preference order; the discovery + fallback keeps it working regardless.
const MODEL_PREFS = [
  'qwen/qwen3.8-27b',
  'qwen/qwen3.6-27b',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'qwen/qwen3-32b',
  'gemma2-9b-it'
];

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
          // Newsletter plaintext (especially Axios) is padded with tracking-link
          // artifacts and table pipes; strip that noise BEFORE slicing so the
          // window the model sees is real prose, not a wall of URLs.
          const text = (p.text || p.html || '')
            .replace(/\[\]\(\s*https?:\/\/[^)]*\)/gi, ' ')   // markdown empty links [](url)
            .replace(/\(\s*https?:\/\/[^)]*\)/gi, ' ')        // (url)
            .replace(/https?:\/\/\S+/gi, ' ')                 // bare urls
            .replace(/[|>]+/g, ' ')                            // table pipes / quote marks
            .replace(/[ \t]{2,}/g, ' ')                        // collapse runs of spaces
            .replace(/ *\n */g, '\n')
            .replace(/\n{3,}/g, '\n\n')                        // collapse blank lines
            .trim()
            .slice(0, 8000);
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
  const user = `Today is ${today}. For EACH newsletter below you MUST return at least one item and at most three, UNLESS that newsletter is nothing but administrative filler (for example "no newsletter this week"). Every newsletter that has real content must be represented, so returning an empty list is wrong unless every newsletter is pure filler. Prefer the item(s) most pertinent to the West Loop and the 34th Ward (its neighborhoods: West Loop, Greektown, Fulton Market, Printers Row, South Loop, the near west side, and the Loop). When a newsletter has nothing specifically about the ward, still return its single most newsworthy story for a general Chicago audience (transit, housing, development, a notable business opening or closing, schools and CPS, crime and public safety, taxes and the city budget). Avoid national politics. There is no total cap.

STRICT RULES:
1. No em dashes anywhere. Use commas or hyphens.
2. Do NOT center coverage on Ald. Bill Conway personally. Report community impact; his newsletter is just a source.
3. Never include an event whose date already passed relative to ${today}. Drop it.
4. OMIT entirely any item that names a specific person alongside an allegation, lawsuit, arrest, or accusation. Do not include it at all.
5. Summaries: factual, specific (addresses, dates, dollar amounts, program names), 2 to 4 sentences.
6. Skip administrative filler (e.g. "no newsletter next week").
7. OMIT any item you cannot summarize with concrete facts actually stated in the newsletter. Never speculate or pad. Do not use hedging words like "likely", "probably", "may", or phrases like "the newsletter does not say". If unsure, leave the item out.
8. Do not output two items about the same event; pick the single best one.

Return ONLY this JSON:
{"items":[{"source_id":"politico|axios|igwl|conway|wca|wlco|skyline","category":"elected_official|business|civic_org|religious_org|newsletter","title":"headline, no em dashes","summary":"2-4 sentences, no em dashes"}]}

NEWSLETTERS:
${blocks}`;

  const models = await pickModels();
  let lastErr;
  for (const model of models) {
    try {
      return await callGroq(model, system, user);
    } catch (e) {
      lastErr = e;
      // Try the next model only when THIS model is the problem (missing / no
      // access / deprecated). For other errors (rate limit, bad request, auth)
      // stop and report so we do not mask a real failure.
      if (!/model|does not exist|not found|404|no access|decommission|deprecat/i.test(e.message)) throw e;
      console.log(`Groq model ${model} unavailable, trying next (${e.message.slice(0, 120)})`);
    }
  }
  throw lastErr || new Error('No usable Groq model found');
}

// Ask Groq which models this key can use, preferring our known-good ones and
// then any other general-purpose chat model (skipping audio / guard models).
async function pickModels() {
  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: 'Bearer ' + GROQ_KEY }
    });
    if (r.ok) {
      const d = await r.json();
      const ids = (d.data || []).map((m) => m.id);
      const has = new Set(ids);
      const preferred = MODEL_PREFS.filter((m) => has.has(m));
      const others = ids.filter((id) => !MODEL_PREFS.includes(id) && !/whisper|tts|guard|embed|vision/i.test(id));
      const list = preferred.concat(others);
      console.log('DEBUG all available model ids: ' + ids.join(', '));
      if (list.length) { console.log('Groq models to try: ' + list.slice(0, 4).join(', ') + (list.length > 4 ? ', ...' : '')); return list; }
    }
  } catch { /* fall back to the static list below */ }
  return MODEL_PREFS.slice();
}

async function callGroq(model, system, user) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, temperature: 0.2, max_tokens: 6000,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    })
  });
  if (!res.ok) throw new Error('Groq HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const data = await res.json();
  let raw = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();   // drop reasoning-model scratchpad
  console.log('DEBUG [' + model + '] finish=' + (data.choices && data.choices[0] && data.choices[0].finish_reason) + ' rawlen=' + raw.length + ' raw500=' + raw.slice(0, 500).replace(/\s+/g, ' '));
  const m = raw.match(/\{[\s\S]*"items"[\s\S]*\}/);
  const jsonStr = m ? m[0] : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  if (!jsonStr) throw new Error('No JSON in model reply');
  return JSON.parse(jsonStr);
}

async function main() {
  if (!APP_PW) {
    console.log('Newsletter refresh skipped: set the GMAIL_APP_PASSWORD repo secret to enable it.');
    return;
  }
  if (!GROQ_KEY) {
    console.log('Newsletter refresh skipped: set the GROQ_API_KEY repo secret to enable it.');
    return;
  }

  const feedPath = join(ROOT, 'data', 'feed.json');
  const feed = JSON.parse(await readFile(feedPath, 'utf8'));

  const emails = await fetchNewsletters();
  if (!emails.length) {
    console.log('No newsletters in the last 2 days.');
    return;
  }

  console.log('Newsletters in window: ' + emails.map((e) => e.source_id + ' (' + e.date.slice(0, 10) + ', ' + (e.text || '').length + ' chars)').join(', '));
  const result = await summarize(emails);
  console.log('Model proposed ' + ((result.items || []).length) + ' item(s): ' + ((result.items || []).map((it) => it.source_id + ':' + (it.title || '').slice(0, 40)).join(' | ') || 'none'));
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
