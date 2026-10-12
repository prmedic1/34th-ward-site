#!/usr/bin/env node
/**
 * Indie-venue concert refresh for 34thward.com's events calendar, for venues that
 * are NOT on Ticketmaster (so scripts/refresh-tm-venues.mjs can't reach them).
 *
 * Runs AFTER refresh-tm-venues.mjs in the daily workflow and only manages its own
 * venues' cat:"concert" entries (matched by venue name), leaving the Ticketmaster
 * concerts and everything else in data/events_week.json untouched.
 *
 * Automated here:
 *   - Lincoln Hall (DICE-ticketed; its site lh-st.com runs WordPress and exposes a
 *     clean public REST API at /wp-json/wp/v2/shows with an ACF "venue" field that
 *     separates Lincoln Hall from its sister rooms Schubas / Color Club).
 *   - City Winery Chicago (sells through its own vivenu box office, so it's thin on
 *     Ticketmaster). Its Shopify events page builds its calendar from a public JSON
 *     API, awsapi.citywinery.com/api/events?location=Chicago, which returns
 *     schema.org Event objects with a genre list. Wine dinners, tastings, tours and
 *     member pickup parties are skipped - they aren't shows. When this succeeds it
 *     replaces the few City Winery shows Ticketmaster supplied; when it fails, the
 *     Ticketmaster ones stay as a fallback.
 *     (The RSS/iCal feeds the page still advertises at api.citywinery.com/feeds/ are
 *     dead - 404 as of 2026-10-12.)
 *
 * Fail-safe: a broken fetch or zero parsed shows leaves the existing entries alone.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' } };
const DAYS = 21;

function decode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&#0?38;/g, '&')
    .replace(/&#8217;|&#039;|&#39;|&rsquo;/g, "'").replace(/&#8216;|&lsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s*[–—]\s*/g, ' - ') // site rule: no em/en dashes
    .replace(/\s+/g, ' ').trim();
}

// "02/12/2027 8:00 pm" -> { date: "2027-02-12", time: "8:00 PM" }
function parseShowDateTime(s) {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([ap]m)/i);
  if (!m) return null;
  const date = m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
  const time = (+m[4]) + ':' + m[5] + ' ' + m[6].toUpperCase();
  return { date, time };
}

// Pull every "shows" post from lh-st.com, paging until the last page.
async function fetchLhShows() {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch('https://lh-st.com/wp-json/wp/v2/shows?per_page=100&page=' + page, UA);
    if (!res.ok) {
      if (res.status === 400) break; // past the last page
      throw new Error('HTTP ' + res.status);
    }
    const arr = await res.json();
    if (!Array.isArray(arr) || !arr.length) break;
    out.push(...arr);
    if (arr.length < 100) break;
  }
  return out;
}

async function lincolnHall(todayStr, endStr) {
  const all = await fetchLhShows();
  const rows = [];
  const seen = new Set();
  for (const s of all) {
    const f = s.acf || {};
    const venue = (f.venue && f.venue.post_title) || '';
    if (venue !== 'Lincoln Hall') continue;
    const dt = parseShowDateTime(f.date_and_time_of_show);
    if (!dt || dt.date < todayStr || dt.date > endStr) continue;
    let title = decode((f.headliner && f.headliner[0] && f.headliner[0].post_title) || (s.title && s.title.rendered) || '');
    title = title.replace(/^\d{2}-\d{2}-\d{4}\s+/, '');
    if (title.length > 75) title = title.slice(0, 72).replace(/\s+\S*$/, '') + '...';
    if (!title) continue;
    const key = dt.date + '|' + dt.time + '|' + title;
    if (seen.has(key)) continue; seen.add(key);
    rows.push({
      title, venue: 'Lincoln Hall', cat: 'concert', date: dt.date, time: dt.time,
      address: '2424 N. Lincoln Ave, Lincoln Park', local: false,
      url: s.link || 'https://lh-st.com/lincoln-hall/'
    });
  }
  return rows;
}

// City Winery's own events API (the same one its citywinery.com calendar uses).
async function fetchCwEvents() {
  const base = 'https://awsapi.citywinery.com/api/events?location=Chicago&pageSize=100';
  const out = [];
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, 10); page++) {
    const res = await fetch(base + '&page=' + page, UA);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if (!Array.isArray(j.events)) throw new Error('unexpected response shape');
    out.push(...j.events);
    totalPages = +j.totalPages || 1;
  }
  return out;
}

// Title backstop for non-show events whose genre isn't tagged Wine. Kept narrow on
// purpose: a bare "tour" or "class" would also catch real concerts ("Farewell Tour").
const CW_NOT_A_SHOW = /winery tour|wine tasting|pickup party|vinofile|wine dinner|blending/i;

async function cityWinery(todayStr, endStr) {
  const all = await fetchCwEvents();
  const rows = [];
  const seen = new Set();
  for (const e of all) {
    const genres = (e.genre || []).map(String);
    if (genres.some((g) => /^wine/i.test(g))) continue;
    if (/Cancelled|Postponed|Rescheduled/i.test(e.eventStatus || '')) continue;
    let title = decode(e.name);
    if (!title || CW_NOT_A_SHOW.test(title) || /DUMMY|TEST/.test(title)) continue;
    const start = new Date(e.startDate);
    if (isNaN(start)) continue;
    const date = start.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    if (date < todayStr || date > endStr) continue;
    const time = start.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).replace(/\s/g, ' '); // newer Node puts a narrow no-break space before AM/PM
    if (title.length > 75) title = title.slice(0, 72).replace(/\s+\S*$/, '') + '...';
    const key = date + '|' + time + '|' + title;
    if (seen.has(key)) continue; seen.add(key);
    rows.push({
      title, venue: 'City Winery Chicago', cat: 'concert', date, time,
      address: '1200 W. Randolph St, West Loop', local: true,
      url: e.url || 'https://citywinery.com/pages/events/chicago'
    });
  }
  return rows;
}

async function main() {
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const endStr = new Date(now.getTime() + DAYS * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

  // Each managed venue is a {name, fn}; fn returns its concert rows or throws.
  const VENUES = [
    { name: 'Lincoln Hall', fn: lincolnHall },
    { name: 'City Winery Chicago', fn: cityWinery }
  ];
  const added = []; const okNames = [];
  for (const V of VENUES) {
    try {
      const rows = await V.fn(todayStr, endStr);
      if (rows.length) { added.push(...rows); okNames.push(V.name); }
      else console.error('Indie venues: ' + V.name + ' returned 0 upcoming shows; leaving its entries unchanged.');
    } catch (err) {
      console.error('Indie venues: ' + V.name + ' failed (' + err.message + '); leaving its entries unchanged.');
    }
  }
  if (!okNames.length) { console.error('Indie venues: nothing to update.'); return; }

  const path = join(ROOT, 'data', 'events_week.json');
  const d = JSON.parse(await readFile(path, 'utf8'));
  // Replace only the managed venues we successfully refreshed; keep all else.
  const managed = new Set(okNames);
  d.shows = (d.shows || []).filter((s) => !(s.cat === 'concert' && managed.has(s.venue)))
    .concat(added)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
  d.updated_at = todayStr;

  const keys = Object.keys(d);
  let out = '{\n';
  keys.forEach((k, i) => {
    const comma = i < keys.length - 1 ? ',' : '';
    if (k === 'shows') out += ' "shows": [\n' + d.shows.map((s) => '  ' + JSON.stringify(s)).join(',\n') + '\n ]' + comma + '\n';
    else out += ' ' + JSON.stringify(k) + ': ' + JSON.stringify(d[k]) + comma + '\n';
  });
  out += '}\n';
  await writeFile(path, out);
  console.log('Indie venues: wrote ' + added.length + ' show(s) for ' + okNames.join(', ') + '.');
}

main();
