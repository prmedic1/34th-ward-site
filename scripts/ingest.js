#!/usr/bin/env node
/**
 * Daily ingestion job scaffold for 34thward.com.
 *
 * Intended flow once real sources/credentials are in place:
 *   1. Pull items from RSS feeds listed in data/sources.json.
 *   2. Pull newsletter emails from the dedicated intake inbox
 *      (via Gmail API, filtered by data/sources.json email_intake.gmail_search_query).
 *   3. Send each raw item to an LLM to extract {title, summary, category}
 *      and to flag anything matching moderation_rules.hold_for_review_if.
 *   4. Merge with existing data/feed.json (dedupe by source url + title),
 *      write the result back out.
 *   5. Deploy: for a static host (Netlify/Vercel/GitHub Pages), commit +
 *      push triggers a rebuild; for WordPress, POST to the REST API instead.
 *
 * Run on a schedule (cron, GitHub Actions, or a scheduled Claude task) once
 * wired up. Not runnable as-is: requires npm deps (e.g. `rss-parser`,
 * `googleapis`) and real credentials in data/sources.json.
 */

const fs = require('fs');
const path = require('path');

const SOURCES_PATH = path.join(__dirname, '..', 'data', 'sources.json');
const FEED_PATH = path.join(__dirname, '..', 'data', 'feed.json');

async function fetchRssItems(feed) {
  // Production: replace with the `rss-parser` npm package.
  const res = await fetch(feed.url);
  const xml = await res.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  return items.map((raw) => ({
    source_name: feed.name,
    category: feed.category,
    source_type: 'rss',
    title: extractTag(raw, 'title'),
    url: extractTag(raw, 'link'),
    raw_content: extractTag(raw, 'description'),
    published_at: extractTag(raw, 'pubDate') || new Date().toISOString()
  }));
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match ? match[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
}

async function fetchEmailItems(sourcesConfig) {
  // Production: use the Gmail API against sourcesConfig.email_intake.inbox_address,
  // filtered by gmail_search_query, to pull new messages since the last run.
  // Each message becomes a raw item, category inferred from the sender/subject
  // via the LLM summarization step below.
  return [];
}

async function summarizeAndCategorize(rawItem) {
  // Production: call an LLM with rawItem.raw_content to produce a clean
  // {title, summary} pair, confirm/correct the category, and set
  // flagged_for_review per moderation_rules in sources.json.
  return {
    id: `${rawItem.source_type}-${Buffer.from(rawItem.url || rawItem.title).toString('base64').slice(0, 10)}`,
    category: rawItem.category,
    source_name: rawItem.source_name,
    source_type: rawItem.source_type,
    title: rawItem.title,
    summary: (rawItem.raw_content || '').slice(0, 280),
    url: rawItem.url,
    published_at: rawItem.published_at,
    flagged_for_review: false
  };
}

async function run() {
  const sourcesConfig = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
  const existingFeed = JSON.parse(fs.readFileSync(FEED_PATH, 'utf8'));

  const rawItems = [];
  for (const feed of sourcesConfig.rss_feeds || []) {
    try {
      rawItems.push(...(await fetchRssItems(feed)));
    } catch (err) {
      console.error(`Failed to fetch ${feed.name}:`, err.message);
    }
  }
  rawItems.push(...(await fetchEmailItems(sourcesConfig)));

  const newItems = await Promise.all(rawItems.map(summarizeAndCategorize));

  const existingIds = new Set(existingFeed.items.map((i) => i.id));
  const merged = [...existingFeed.items, ...newItems.filter((i) => !existingIds.has(i.id))];

  fs.writeFileSync(
    FEED_PATH,
    JSON.stringify({ generated_at: new Date().toISOString(), items: merged }, null, 2)
  );

  console.log(`Ingest complete. ${newItems.length} new item(s) processed.`);
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
