#!/usr/bin/env node
/**
 * Free cloud news refresh for 34thward.com, run by GitHub Actions every
 * morning (works even when the owner's computer is off, which was the point).
 *
 * It pulls public local-news RSS feeds - Block Club Chicago's ward-neighborhood
 * feeds plus WTTW, CBS, and ABC7 - filters for 34th Ward relevance, cleans the
 * summaries, merges them into data/feed.json, and rotates the daily Business
 * Spotlight. No Gmail, no API keys, no secrets, no cost. Pure fetch + Node.
 *
 * Politico Playbook and Axios Chicago are not here because their sites block
 * automated access; those come in through the newsletter route when set up.
 *
 * Node 20+ (built-in fetch). No npm install required.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (compatible; 34thward-bot/1.0; +https://34thward.com)';

// RSS feeds. Block Club neighborhood feeds are already ward-local (no keyword
// filter). Citywide outlets are filtered to ward-relevant items by keyword.
const FEEDS = [
  { source_id: 'blockclub', url: 'https://blockclubchicago.org/category/west-loop/feed/', local: true },
  { source_id: 'blockclub', url: 'https://blockclubchicago.org/category/loop/feed/', local: true },
  { source_id: 'blockclub', url: 'https://blockclubchicago.org/category/fulton-market/feed/', local: true },
  { source_id: 'blockclub', url: 'https://blockclubchicago.org/category/south-loop/feed/', local: true },
  { source_id: 'blockclub', url: 'https://blockclubchicago.org/category/near-west-side/feed/', local: true },
  { source_id: 'blockclub', url: 'https://blockclubchicago.org/category/downtown/feed/', local: true },
  { source_id: 'cbs', url: 'https://www.cbsnews.com/chicago/latest/rss/main', local: false },
  { source_id: 'abc7', url: 'https://abc7chicago.com/feed/', local: false }
];

const SOURCE_NAMES = {
  blockclub: 'Block Club Chicago',
  wttw: 'WTTW News',
  cbs: 'CBS News Chicago',
  abc7: 'ABC7 Chicago'
};

// Ward relevance for the citywide outlets.
const WARD_KEYWORDS = [
  'west loop', 'greektown', 'fulton market', 'fulton river', 'printers row',
  'south loop', 'near west side', 'west town', 'university village',
  'little italy', 'taylor street', 'randolph street', 'restaurant row',
  'willis tower', 'sears tower', 'union station', 'ogilvie', 'mary bartelme',
  'national hellenic', 'the loop', 'downtown chicago', '34th ward', 'wacker drive'
];

const ALLEGATION = /\b(arrest|charged|indict|lawsuit|sued|convicted|accused|alleged|fraud|assault|guilty|felony)\b/i;

// Curated spotlight rotation with a fallback photo and a ready blurb each, so
// the spotlight never depends on any outside service.
const SPOTLIGHT_POOL = [
  { name: 'Monteverde Restaurant & Pastificio', address: '1020 W. Madison St, West Loop', website: 'https://www.monteverdechicago.com/', image: 'https://monteverdechicago.com/wp-content/uploads/2023/09/Burrata-e-Ham-PB-4-scaled.jpg', blurb: 'Chef Sarah Grueneberg, a James Beard Award winner, turns out some of the country\'s most celebrated handmade pasta from an open pastificio counter on Madison Street. The cacio whey pepe and the ragu alla napoletana are neighborhood legends, and the bar pours a deep Italian wine list.' },
  { name: 'Sepia', address: '123 N. Jefferson St, West Loop', website: 'https://www.sepiachicago.com/', blurb: 'Set in a restored 1890s print shop, this Michelin-starred West Loop mainstay pairs refined American cooking with a warm, timeless room. It has been a special-occasion favorite in the neighborhood for well over a decade.' },
  { name: 'The Publican', address: '837 W. Fulton Market, Fulton Market', website: 'https://www.thepublicanrestaurant.com/', blurb: 'A beer-hall-style anchor of Fulton Market, The Publican built its name on oysters, house charcuterie, and pork served at long communal tables. It helped put the neighborhood on the map as a dining destination.' },
  { name: "Lou Mitchell's", address: '565 W. Jackson Blvd, West Loop', website: 'https://www.loumitchells.com/', image: 'images/lou-mitchells.jpg', blurb: 'A Chicago breakfast landmark at the original starting line of Route 66, serving since 1923. Lou Mitchell\'s is famous for double-yolk eggs, skillet omelettes served in the pan, and the free Milk Duds and donut holes handed out while you wait.' },
  { name: 'Green Street Smoked Meats', address: '112 N. Green St, West Loop', website: 'https://greenstreetmeats.com/', image: 'images/green-street-smoked-meats.jpg', blurb: 'Tucked down an alley off Green Street, this rollicking barbecue joint serves Texas-style brisket, ribs, and burnt ends by the pound on butcher paper. Cold beer, picnic tables, and a lively bar make it a West Loop staple.' },
  { name: "Formento's", address: '925 W. Randolph St, West Loop', website: 'https://www.formentos.com/', blurb: 'A love letter to Italian-American red-sauce classics on Randolph Street\'s Restaurant Row. Expect Sunday gravy, house pastas, and a chicken Parm that regulars swear by, all in a handsome, old-school room.' },
  { name: 'El Che Steakhouse & Bar', address: '845 W. Washington Blvd, West Loop', website: 'https://www.elchechicago.com/', blurb: 'An Argentine-inspired steakhouse where nearly everything touches the open hearth. The wood-fired grill, empanadas, and Malbec-heavy list have made it one of the West Loop\'s most distinctive rooms.' },
  { name: 'The Original Pancake House', address: '1124 W. Madison St, West Loop', website: 'https://ophchicagoland.com/', image: 'images/original-pancake-house.jpg', blurb: 'A breakfast institution since 1953, famous for the oven-baked Dutch Baby and apple pancakes. The West Loop location on Madison fills its striped-awning patio all summer long.' },
  { name: 'Bar Siena', address: '832 W. Randolph St, West Loop', website: 'https://www.barsiena.com/', blurb: 'A bustling Randolph Street trattoria known for wood-fired pizzas, house pastas, and a lively bar scene. Its patio is one of Restaurant Row\'s favorite warm-weather perches.' },
  { name: 'Gibsons Italia', address: '233 N. Canal St, Fulton River District', website: 'https://gibsonssteakhouse.com/italia/', blurb: 'The Italian-leaning riverside sibling of the classic Chicago steakhouse, with sweeping views of the Chicago River from the Fulton River District. Prime steaks, fresh pasta, and a see-and-be-seen patio.' }
];

function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    // Some feeds entity-encode (or double-encode) their HTML markup inside the
    // field, so turn &lt;tag&gt; (and &amp;lt;) back into real tags, then strip.
    .replace(/&amp;lt;/g, '<').replace(/&amp;gt;/g, '>')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#8217;|&#039;|&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/&#8211;|&ndash;|&#8212;|&mdash;|—|–/g, ' - ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;|&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>', 'i'));
  return m ? m[1] : '';
}

function firstSentences(text, max) {
  const clean = text.replace(/The post .*? appeared first on .*?\.?$/i, '').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (lastStop > 80 ? cut.slice(0, lastStop + 1) : cut).trim() + (lastStop > 80 ? '' : '...');
}

function categoryOf(text) {
  const t = text.toLowerCase();
  if (/\b(restaurant|bar |cafe|coffee|bakery|shop|store|opens|opening|closing|closed|brewery|market|boutique|business)\b/.test(t)) return 'business';
  if (/\b(alderman|city council|mayor|ward|ordinance|zoning|budget|election|candidate|referendum)\b/.test(t)) return 'elected_official';
  return 'civic_org';
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

async function fetchFeed(feed) {
  try {
    const r = await fetch(feed.url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' } });
    if (!r.ok) return [];
    const xml = await r.text();
    const items = xml.split(/<item[\s>]/i).slice(1).map((chunk) => '<item ' + chunk);
    const out = [];
    for (const block of items) {
      const title = decode(tag(block, 'title'));
      const link = decode(tag(block, 'link')).trim();
      const desc = decode(tag(block, 'description'));
      const pub = tag(block, 'pubDate').trim();
      if (!title || !link) continue;
      out.push({ source_id: feed.source_id, local: feed.local, title, link, desc, pub });
    }
    return out;
  } catch {
    return [];
  }
}

async function main() {
  const feedPath = join(ROOT, 'data', 'feed.json');
  const spotPath = join(ROOT, 'data', 'spotlight.json');
  const feed = JSON.parse(await readFile(feedPath, 'utf8'));
  const spot = JSON.parse(await readFile(spotPath, 'utf8'));

  const results = await Promise.all(FEEDS.map(fetchFeed));
  const raw = results.flat();

  const cutoff = Date.now() - 6 * 24 * 3600 * 1000;
  const seenTitle = new Set();
  const candidates = [];
  for (const it of raw) {
    const key = it.title.toLowerCase();
    if (seenTitle.has(key)) continue;
    seenTitle.add(key);
    const when = it.pub ? new Date(it.pub).getTime() : Date.now();
    if (isFinite(when) && when < cutoff) continue;
    const hay = (it.title + ' ' + it.desc).toLowerCase();
    if (!it.local && !WARD_KEYWORDS.some((k) => hay.includes(k))) continue;
    // Unattended automation must not publish accusations or legal claims as
    // fact (owner rule). When in doubt, leave it out - so skip, don't flag.
    if (ALLEGATION.test(it.title + ' ' + it.desc)) continue;
    const wardHit = WARD_KEYWORDS.some((k) => hay.includes(k)) ? 1 : 0;
    candidates.push({ ...it, when: isFinite(when) ? when : Date.now(), wardHit });
  }
  // Ward-specific stories lead; then most recent. Keeps the feed local-first.
  candidates.sort((a, b) => (b.wardHit - a.wardHit) || (b.when - a.when));

  const existingIds = new Set((feed.items || []).map((it) => it.id));
  const existingTK = new Set((feed.items || []).map((it) => (it.title || '').toLowerCase()));
  const existingUrl = new Set((feed.items || []).map((it) => it.url));

  let added = 0;
  const fresh = [];
  for (const c of candidates) {
    if (added >= 8) break;
    const id = `${c.source_id}-${new Date(c.when).toISOString().slice(0, 10).replace(/-/g, '')}-${slug(c.title)}`;
    if (existingIds.has(id) || existingTK.has(c.title.toLowerCase()) || existingUrl.has(c.link)) continue;
    existingIds.add(id); existingTK.add(c.title.toLowerCase()); existingUrl.add(c.link);
    const summary = firstSentences(c.desc || c.title, 300);
    fresh.push({
      id,
      category: categoryOf(c.title + ' ' + c.desc),
      source_id: c.source_id,
      source_name: SOURCE_NAMES[c.source_id] || c.source_id,
      source_type: 'web_feed',
      title: c.title,
      summary: summary || c.title,
      url: c.link,
      published_at: new Date(c.when).toISOString(),
      flagged_for_review: false
    });
    added++;
  }

  if (added) {
    feed.items = fresh.concat(feed.items || []);
    if (feed.items.length > 70) {
      const old = Date.now() - 21 * 24 * 3600 * 1000;
      feed.items = feed.items.filter((it, i) => i < 45 || new Date(it.published_at).getTime() > old);
    }
    feed.generated_at = new Date().toISOString();
    await writeFile(feedPath, JSON.stringify(feed, null, 1) + '\n');
  }

  // Rotate the spotlight (curated pool, skipping the recent ones).
  const recent = new Set([
    spot.current && spot.current.name,
    ...(spot.history || []).slice(-Math.min(30, SPOTLIGHT_POOL.length - 1)).map((h) => h.name)
  ].filter(Boolean));
  const pick = SPOTLIGHT_POOL.find((b) => !recent.has(b.name)) || SPOTLIGHT_POOL[0];
  if (spot.current) { spot.history = spot.history || []; spot.history.push(spot.current); }
  spot.current = {
    date: new Date().toISOString().slice(0, 10),
    name: pick.name, address: pick.address, website: pick.website,
    image: pick.image || '', blurb: pick.blurb
  };
  await writeFile(spotPath, JSON.stringify(spot, null, 1) + '\n');

  console.log(`News refresh: added ${added} item(s) from ${raw.length} feed entries; spotlight -> ${pick.name}.`);
}

main().catch((e) => {
  // Never fail the whole workflow just because news could not refresh.
  console.error('News refresh error (non-fatal):', e.message);
  process.exit(0);
});
