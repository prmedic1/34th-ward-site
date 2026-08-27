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
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
  'qwen/qwen3.6-27b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'qwen/qwen3-32b',
  'gemma2-9b-it',
  'groq/compound',
  'groq/compound-mini'
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

const SYSTEM_PROMPT = 'You are the news editor for 34thward.com, a community news site for Chicago\'s 34th Ward (West Loop, Greektown, Fulton Market, the Loop, Printers Row, South Loop, near west side). You extract newsworthy items from ONE local newsletter at a time. Use ONLY facts stated in the newsletter text; never invent, infer, or add outside information, and never use web search. Output valid JSON only, no other text.';

// Summarize each newsletter on its OWN so every source (especially Axios, which
// tends to lose out when several are judged together) is guaranteed a fair look
// and its items are correctly attributed. Combining them all in one prompt made
// the model cherry-pick the easiest source and drop the rest.
async function summarize(emails) {
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  for (const e of emails) {
    const user = `Today is ${today}. Below is ONE newsletter: ${e.source_name}. Extract its 1 to 3 most newsworthy stories for a 34th Ward reader. Return at least one item unless the newsletter is purely administrative (for example "no newsletter this week").

How to choose: prefer stories about the ward's neighborhoods (West Loop, Greektown, Fulton Market, Printers Row, South Loop, near west side, the Loop). If none are ward-specific, pick this newsletter's single biggest story for a general Chicago audience, such as transit, housing, a development, a notable business opening or closing, schools, public safety, or taxes.

Rules:
- Extract only genuine current news (government, development, business openings or closings, public safety, housing, transit, schools, community issues). IGNORE routine newsletter filler: the weather, birthdays, horoscopes, "on this day in history" or trivia, staff chit-chat, sign-off notes, event-of-the-day or restaurant-of-the-day picks, obituaries of national celebrities, and advertisements.
- Use only facts explicitly in the newsletter text. Do not invent details or add anything from outside the text. No hedging words ("likely", "may", "probably").
- Summaries are 2 to 4 sentences, specific (names, addresses, dollar amounts, dates) drawn from the text.
- No em dashes anywhere; use commas or hyphens.
- Skip an item only if: it names a specific person tied to an allegation, arrest, lawsuit, or accusation; or it is an event whose date is before ${today}; or it is pure administrative filler.
- Do not center coverage on Ald. Bill Conway personally; report the community impact.
- Do not output two items about the same event.

Return ONLY this JSON and nothing else:
{"items":[{"category":"elected_official|business|civic_org|religious_org|newsletter","title":"headline, no em dashes","summary":"2 to 4 sentences, no em dashes"}]}

NEWSLETTER TEXT:
${e.text}`;
    let res;
    try {
      res = await callModelWithFallback(SYSTEM_PROMPT, user);
    } catch (err) {
      console.log(`Summarize failed for ${e.source_id}: ${err.message.slice(0, 120)}`);
      res = { items: [] };
    }
    const items = (res.items || []).slice(0, 3);
    // We know which newsletter this is, so stamp the source_id ourselves rather
    // than trusting the model to echo it back.
    items.forEach((it) => out.push({ ...it, source_id: e.source_id }));
    console.log(`  ${e.source_id}: ${items.length} item(s)` + (items.length ? ' - ' + items.map((it) => (it.title || '').slice(0, 45)).join(' | ') : ''));
  }
  return { items: out };
}

// Try our preferred models in order for a single prompt; fall through on any
// per-model failure OR an empty result, so one flaky/over-cautious model does
// not sink the whole run.
let MODELS_CACHE = null;
async function callModelWithFallback(system, user) {
  if (!MODELS_CACHE) MODELS_CACHE = await pickModels();
  let lastErr, lastResult;
  for (const model of MODELS_CACHE) {
    try {
      const result = await callGroq(model, system, user);
      if (result && Array.isArray(result.items) && result.items.length) return result;
      lastResult = result;
    } catch (e) {
      lastErr = e;
      console.log(`Groq model ${model} failed, trying next (${e.message.slice(0, 100)})`);
    }
  }
  if (lastResult) return lastResult;      // model ran but found nothing; valid empty
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
      const others = ids.filter((id) => !MODEL_PREFS.includes(id) && !/whisper|tts|guard|embed|vision|orpheus|allam|speech|audio/i.test(id));
      const list = preferred.concat(others);
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
      model, temperature: 0.2, max_tokens: 2500,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    })
  });
  if (!res.ok) throw new Error('Groq HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const data = await res.json();
  const msg0 = data.choices && data.choices[0] && data.choices[0].message;
  let raw = (msg0 && msg0.content) || '';
  raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();   // drop reasoning-model scratchpad
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
