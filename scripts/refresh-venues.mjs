/*
 * Refresh concert-venue entries on the events calendar from each venue's own
 * site. Only venues with reliable, structured data are automated here; each
 * updates ONLY its own cat:"concert" entries (matched by venue name) and every
 * other venue's hand-curated entries are left alone. Per-venue fail-safe: if a
 * fetch breaks or nothing parses, that venue's existing entries are kept.
 *
 * Automated so far:
 *   - Huntington Bank Pavilion (schema.org MusicEvent JSON-LD in the page)
 * Not automatable by a no-browser bot (JS-rendered or fragile markup), still
 * hand-maintained: Salt Shed (DICE widget), City Winery, The Chicago Theatre
 * (MSG React app), Garcia's. A keyed events API (e.g. Ticketmaster Discovery)
 * would be the reliable way to add those.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' } };

const centralDate = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const centralTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
const cleanTitle = (s) => String(s).split(':')[0].replace(/\s+/g, ' ').trim();

// Pull schema.org Event / MusicEvent objects out of a page's JSON-LD blocks.
function ldEvents(html) {
  const out = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let j; try { j = JSON.parse(m[1]); } catch (e) { continue; }
    for (const x of (Array.isArray(j) ? j : [j])) if (/Event/.test(x['@type'] || '')) out.push(x);
  }
  return out;
}

const VENUES = [
  {
    name: 'Huntington Bank Pavilion',
    url: 'https://www.huntingtonbankpavilion.com/shows',
    address: '1300 S. Linn White Dr, Northerly Island',
    local: true,
    fallback: 'https://www.huntingtonbankpavilion.com/shows',
    parse(html, todayStr, endStr, V) {
      const out = [];
      for (const e of ldEvents(html)) {
        if (!e.startDate || !e.name) continue;
        const date = centralDate(e.startDate);
        if (date < todayStr || date > endStr) continue;
        out.push({
          title: cleanTitle(e.name), venue: V.name, cat: 'concert', date,
          time: centralTime(e.startDate), address: V.address, local: V.local,
          url: (typeof e.url === 'string' && /^https?:/.test(e.url)) ? e.url : V.fallback
        });
      }
      return out;
    }
  }
];

async function main() {
  const today = new Date();
  const end = new Date(); end.setDate(end.getDate() + 45);
  const todayStr = today.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const endStr = end.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

  const fetched = {}; const failed = new Set();
  for (const V of VENUES) {
    try {
      const res = await fetch(V.url, UA);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rows = V.parse(await res.text(), todayStr, endStr, V);
      if (!rows.length) throw new Error('no events parsed');
      fetched[V.name] = rows;
    } catch (err) {
      failed.add(V.name);
      console.error(`Venues: ${V.name} failed (${err.message}); keeping existing entries.`);
    }
  }

  const managed = new Set(VENUES.map((v) => v.name));
  const path = join(ROOT, 'data', 'events_week.json');
  const data = JSON.parse(await readFile(path, 'utf8'));
  const kept = data.shows.filter((s) => !(s.cat === 'concert' && managed.has(s.venue) && !failed.has(s.venue)));
  const added = VENUES.filter((v) => !failed.has(v.name)).flatMap((v) => fetched[v.name] || []);
  data.shows = kept.concat(added).sort((a, b) => a.date.localeCompare(b.date));
  data.updated_at = todayStr;

  const keys = Object.keys(data);
  let out = '{\n';
  keys.forEach((k, i) => {
    const comma = i < keys.length - 1 ? ',' : '';
    if (k === 'shows') out += ' "shows": [\n' + data.shows.map((s) => '  ' + JSON.stringify(s)).join(',\n') + '\n ]' + comma + '\n';
    else out += ' ' + JSON.stringify(k) + ': ' + JSON.stringify(data[k]) + comma + '\n';
  });
  out += '}\n';
  await writeFile(path, out);
  console.log(`Venues: added ${added.length} show(s) across ${VENUES.length - failed.size} venue(s); ${failed.size} kept as-is.`);
}

main();
