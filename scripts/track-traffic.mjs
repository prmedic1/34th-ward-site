#!/usr/bin/env node
/**
 * Daily traffic logger for 34thward.com, run by GitHub Actions.
 *
 * Reads the anonymous Abacus counters (total page views + unique-ish
 * visitors), appends today's numbers to data/traffic-log.json, and rates the
 * day against the trailing week: "good" (well above usual), "usual", or
 * "bad" (well below usual). The owner asked for exactly that three-word
 * scale, nothing fancier.
 *
 * Node 20+ (built-in fetch). No secrets, no cost.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = join(ROOT, 'data', 'traffic-log.json');
const GET = 'https://abacus.jasoncameron.dev/get/34thward-com/';

async function readCounter(key) {
  try {
    const r = await fetch(GET + key);
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j.value === 'number' ? j.value : null;
  } catch {
    return null;
  }
}

async function main() {
  const total = await readCounter('total');
  const visitors = await readCounter('visitors');
  if (total == null) {
    console.log('Traffic: counter unreachable today (non-fatal).');
    return;
  }

  let log = [];
  try { log = JSON.parse(await readFile(LOG, 'utf8')); } catch { /* first run */ }
  if (!Array.isArray(log)) log = [];

  const today = new Date().toISOString().slice(0, 10);
  const prev = log.length ? log[log.length - 1] : null;
  if (prev && prev.date === today) log.pop(); // rerun same day: replace

  const last = log.length ? log[log.length - 1] : null;
  const viewsToday = last && typeof last.total === 'number' ? Math.max(0, total - last.total) : null;

  // Verdict vs the trailing week of daily views.
  const recent = log.map((d) => d.views).filter((v) => typeof v === 'number').slice(-7);
  let verdict = 'collecting';
  if (viewsToday != null && recent.length >= 3) {
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (avg < 1) verdict = viewsToday > 5 ? 'good' : 'usual';
    else if (viewsToday >= avg * 1.4) verdict = 'good';
    else if (viewsToday <= avg * 0.5) verdict = 'bad';
    else verdict = 'usual';
  }

  log.push({ date: today, total, visitors, views: viewsToday, verdict });
  if (log.length > 400) log = log.slice(-400);
  await writeFile(LOG, JSON.stringify(log, null, 1) + '\n');

  console.log(`Traffic: ${verdict}${viewsToday != null ? ` (${viewsToday} views yesterday-to-now, ${total} all-time)` : ` (baseline ${total} views logged)`}`);
}

main().catch((e) => {
  console.error('Traffic log error (non-fatal):', e.message);
  process.exit(0);
});
