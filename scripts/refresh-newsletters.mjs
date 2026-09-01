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
function buildUserPrompt(e, today) {
  return `Today is ${today}. Below is ONE newsletter: ${e.source_name}, a Chicago news publication that in every edition contains multiple real stories (its lead item is usually marked "1 big thing" or numbered "1.", "2."). Your job: return its single most prominent story, plus up to 2 more if they are worthwhile, as a 34th Ward reader would want them. You MUST return at least one item; returning an empty list is only acceptable if the entire text is administrative notices with no stories at all, which for this publication is essentially never.

How to choose: prefer stories about the ward's neighborhoods (West Loop, Greektown, Fulton Market, Printers Row, South Loop, near west side, the Loop). If none are ward-specific, pick this newsletter's single biggest story for a general Chicago audience, such as transit, housing, a development, a notable business opening or closing, schools, public safety, or taxes.

Rules:
- Prefer hard news (government, development, business openings or closings, public safety, housing, transit, schools, community issues). But a substantive FEATURE or trend story also counts as a real item: a growing local food or business trend, a neighborhood culture story, a notable new or expanding venue. On a light-news day, still return the newsletter's single most interesting story even if it is a food or culture feature (for example "Yemeni coffeehouses are spreading across Chicago"). A news newsletter like Axios or Block Club almost always has at least one real story, so an empty list is rarely correct for them.
- Do NOT return items for pure filler: the weather, birthdays, horoscopes, "on this day in history" trivia, staff chit-chat or sign-offs, the newsletter's own parties, events, or anniversaries, reader-poll roundups (for example a "best hot dog" reader-recommendation list), obituaries of national celebrities, and advertisements.
- Use only facts explicitly in the newsletter text. Do not invent details or add anything from outside the text. No hedging words ("likely", "may", "probably").
- Summaries are 2 to 4 sentences, specific (names, addresses, dollar amounts, dates) drawn from the text.
- No em dashes anywhere; use commas or hyphens.
- Skip an item only if: it names a specific person tied to an allegation, arrest, lawsuit, or accusation; or it is an event whose date is before ${today}; or it is pure administrative filler.
- Do not center coverage on Ald. Bill Conway personally; report the community impact.
- Do not output two items about the same event.

Write the real headline and summary you compose; do NOT copy these field names or placeholders. Return ONLY a JSON object of exactly this shape and nothing else:
{"items":[{"category":"business","title":"...","summary":"..."}]}
category must be one of: elected_official, business, civic_org, religious_org, newsletter. If you have no real story to report for this newsletter, return {"items":[]}.

NEWSLETTER TEXT:
${e.text}`;
}

async function summarize(emails) {
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  const runOne = async (e, isRetry, exclude) => {
    let res;
    try {
      res = await callModelWithFallback(SYSTEM_PROMPT, buildUserPrompt(e, today), exclude);
    } catch (err) {
      res = { items: [], rateLimited: /rate limit|429|too large/i.test(err.message), model: null };
    }
    const items = (res.items || []).slice(0, 3);
    // We stamp the source_id ourselves rather than trust the model to echo it.
    items.forEach((it) => out.push({ ...it, source_id: e.source_id }));
    console.log(`  ${isRetry ? '(retry) ' : ''}${e.source_id}: ${items.length} item(s)` + (items.length ? ' - ' + items.map((it) => (it.title || '').slice(0, 45)).join(' | ') : ''));
    return { got: items.length > 0, rateLimited: !!res.rateLimited, model: res.model };
  };
  // First pass. A substantial newsletter (Axios, WCA, Conway...) that comes back
  // empty gets a second chance: if it was rate-limited, a pause lets the quota
  // reset; if a model just returned nothing, retry EXCLUDING that model so a
  // different one can mine it. This is what keeps Axios refreshing daily.
  const pending = [];
  for (const e of emails) {
    const r = await runOne(e, false);
    if (!r.got && (r.rateLimited || (e.text || '').length > 2500)) {
      pending.push({ e, exclude: r.rateLimited ? null : r.model });
    }
  }
  if (pending.length) {
    console.log(`Retrying ${pending.length} newsletter(s) after a pause: ${pending.map((p) => p.e.source_id).join(', ')}`);
    await new Promise((r) => setTimeout(r, 30000));
    for (const { e, exclude } of pending) await runOne(e, true, exclude);
  }
  return { items: out };
}

// Try our preferred models for a single prompt, but keep the number of Groq
// calls LOW to stay under the free-tier rate limits: once a model has answered
// this run, reuse it first for every later newsletter (1 call each) instead of
// walking the whole list every time. Only fall through on a real failure.
let MODELS_CACHE = null;
let WORKING_MODEL = null;
async function callModelWithFallback(system, user, excludeModel) {
  if (!MODELS_CACHE) MODELS_CACHE = await pickModels();
  let order = WORKING_MODEL
    ? [WORKING_MODEL, ...MODELS_CACHE.filter((m) => m !== WORKING_MODEL)]
    : [...MODELS_CACHE];
  if (excludeModel) order = order.filter((m) => m !== excludeModel);   // on retry, force a different model
  let attempted = false, allRateLimited = true;
  for (const model of order) {
    try {
      const result = await callGroq(model, system, user);
      WORKING_MODEL = model;   // this model responded; prefer it for the rest of the run
      // A successful-but-empty result is a valid "nothing in this newsletter".
      return { items: (result && result.items) || [], rateLimited: false, model };
    } catch (e) {
      attempted = true;
      if (!/rate limit|429|too large|request entity too large/i.test(e.message)) allRateLimited = false;
      console.log(`Groq model ${model} failed, trying next (${e.message.slice(0, 100)})`);
    }
  }
  // Every model failed. Flag whether it was purely rate-limiting, so the caller
  // knows this newsletter is worth retrying after a pause (vs. a real error).
  return { items: [], rateLimited: attempted && allRateLimited, model: null };
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
    // Never publish an item where the model echoed the prompt's placeholders,
    // leaked schema tokens, or emitted hollow "no details" filler instead of a
    // real story. This is the safety net that keeps that junk off the site.
    const _t = it.title.trim(), _s = it.summary.trim();
    const junk = /no em dashes|2 to 4 sentences|\byour (headline|summary)\b|headline you write|\bsource_id\b|elected_official\s*\||no additional details|not (provided|specified|stated|mentioned|available) in the newsletter|newsletter does not (say|provide|specify|mention)/i;
    const templateEcho = /^(\.{2,}|title|summary|headline|<[^>]*>)\.?$/i;
    if (junk.test(_t) || junk.test(_s) || templateEcho.test(_t) || templateEcho.test(_s)) {
      console.log('Skipped placeholder/hollow item: ' + JSON.stringify(_t).slice(0, 70));
      continue;
    }
    if (_t.length < 10 || _s.length < 30) {
      console.log('Skipped too-short item: ' + JSON.stringify(_t).slice(0, 70));
      continue;
    }
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
