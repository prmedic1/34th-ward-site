#!/usr/bin/env node
/**
 * Hands-off daily data refresh, run by GitHub Actions (no credentials needed).
 * Refreshes the two data sources that come from public APIs:
 *   1. Mayor's-race Kalshi odds  -> data/mayor_race.json
 *   2. Happy-hour Google Sheet   -> data/happy_hours_sheet.json (fallback snapshot)
 *
 * The Gmail-sourced news Front Page and the Business Spotlight are NOT touched
 * here (they need Gmail access + AI summarization) - those are handled by the
 * assisted daily task. This script only updates deterministic public data.
 *
 * Node 20+ (built-in fetch). No npm install required.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const nowIso = () => {
  // Central time ISO with offset (approx; -05:00 CDT). Good enough for a timestamp label.
  return new Date().toISOString();
};

async function refreshKalshi() {
  const path = join(ROOT, 'data', 'mayor_race.json');
  const data = JSON.parse(await readFile(path, 'utf8'));
  // KXCHICAGOMAYOR-27 is the newer, higher-volume Kalshi event (15 candidate
  // markets) - not the older thin KXMAYORCHI-27.
  const res = await fetch(
    'https://api.elections.kalshi.com/trade-api/v2/markets?event_ticker=KXCHICAGOMAYOR-27&limit=100',
    { headers: { Accept: 'application/json' } }
  );
  if (!res.ok) throw new Error('Kalshi HTTP ' + res.status);
  const { markets = [] } = await res.json();

  // Kalshi's names differ slightly from ours; normalize + alias.
  const norm = (s) => (s || '').trim().toLowerCase().replace(/^dr\.\s+/, '');
  const ALIAS = new Map([
    ['matt brewer', 'matthew brewer'],
    ['susan mendoza', 'susana mendoza']
  ]);
  const byName = new Map();
  for (const m of markets) {
    let name = norm(m.yes_sub_title);
    if (ALIAS.has(name)) name = ALIAS.get(name);
    const price = parseFloat(m.last_price_dollars);
    // price of exactly 0 means the market has never traded - not a real signal
    if (name && !Number.isNaN(price) && price > 0) byName.set(name, Math.round(price * 1000) / 10);
  }

  // Manifold Markets (play-money, thin volume - low weight sanity check)
  const manifold = new Map();
  try {
    const mr = await fetch('https://api.manifold.markets/v0/slug/who-will-win-the-2027-chicago-mayor');
    if (mr.ok) {
      const md = await mr.json();
      for (const ans of md.answers || []) {
        let name = norm(ans.text);
        if (ALIAS.has(name)) name = ALIAS.get(name);
        const p = Math.round(ans.probability * 1000) / 10;
        if (name && p > 0) manifold.set(name, p);
      }
    }
  } catch { /* keep stored manifold_raw on network failure */ }

  // Blend: weighted average of the win-probability sources. Kalshi gets 3x
  // (real-money, freshest), PredictionEdge and Manifold 1x each. pe_raw is
  // refreshed by the assisted daily task. Candidates with no market anywhere
  // get a 0.5% floor, then everything is normalized so the 13 tracked
  // candidates sum to exactly 100%.
  const FLOOR = 0.5;
  const W_KALSHI = 3, W_PE = 1, W_MANIFOLD = 1;
  let changed = 0;
  for (const c of data.candidates) {
    const hit = byName.get(norm(c.name));
    if (hit != null && c.kalshi_raw !== hit) {
      c.kalshi_raw = hit;
      changed++;
    }
    const mHit = manifold.get(norm(c.name));
    if (mHit != null) c.manifold_raw = mHit;
  }
  const rawVals = data.candidates.map((c) => {
    let sum = 0, w = 0;
    if (typeof c.kalshi_raw === 'number') { sum += c.kalshi_raw * W_KALSHI; w += W_KALSHI; }
    if (typeof c.pe_raw === 'number') { sum += c.pe_raw * W_PE; w += W_PE; }
    if (typeof c.manifold_raw === 'number') { sum += c.manifold_raw * W_MANIFOLD; w += W_MANIFOLD; }
    return w ? sum / w : FLOOR;
  });
  const total = rawVals.reduce((a, b) => a + b, 0);
  data.candidates.forEach((c, i) => {
    c.pct = Math.round((rawVals[i] * 100 / total) * 10) / 10;
  });
  // nudge the leader so displayed percentages sum to exactly 100.0
  const sumPct = data.candidates.reduce((a, c) => a + c.pct, 0);
  const leader = data.candidates.reduce((a, c) => (c.pct > a.pct ? c : a));
  leader.pct = Math.round((leader.pct + (100 - sumPct)) * 10) / 10;

  data.updated_at = nowIso();
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
  console.log(`Kalshi: ${markets.length} markets, ${changed} raw odds changed; blended pct renormalized to 100.`);
}

// Minimal RFC-4180-ish CSV parser
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function refreshHappyHours() {
  const path = join(ROOT, 'data', 'happy_hours_sheet.json');
  const existing = JSON.parse(await readFile(path, 'utf8'));
  const res = await fetch(existing.sheet_csv);
  if (!res.ok) throw new Error('Sheet HTTP ' + res.status);
  const rows = parseCsv(await res.text());
  const header = rows.shift().map((h) => h.trim());
  const idx = (n) => header.indexOf(n);
  const iName = idx('Restaurant'), iHood = idx('Location'), iDays = idx('Days'),
    iStart = idx('Start Time'), iEnd = idx('End Time'), iDeal = idx('Deal'),
    iOys = idx('Oyster Deals'), iPatio = idx('Outside Dining'), iGf = idx('GF Safe Snacks'),
    iCui = idx('Cuisine'), iAppr = idx('Elizabeth Approved');

  const deals = rows
    .filter((r) => (r[iName] || '').trim())
    .map((r) => ({
      name: (r[iName] || '').trim(),
      hood: (r[iHood] || '').trim(),
      days: (r[iDays] || '').split(',').map((s) => s.trim()).filter(Boolean),
      start: (r[iStart] || '').trim(),
      end: (r[iEnd] || '').trim(),
      deal: (r[iDeal] || '').trim(),
      specials: false,
      oysters: !!(r[iOys] || '').trim(),
      patio: (r[iPatio] || '').trim(),
      gf: (r[iGf] || '').trim(),
      cuisine: (r[iCui] || '').trim(),
      approved: !!(r[iAppr] || '').trim()
    }));

  existing.snapshot_at = nowIso();
  existing.deals = deals;
  await writeFile(path, JSON.stringify(existing, null, 1) + '\n');
  console.log(`Happy hours: snapshot refreshed with ${deals.length} venues.`);
}

let failed = false;
for (const [label, fn] of [['Kalshi', refreshKalshi], ['HappyHours', refreshHappyHours]]) {
  try { await fn(); }
  catch (e) { failed = true; console.error(`${label} failed:`, e.message); }
}
process.exit(failed ? 1 : 0);
