/*
 * Refresh the Tiny Tapp riverwalk live-music schedule on the events calendar
 * from the venue's own page (tinytapp.com/live-music), so the riverwalk shows
 * stay current automatically instead of being hand-curated.
 *
 * Tiny Tapp runs on Squarespace: each upcoming show renders as a summary item
 * carrying data-title plus a visible "Month D, YYYY H:MM AM/PM - H:MM AM/PM"
 * datetime. We parse those, then replace ONLY the cat:"riverwalk" entries in
 * data/events_week.json, leaving every other venue's hand-curated entries
 * untouched. Fail-safe: if the fetch breaks or nothing parses, we leave the
 * file unchanged rather than blank the section (never show wrong/empty over real).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'https://www.tinytapp.com/live-music';
const VENUE = 'Tiny Tapp & Cafe';
const ADDRESS = '55 W. Riverwalk South, the Loop';
const MONTHS = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };

function decodeEntities(s) {
  let out = String(s);
  // Squarespace double-encodes ampersands (&amp;amp;), so unescape until stable.
  while (out.includes('&amp;')) out = out.replace(/&amp;/g, '&');
  return out
    .replace(/&#39;|&rsquo;|&#8217;/g, '’')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  let html;
  try {
    const res = await fetch(SRC, { headers: { 'User-Agent': 'Mozilla/5.0 (34thward.com events bot)' } });
    if (!res.ok) { console.error('Tiny Tapp fetch HTTP ' + res.status + '; leaving the calendar unchanged.'); return; }
    html = await res.text();
  } catch (e) {
    console.error('Tiny Tapp fetch failed:', e.message, '- leaving the calendar unchanged.');
    return;
  }

  const todayCentral = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const blocks = html.split('summary-item-record-type-event').slice(1);
  const shows = [];
  const seen = new Set();
  for (const p of blocks) {
    const tM = p.match(/data-title="([^"]*)"/);
    if (!tM) continue;
    const title = decodeEntities(tM[1]);
    const txt = p.slice(0, 3000).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&')
      .replace(/–|&#8211;|&ndash;/g, '-').replace(/\s+/g, ' ');
    const dM = txt.match(/([A-Z][a-z]+) (\d{1,2}), (\d{4}) (\d{1,2}:\d{2})\s*([AP]M)/);
    if (!dM) continue;
    const mon = MONTHS[dM[1]];
    if (!mon) continue;
    const date = dM[3] + '-' + String(mon).padStart(2, '0') + '-' + String(+dM[2]).padStart(2, '0');
    if (date < todayCentral) continue; // upcoming shows only
    const key = date + '|' + title;
    if (seen.has(key)) continue;
    seen.add(key);
    shows.push({ title, venue: VENUE, cat: 'riverwalk', date, time: dM[4] + ' ' + dM[5], address: ADDRESS, note: 'Free live music', local: true, url: SRC });
  }

  if (!shows.length) { console.error('Tiny Tapp: no upcoming shows parsed; leaving the calendar unchanged.'); return; }

  const path = join(ROOT, 'data', 'events_week.json');
  const data = JSON.parse(await readFile(path, 'utf8'));
  const before = data.shows.filter((s) => s.cat === 'riverwalk').length;
  const others = data.shows.filter((s) => s.cat !== 'riverwalk');
  data.shows = others.concat(shows).sort((a, b) => a.date.localeCompare(b.date));
  data.updated_at = todayCentral;

  // Serialize one show per line to match the hand-maintained file's format.
  const keys = Object.keys(data);
  let out = '{\n';
  keys.forEach((k, i) => {
    const comma = i < keys.length - 1 ? ',' : '';
    if (k === 'shows') {
      out += ' "shows": [\n' + data.shows.map((s) => '  ' + JSON.stringify(s)).join(',\n') + '\n ]' + comma + '\n';
    } else {
      out += ' ' + JSON.stringify(k) + ': ' + JSON.stringify(data[k]) + comma + '\n';
    }
  });
  out += '}\n';
  await writeFile(path, out);
  console.log(`Tiny Tapp: riverwalk shows ${before} -> ${shows.length} (${shows.map((s) => s.date + ' ' + s.title).join('; ')}).`);
}

main();
