#!/usr/bin/env node
/**
 * Concert/venue refresh for 34thward.com's events calendar, via the free
 * Ticketmaster Discovery API. Replaces the old per-venue scrapers: the venues we
 * care about are JS-rendered (Salt Shed/DICE, City Winery, Thalia Hall, Lincoln
 * Hall) and can't be scraped server-side, but Ticketmaster carries them all in
 * one keyed API that the daily runner CAN reach (unlike ESPN, TM does not block
 * datacenter IPs).
 *
 * Pulls upcoming events (next ~21 days) for a fixed list of venue IDs and writes
 * them as the cat:"concert" entries in data/events_week.json. Every other entry
 * (riverwalk / Tiny Tapp, etc.) is left untouched. Sports are fetched live in the
 * browser (culture.html) and are not in this file.
 *
 * Needs the repo secret TICKETMASTER_KEY (a free Discovery API "Consumer Key").
 * Fail-safe: if the key is missing or the API is unreachable, the file is left
 * unchanged (never blanks the concert list).
 *
 * Coverage note (2026-10-05): TM carries Chicago Theatre, Thalia Hall, Salt Shed,
 * Metro, Garcia's, Huntington well; City Winery and Lincoln Hall are THIN on TM
 * (they sell mostly through their own system / DICE), so those two may show only a
 * few shows until a second source is added.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.TICKETMASTER_KEY || '';
const DAYS = 21;

// Venue friendly name + Ticketmaster venue id(s) + address + West-Loop flag (the
// gold star marks West Loop events only). Multiple ids map to one friendly venue.
const VENUES = [
  { name: 'Huntington Bank Pavilion', ids: ['KovZpZAEA7IA'], address: '1300 S. Linn White Dr, Northerly Island', local: false },
  { name: 'The Chicago Theatre',      ids: ['KovZpZA6AJ6A'], address: '175 N. State St, the Loop',               local: false },
  { name: 'The Salt Shed',            ids: ['KovZ917AI5F', 'KovZ917Amf0'], address: '1357 N. Elston Ave, Goose Island', local: false },
  { name: 'City Winery Chicago',      ids: ['KovZpZAE667A'], address: '1200 W. Randolph St, West Loop',          local: true },
  { name: 'Thalia Hall',              ids: ['KovZpZAJntvA'], address: '1807 S. Allport St, Pilsen',              local: false },
  { name: 'Lincoln Hall',             ids: ['KovZpZAdldtA'], address: '2424 N. Lincoln Ave, Lincoln Park',       local: false },
  { name: 'Metro',                    ids: ['KovZpaoMXe'],   address: '3730 N. Clark St, Wrigleyville',          local: false },
  { name: "Garcia's Chicago",         ids: ['KovZ917AY3o'],  address: '1001 W. Washington Blvd, West Loop',      local: true }
];

function fmtTime(localTime) {
  if (!localTime) return '';
  const m = String(localTime).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  let h = +m[1]; const min = m[2]; const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return h + ':' + min + ' ' + ap;
}

function cleanTitle(name) {
  let s = String(name || '').split(/\s+presented by\s+/i)[0].replace(/\s+/g, ' ').trim();
  if (s.length > 80) s = s.slice(0, 77).replace(/\s+\S*$/, '') + '...';
  return s;
}

async function fetchVenue(id, startStr, endStr) {
  const url = 'https://app.ticketmaster.com/discovery/v2/events.json?apikey=' + encodeURIComponent(KEY) +
    '&venueId=' + id + '&sort=date,asc&size=60&startDateTime=' + startStr + '&endDateTime=' + endStr;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return (data._embedded && data._embedded.events) || [];
}

async function main() {
  if (!KEY) { console.error('TM venues: TICKETMASTER_KEY not set; leaving concerts unchanged.'); return; }
  const now = new Date();
  const end = new Date(now.getTime() + DAYS * 864e5);
  const startStr = now.toISOString().slice(0, 19) + 'Z';
  const endStr = end.toISOString().slice(0, 19) + 'Z';
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const endLocal = end.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

  const rows = []; const seen = new Set(); let okVenues = 0;
  for (const V of VENUES) {
    let events = [];
    try {
      for (const id of V.ids) events = events.concat(await fetchVenue(id, startStr, endStr));
      okVenues++;
    } catch (err) {
      console.error('TM venues: ' + V.name + ' failed (' + err.message + ').');
      continue;
    }
    for (const e of events) {
      const s = (e.dates && e.dates.start) || {};
      const date = s.localDate;
      if (!date || date < todayStr || date > endLocal) continue;
      const time = fmtTime(s.localTime);
      const key = V.name + '|' + date + '|' + time; // one show per venue+date+time
      if (seen.has(key)) continue; seen.add(key);
      const url = (e.url && /ticketmaster\.com/.test(e.url)) ? e.url : (e.url || V.ids[0]);
      rows.push({ title: cleanTitle(e.name), venue: V.name, cat: 'concert', date, time, address: V.address, local: V.local, url });
    }
  }

  if (!okVenues) { console.error('TM venues: all venue lookups failed; leaving concerts unchanged.'); return; }

  const path = join(ROOT, 'data', 'events_week.json');
  const d = JSON.parse(await readFile(path, 'utf8'));
  const kept = (d.shows || []).filter((s) => s.cat !== 'concert');
  d.shows = kept.concat(rows).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
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
  console.log('TM venues: wrote ' + rows.length + ' concert(s) across ' + okVenues + '/' + VENUES.length + ' venues.');
}

main();
