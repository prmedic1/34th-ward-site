#!/usr/bin/env node
/**
 * Park-cleanup refresh for 34thward.com (Community Meetings box).
 *
 * Reads the Chicago Parks Foundation's weekly "Meet Me in the Parks" email
 * (info@chicagoparksfoundation.org) over Gmail IMAP, parses the "Pitch In for
 * the Parks" volunteer cleanups (trash pick-ups / mulching), keeps only the ones
 * at parks in or around the 34th Ward, and merges them into data/meetings.json
 * as entries tagged {"src":"cpf"} (replacing the previous cpf entries each run).
 * Every hand-curated meeting is left untouched.
 *
 * Reuses the same Gmail IMAP secret as refresh-newsletters.mjs (GMAIL_APP_PASSWORD,
 * optional GMAIL_ADDRESS). Fail-safe: if the secret is missing, the email isn't
 * found, or nothing parses, it exits WITHOUT changing meetings.json (never blanks
 * the section or ships wrong data).
 *
 * Node 20+, dep: imapflow, mailparser (installed by the workflow).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GMAIL = process.env.GMAIL_ADDRESS || 'chicagojustice@gmail.com';
const APP_PW = process.env.GMAIL_APP_PASSWORD || '';
const SENDER = 'info@chicagoparksfoundation.org';

// Parks in the 34th Ward AND the neighborhoods that border it. Scope is downtown
// plus its surrounding areas (owner-directed 2026-09-14: "widen it to include the
// surrounding areas"), deliberately NOT the whole city - far neighborhoods like
// Avondale, Logan Square, Uptown, and Hyde Park are left out. Match is a
// case-insensitive substring of the park name in the email. To widen or narrow,
// add or remove names here. Use full, specific names (e.g. "South Lincoln Park",
// not "Lincoln Park", which would also match the miles-long north lakefront park).
const NEARBY_PARKS = [
  // In the 34th Ward: West Loop, Greektown, Loop, Printers Row, South Loop, Near West Side, Little Italy
  'Printers Row', 'Grant Park', 'Maggie Daley', 'Millennium Park', 'Mary Bartelme',
  'Skinner Park', 'Union Park', 'Heritage Green', 'Adams Playground', 'Touhy Herbert',
  'Arrigo', 'Dearborn Park', 'Coliseum Park', "Women's Park",
  // Museum Campus / near-downtown lakefront
  'Northerly Island', 'Burnham Park',
  // Near North, Gold Coast, River North, Streeterville
  'Washington Square Park', 'Seward Park', 'Connors Park', 'Lake Shore Park',
  'Jane Addams', 'Olive Park', 'Montgomery Ward Park', 'South Lincoln Park',
  // West Town / Noble Square (northwest border)
  'Eckhart Park', 'Smith Park',
  // Pilsen / Lower West Side (southwest border)
  'Harrison Park', 'Dvorak Park',
  // Chinatown, Armour Square, Bridgeport (south border)
  'Ping Tom', 'Armour Square Park', 'Palmisano Park', 'McGuane Park',
  // Bronzeville / Douglas / Near South (southeast border)
  'Ellis Park', 'Dunbar Park', 'Mandrake Park'
];

function startTime(range) {
  const r = String(range).replace(/\s/g, '').replace(/[–—]/g, '-');
  const [a, b] = r.split('-');
  const per = (s) => ((s || '').match(/(AM|PM)/i) || [])[1];
  const m = (a || '').match(/(\d{1,2})(?::(\d{2}))?/);
  if (!m) return '';
  const p = (per(a) || per(b) || 'PM').toUpperCase();
  return `${+m[1]}:${m[2] || '00'} ${p}`;
}

// Parse the "Pitch In" cleanups out of the weekly email's plain text. Exported so
// the parsing can be tested without a live mailbox.
export function parseCleanups(text, emailDate) {
  // Isolate the Pitch In section (cleanups) from the Wellness Walks section.
  let seg = text;
  const startIdx = seg.search(/pitch-?in/i);
  const endIdx = seg.search(/\/walk\b|Wellness Walk/i);
  if (startIdx >= 0) seg = seg.slice(startIdx, endIdx > startIdx ? endIdx : undefined);
  // Flatten the Mailchimp markdown markers to plain text.
  const flat = seg.replace(/\*\*/g, ' ').replace(/-{3,}/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n');
  const year = (emailDate instanceof Date ? emailDate : new Date(emailDate)).getFullYear();
  // Groups: 1 month, 2 day, 3 park, 4 partner/crew, 5 activity, 6 time range, 7 register url.
  const re = /(\d{1,2})\/(\d{1,2})\s+(.+?)\s+with\s+(.+?)\s+Activity:\s*([A-Za-z][A-Za-z\- ]*?)\s+([\d:]{1,5}\s*(?:AM|PM)?\s*[–—-]\s*[\d:]{1,5}\s*(?:AM|PM))\s+REGISTER\s*\(?\s*(https?:\/\/[^\s)]+)/gi;
  const out = []; let m;
  while ((m = re.exec(flat))) {
    const mon = +m[1], day = +m[2];
    if (mon < 1 || mon > 12 || day < 1 || day > 31) continue;
    const park = m[3].trim().replace(/\s+/g, ' ');
    if (!NEARBY_PARKS.some((w) => park.toLowerCase().includes(w.toLowerCase()))) continue;
    let y = year;
    let date = `${y}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    // Year roll for a late-December email listing early-January dates.
    if (new Date(date) < new Date((emailDate instanceof Date ? emailDate.getTime() : Date.parse(emailDate)) - 45 * 864e5)) {
      y += 1; date = `${y}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    const partner = m[4].trim().replace(/\s+/g, ' ');
    const activity = m[5].trim().toLowerCase();
    const withCrew = partner ? ` with the ${partner}` : '';
    out.push({
      title: `${park} Cleanup`,
      date,
      time: startTime(m[6]),
      org: 'Chicago Parks Foundation',
      location: park,
      desc: `A neighborhood ${activity}${withCrew}, part of the Chicago Parks Foundation's Pitch In for the Parks program. Supplies provided; register to join.`,
      url: m[7].replace(/[.)]+$/, ''),
      src: 'cpf'
    });
  }
  // De-dupe by date+title.
  const seen = new Set();
  return out.filter((e) => { const k = e.date + '|' + e.title; if (seen.has(k)) return false; seen.add(k); return true; });
}

async function latestEmailText() {
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: GMAIL, pass: APP_PW }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const since = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    let uids;
    try { uids = await client.search({ since, from: SENDER }); } catch { uids = []; }
    if (!uids || !uids.length) return null;
    for await (const msg of client.fetch(uids.slice(-1), { source: true })) {
      const p = await simpleParser(msg.source);
      const text = (p.text || p.html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;|&rsquo;/gi, "'");
      return { text, date: p.date || new Date() };
    }
  } finally { lock.release(); }
  await client.logout();
  return null;
}

async function main() {
  if (!APP_PW) { console.error('Parks: GMAIL_APP_PASSWORD not set; leaving meetings unchanged.'); return; }
  let email;
  try { email = await latestEmailText(); }
  catch (e) { console.error('Parks: Gmail read failed (' + e.message + '); leaving meetings unchanged.'); return; }
  if (!email) { console.error('Parks: no recent Parks Foundation email found; leaving meetings unchanged.'); return; }

  const cleanups = parseCleanups(email.text, email.date);
  if (!cleanups.length) { console.error('Parks: no ward-area cleanups parsed; leaving meetings unchanged.'); return; }

  const path = join(ROOT, 'data', 'meetings.json');
  const data = JSON.parse(await readFile(path, 'utf8'));
  const kept = (data.meetings || []).filter((m) => m.src !== 'cpf');
  data.meetings = kept.concat(cleanups).sort((a, b) => a.date.localeCompare(b.date));
  data.updated_at = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  await writeFile(path, JSON.stringify(data, null, 1) + '\n');
  console.log(`Parks: set ${cleanups.length} ward cleanup(s): ${cleanups.map((c) => c.date + ' ' + c.title).join('; ')}.`);
}

main();
