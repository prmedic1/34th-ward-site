#!/usr/bin/env node
/**
 * Builds data/venue_links.json: a website (and, where findable, a happy-hour
 * or menu page) for each venue on the happy hour page.
 *
 * The happy hour spreadsheet has no website column, so websites come from
 * OpenStreetMap via the free Overpass API - no key, no billing, unlike Google
 * Places. Venue names are matched EXACTLY (after lowercasing and stripping
 * punctuation) and never fuzzily: a near-match once pointed "Arabella" at
 * "Arbella", a different bar, and sending readers to a competitor's site is
 * exactly the kind of public mistake this site cannot afford.
 *
 * Every URL that lands in the output has been fetched and confirmed reachable.
 *
 * This is slow (a few minutes) and the data changes rarely, so it is NOT part
 * of the daily refresh. Run it by hand every month or two:
 *     node scripts/refresh-venue-links.mjs
 *
 * Node 20+ (built-in fetch). No npm install required.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = '34thward-bot/1.0 (https://34thward.com; community news site)';
const OVERPASS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];

const norm = (s) =>
  s.toLowerCase().replace(/&/g, ' and ').replace(/['’‘`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();

async function overpassVenues() {
  // Small tiles: one query over the whole city reliably times out (504).
  const tiles = [];
  for (let lat = 41.78; lat < 42.02; lat += 0.06) {
    for (let lon = -87.75; lon < -87.58; lon += 0.06) {
      tiles.push([lat, lon, Math.min(lat + 0.06, 42.02), Math.min(lon + 0.06, -87.58)]);
    }
  }
  const found = new Map();
  for (const [s, w, n, e] of tiles) {
    const q = `[out:json][timeout:60];nwr["amenity"~"^(bar|pub|restaurant|cafe|fast_food|biergarten)$"](${s},${w},${n},${e});out tags;`;
    for (const ep of OVERPASS) {
      try {
        const r = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
          body: 'data=' + encodeURIComponent(q)
        });
        if (!r.ok) continue;
        const j = await r.json();
        for (const el of j.elements || []) {
          const t = el.tags || {};
          const site = t.website || t['contact:website'];
          if (t.name && site && /^https?:\/\//i.test(site)) {
            const k = norm(t.name);
            if (k && !found.has(k)) found.set(k, site);
          }
        }
        break;
      } catch { /* try the next endpoint */ }
    }
    await new Promise((r) => setTimeout(r, 1000)); // be polite to a free service
  }
  return found;
}

async function getHtml(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    return ct.includes('text/html') ? { html: await r.text(), url: r.url } : { html: '', url: r.url };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Prefer a happy-hour page, then a menu page, else the homepage itself.
function pickDeepLink(html, baseUrl) {
  const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)];
  const scored = [];
  for (const [, href, inner] of anchors) {
    const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const h = href.toLowerCase();
    if (/^(mailto:|tel:|javascript:)/.test(h)) continue;
    let score = 0;
    if (/happy[\s-]?hour/.test(text)) score = 100;
    else if (/happy[\s-]?hour/.test(h)) score = 90;
    else if (/^menus?$|\bmenus?\b/.test(text)) score = 50;
    else if (/\/menus?(\/|$|\?)/.test(h)) score = 40;
    if (score) scored.push({ score, href });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  try {
    return new URL(scored[0].href, baseUrl).href;
  } catch {
    return null;
  }
}

async function mapWithLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

async function main() {
  const sheetPath = join(ROOT, 'data', 'happy_hours_sheet.json');
  const sheet = JSON.parse(await readFile(sheetPath, 'utf8'));
  const names = [...new Set(sheet.deals.map((d) => d.name).filter(Boolean))];

  console.log(`Looking up websites for ${names.length} venues via OpenStreetMap...`);
  const osm = await overpassVenues();
  console.log(`OpenStreetMap returned ${osm.size} Chicago venues with a website.`);

  const matched = names
    .map((name) => ({ name, site: osm.get(norm(name)) }))
    .filter((v) => v.site);
  console.log(`Exact name matches: ${matched.length}. Verifying each is reachable...`);

  const links = {};
  let live = 0, dead = 0, deep = 0;
  await mapWithLimit(matched, 8, async (v) => {
    const res = await getHtml(v.site);
    if (!res) { dead++; return; }
    live++;
    const entry = { site: res.url };
    const menu = res.html ? pickDeepLink(res.html, res.url) : null;
    if (menu && menu !== res.url) { entry.menu = menu; deep++; }
    links[v.name] = entry;
  });

  console.log(`Reachable: ${live}, unreachable (dropped): ${dead}, with a happy-hour/menu page: ${deep}`);
  await writeFile(
    join(ROOT, 'data', 'venue_links.json'),
    JSON.stringify({
      generated_at: new Date().toISOString(),
      source: 'OpenStreetMap (Overpass API), exact name match, each URL verified reachable',
      links
    }, null, 1) + '\n'
  );
  console.log(`Wrote data/venue_links.json with ${Object.keys(links).length} venues.`);
}

main().catch((err) => { console.error('Venue link refresh failed:', err.message); process.exit(1); });
