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
  { source_id: 'abc7', url: 'https://abc7chicago.com/feed/', local: false },
  { source_id: 'eater', url: 'https://chicago.eater.com/rss/index.xml', local: false },
  // Ward Watch: a daily Google News sweep of the wider web for anything that
  // mentions the 34th Ward by name, whatever outlet wrote it. The when:7d is
  // required - without it Google returns relevance-ranked articles from years
  // ago. local:false so the ward-keyword filter below still applies: Google's
  // phrase matching is loose, and unattended publishing should stay strict.
  { source_id: 'wardwatch', url: 'https://news.google.com/rss/search?q=%2234th+Ward%22+Chicago+when%3A7d&hl=en-US&gl=US&ceid=US:en', local: false }
];

const SOURCE_NAMES = {
  blockclub: 'Block Club Chicago',
  cbs: 'CBS News Chicago',
  abc7: 'ABC7 Chicago',
  eater: 'Eater Chicago',
  wardwatch: 'Ward Watch'
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

// Curated spotlight rotation. Every entry has a real, verified local photo so
// the spotlight ALWAYS shows a picture. The rotation cycles through the whole
// list before any business repeats.
const SPOTLIGHT_POOL = [
  { name: 'Monteverde Restaurant & Pastificio', address: '1020 W. Madison St, West Loop', website: 'https://www.monteverdechicago.com/', image: 'images/spotlight/monteverde.jpg', blurb: 'Chef Sarah Grueneberg, a James Beard Award winner, turns out some of the country\'s most celebrated handmade pasta from an open pastificio counter on Madison Street. The cacio whey pepe and the ragu alla napoletana are neighborhood legends, and the bar pours a deep Italian wine list.' },
  { name: 'Au Cheval', address: '800 W. Randolph St, West Loop', website: 'https://www.auchevalchicago.com/', image: 'images/spotlight/au-cheval.jpg?v=20260903', blurb: 'The dark, clubby diner behind what many call the best cheeseburger in America. The wait on Randolph Street is legendary, the bologna sandwich and the eggs are worth it, and the whole room hums well past midnight.' },
  { name: 'Girl & the Goat', address: '809 W. Randolph St, West Loop', website: 'https://www.girlandthegoat.com/chicago/', image: 'images/spotlight/girl-and-the-goat.jpg?v=20260903', blurb: 'Chef Stephanie Izard\'s flagship put Randolph Street\'s Restaurant Row on the national map. The wood-fired, globally-spiced small plates, from the famous goat empanadas to the pan-fried shishito peppers, still pack the room nightly.' },
  { name: 'Sepia', address: '123 N. Jefferson St, West Loop', website: 'https://www.sepiachicago.com/', image: 'images/spotlight/sepia.jpg', blurb: 'Set in a restored 1890s print shop, this Michelin-starred West Loop mainstay pairs refined American cooking with a warm, timeless room. It has been a special-occasion favorite in the neighborhood for well over a decade.' },
  { name: 'The Publican', address: '837 W. Fulton Market, Fulton Market', website: 'https://www.thepublicanrestaurant.com/', image: 'images/spotlight/the-publican.jpg', blurb: 'A beer-hall-style anchor of Fulton Market built on oysters, house charcuterie, and pork served at long communal tables. Its farm-focused cooking helped turn the old meatpacking district into a dining destination.' },
  { name: "Lou Mitchell's", address: '565 W. Jackson Blvd, West Loop', website: 'https://www.loumitchells.com/', image: 'images/lou-mitchells.jpg', blurb: 'A Chicago breakfast landmark at the original starting line of Route 66, serving since 1923. Lou Mitchell\'s is famous for double-yolk eggs, skillet omelettes served in the pan, and the free Milk Duds and donut holes handed out while you wait.' },
  { name: "Bavette's Bar & Boeuf", address: '218 W. Kinzie St, River North edge', website: 'https://www.bavetteschicago.com/', image: 'images/spotlight/bavettes.jpg?v=20260903', blurb: 'A candlelit, 1920s-style steakhouse just north of the ward with a jazz soundtrack and deep leather booths. The dry-aged steaks, roasted bone marrow, and towering chocolate cake keep it perennially hard to book.' },
  { name: 'Green Street Smoked Meats', address: '112 N. Green St, West Loop', website: 'https://greenstreetmeats.com/', image: 'images/green-street-smoked-meats.jpg', blurb: 'Tucked down an alley off Green Street, this rollicking barbecue joint serves Texas-style brisket, ribs, and burnt ends by the pound on butcher paper. Cold beer, picnic tables, and a lively bar make it a West Loop staple.' },
  { name: "Formento's", address: '925 W. Randolph St, West Loop', website: 'https://www.formentos.com/', image: 'images/spotlight/formentos.jpg', blurb: 'A love letter to Italian-American red-sauce classics on Restaurant Row. Sunday gravy, house pastas, and a chicken Parm that regulars swear by, all in a handsome, old-school room.' },
  { name: 'The Original Pancake House', address: '1124 W. Madison St, West Loop', website: 'https://ophchicagoland.com/', image: 'images/original-pancake-house.jpg', blurb: 'A breakfast institution since 1953, famous for the oven-baked Dutch Baby and apple pancakes. The West Loop location on Madison fills its striped-awning patio all summer long.' },
  { name: 'El Che Steakhouse & Bar', address: '845 W. Washington Blvd, West Loop', website: 'https://www.elchechicago.com/', image: 'images/spotlight/el-che.jpg?v=20260903', blurb: 'An Argentine-inspired steakhouse where nearly everything touches the open hearth. The wood-fired grill, empanadas, and Malbec-heavy list make it one of the West Loop\'s most distinctive rooms.' },
  { name: 'Bar Siena', address: '832 W. Randolph St, West Loop', website: 'https://www.barsiena.com/', image: 'images/spotlight/bar-siena.jpg?v=20260903', blurb: 'A bustling Randolph Street trattoria known for wood-fired pizzas, house pastas, and a lively bar. Its patio is one of Restaurant Row\'s favorite warm-weather perches.' },
  { name: 'Gibsons Italia', address: '233 N. Canal St, Fulton River District', website: 'https://gibsonssteakhouse.com/italia/', image: 'images/spotlight/gibsons-italia.jpg?v=20260903', blurb: 'The Italian-leaning riverside sibling of the classic Chicago steakhouse, with sweeping views of the Chicago River. Prime steaks, fresh pasta, and a see-and-be-seen patio.' },
  { name: 'J.P. Graziano Grocery', address: '901 W. Randolph St, West Loop', website: 'https://www.jpgraziano.com/', image: 'images/spotlight/jp-graziano.jpg?v=20260903', blurb: 'A century-old Italian importer and sandwich counter on Randolph Street. The Mr. G, a stacked Italian sub with sharp provolone and hot giardiniera, has a devoted citywide following.' },
  { name: "Mario's Italian Lemonade", address: '1068 W. Taylor St, Little Italy', website: 'https://www.facebook.com/MariosItalianLemonade/', image: 'images/marios-italian-lemonade.webp', blurb: 'A Taylor Street summer institution since 1954, Mario\'s is the little red-and-green stand where Chicagoans line up for hand-shaved Italian lemonade. Cash only, open only in the warm months, and worth every minute of the wait.' },
  { name: 'Publican Quality Meats', address: '825 W. Fulton Market, Fulton Market', website: 'https://www.publicanqualitymeats.com/', image: 'images/spotlight/publican-quality-meats.jpg?v=20260903', blurb: 'The butcher shop, bakery, and sandwich cafe next to The Publican. Grab a pastrami or porchetta sandwich, a loaf of bread, and house-cured meats to take home.' },
  { name: 'Swift & Sons', address: '1000 W. Fulton Market, Fulton Market', website: 'https://www.swiftandsonschicago.com/', image: 'images/spotlight/swift-and-sons.avif', blurb: 'A grand, brass-and-leather steakhouse in a former cold-storage building, anchoring the Fulton Market dining scene. Dry-aged steaks, a raw bar, and a soaring room built for a night out.' },
  { name: 'H Mart West Loop', address: '711 W. Jackson Blvd, West Loop', website: 'https://www.hmart.com/', image: 'images/spotlight/h-mart.jpg?v=20260903', blurb: 'The beloved Korean-American grocery chain\'s downtown Chicago store, stocking fresh produce, seafood, kimchi, and hard-to-find pantry staples from across Asia. The food hall upstairs draws a lunch crowd from all over the Loop.' },
  { name: 'Open Books West Loop', address: '651 W. Lake St, West Loop', website: 'https://www.open-books.org/', image: 'images/spotlight/open-books.jpg?v=20260903', blurb: 'A nonprofit used bookstore where every purchase funds literacy programs for Chicago students. Tens of thousands of donated titles line the shelves, and volunteers keep the mission running.' },
  { name: 'CrossTown Fitness', address: '1031 W. Madison St, West Loop', website: 'https://www.crosstownfitness.com/', image: 'images/spotlight/crosstown-fitness.jpg?v=20260903', blurb: 'A locally owned gym on Madison Street known for high-energy group classes, personal training, and a neighborhood feel that big chains cannot match. A West Loop fixture for over a decade.' },
  { name: 'Madison Street Books', address: '1127 W. Madison St, West Loop', website: 'https://www.madstreetbooks.com/', image: 'images/spotlight/madison-street-books.jpg?v=20260903', blurb: 'The West Loop\'s independent bookstore, with a thoughtfully curated selection, a resident shop dog, and a steady calendar of author events and book clubs. A cozy neighborhood anchor on Madison Street.' },
  { name: 'Capitol Hill Cleaners', address: '305 S. Desplaines St, West Loop', website: 'https://www.yelp.com/biz/capitol-hill-cleaners-chicago', image: 'images/spotlight/capitol-hill-cleaners.jpg?v=20260903', blurb: 'A family-run dry cleaner that West Loop and Greektown neighbors have trusted for years with everything from suits to wedding dresses. Friendly counter service and quick turnarounds keep the regulars loyal.' },
  { name: 'Avec', address: '615 W. Randolph St, West Loop', website: 'https://www.avecrestaurant.com/', image: 'images/spotlight/avec.jpg?v=2', blurb: 'One of Restaurant Row\'s originals, a warm cedar-lined room serving Mediterranean small plates from a wood oven at long communal tables. The chorizo-stuffed dates are a Chicago rite of passage.' },
  { name: 'Cruz Blanca Brewery & Taqueria', address: '904 W. Randolph St, West Loop', website: 'https://www.cruzblanca.com/', image: 'images/spotlight/cruz-blanca.jpg?v=20260903', blurb: 'Rick Bayless\'s West Loop taqueria and brewery, pairing wood-grilled tacos and Oaxacan flavors with house-brewed beer and agave cocktails.' },
  { name: 'Rose Mary', address: '932 W. Fulton Market, Fulton Market', website: 'https://www.rosemarychicago.com/', image: 'images/spotlight/rose-mary.jpg?v=20260903', blurb: 'Top Chef winner Joe Flamm\'s Adriatic cooking, a lively mash-up of Italian and Croatian, from handmade pastas to wood-grilled meats on Fulton Market.' },
  { name: 'Duck Duck Goat', address: '857 W. Fulton Market, Fulton Market', website: 'https://www.duckduckgoatchicago.com/', image: 'images/spotlight/duck-duck-goat.jpg?v=20260903', blurb: 'Stephanie Izard\'s playful Chinese restaurant, with hand-pulled noodles, dim sum, and Peking duck in a bustling, mural-lined room.' },
  { name: 'The Aviary', address: '955 W. Fulton Market, Fulton Market', website: 'https://www.theaviary.com/', image: 'images/spotlight/the-aviary.jpg?v=20260903', blurb: 'The Alinea Group\'s avant-garde cocktail lounge, where drinks arrive as edible art and the menu of cocktails is unlike anywhere else in the city.' },
  { name: 'City Winery', address: '1200 W. Randolph St, West Loop', website: 'https://citywinery.com/chicago/', image: 'images/spotlight/city-winery.jpg?v=20260903', blurb: 'An urban winery, restaurant, and intimate live-music venue on Randolph Street, making wine on site and hosting concerts on the riverfront patio.' },
  { name: 'Greek Islands', address: '200 S. Halsted St, Greektown', website: 'https://www.greekislands.net/', image: 'images/spotlight/greek-islands.jpg?v=20260903', blurb: 'A Greektown institution since 1971, packed nightly for flaming saganaki, roast lamb, and warm hospitality across a big, bustling dining room.' },
  { name: 'Athena Greek Restaurant', address: '212 S. Halsted St, Greektown', website: 'https://athenarestaurantchicago.com/', image: 'images/spotlight/athena.jpg?v=20260903', blurb: 'A Greektown mainstay known for classic taverna cooking and one of the neighborhood\'s largest garden patios, framed by Parthenon-style columns.' },
  { name: 'Roister', address: '951 W. Fulton Market, Fulton Market', website: 'https://www.roisterrestaurant.com/', image: 'images/spotlight/roister.jpg?v=20260903', blurb: 'The Alinea Group\'s rowdy, open-kitchen restaurant, famous for its whole fried chicken and a counter that puts you right in the fire.' },
  { name: 'Smyth + The Loyalist', address: '177 N. Ada St, West Loop', website: 'https://www.smythandtheloyalist.com/', image: 'images/spotlight/smyth-loyalist.jpg?v=20260903', blurb: 'Two restaurants in one: the two-Michelin-star Smyth upstairs, and downstairs The Loyalist, home to what many call Chicago\'s best burger.' },
  { name: 'Federales', address: '180 N. Morgan St, Fulton Market', website: 'https://www.federaleschicago.com/', image: 'images/spotlight/federales.jpg?v=20260903', blurb: 'Tacos, frozen margaritas, and one of Fulton Market\'s liveliest open-air patios, packed all summer long.' },
  { name: 'Bonci Pizzeria', address: '161 N. Sangamon St, West Loop', website: 'https://bonci.com/', image: 'images/spotlight/bonci.jpg?v=20260903', blurb: 'The Chicago outpost of Rome\'s famous pizza al taglio, sold by the rectangular slice and priced by weight, with ever-changing toppings.' },
  { name: 'The Berghoff', address: '17 W. Adams St, the Loop', website: 'https://www.theberghoff.com/', image: 'images/spotlight/the-berghoff.jpg?v=20260903', blurb: 'Chicago\'s historic German restaurant, serving Wiener schnitzel, house root beer, and steins of beer in the Loop since 1898.' },
  { name: 'Eleven City Diner', address: '1112 S. Wabash Ave, South Loop', website: 'https://www.elevencitydiner.com/', image: 'images/spotlight/eleven-city-diner.jpg?v=20260826', blurb: 'A classic Jewish-style deli and soda fountain in the South Loop, stacked with pastrami, matzo ball soup, and old-fashioned egg creams.' },
  { name: 'Italian Village', address: '71 W. Monroe St, the Loop', website: 'https://www.italianvillage-chicago.com/', image: 'images/spotlight/italian-village.jpg?v=20260827', blurb: 'Three Italian restaurants under one roof in the Loop, serving since 1927. From the old-world Village upstairs to the refined Vivere, it is a downtown institution.' },
  { name: "Miller's Pub", address: '134 S. Wabash Ave, the Loop', website: 'https://www.millerspub.com/', image: 'images/spotlight/millers-pub.jpg?v=20260828', blurb: 'A Loop institution open late since 1935, known for baby back ribs, steaks, and a classic wood-paneled bar hung with celebrity photos.' },
  { name: 'The Gage', address: '24 S. Michigan Ave, the Loop', website: 'https://www.thegagechicago.com/', image: 'images/spotlight/the-gage.jpg?v=20260903', blurb: 'A handsome gastropub across from Millennium Park, pairing elevated pub fare and game dishes with a deep beer and whiskey list.' },
  { name: 'Russian Tea Time', address: '77 E. Adams St, the Loop', website: 'https://www.russianteatime.com/', image: 'images/spotlight/russian-tea-time.jpg?v=20260903', blurb: 'An old-world restaurant beside the Art Institute, famous for borscht, blini, and a long list of house-infused vodkas served in a jewel-box room.' },
  { name: "Tufano's Vernon Park Tap", address: '1073 W. Vernon Park Pl, Little Italy', website: 'https://www.yelp.com/biz/tufanos-vernon-park-tap-chicago', image: 'images/spotlight/tufanos.jpg?v=20260903', blurb: 'A family-run Italian tavern serving Taylor Street since 1930, with no printed menu, hearty pastas, and a cash-only, old-Chicago charm.' },
  { name: "Al's #1 Italian Beef", address: '1079 W. Taylor St, Little Italy', website: 'https://www.alsbeef.com/', image: 'images/spotlight/als-beef.jpg?v=20260902', blurb: 'The original stand where the Italian beef sandwich was born in 1938, still slinging dipped beefs with hot giardiniera on Taylor Street.' },
  { name: 'Rosebud', address: '1500 W. Taylor St, Little Italy', website: 'https://www.rosebudrestaurants.com/', image: 'images/spotlight/rosebud.jpg?v=20260903', blurb: 'The flagship of the Taylor Street Italian institution since 1976, plating big portions of chicken Vesuvio, cavatelli, and old-school red sauce.' },
  { name: 'Pompei', address: '1531 W. Taylor St, Little Italy', website: 'https://www.pompeius.com/', image: 'images/spotlight/pompei.jpg?v=20260903', blurb: 'A Little Italy bakery and Italian counter since 1909, known for square strudel-crust pizza, baked pastas, and Italian ices.' },
  { name: 'Conte di Savoia', address: '1438 W. Taylor St, Little Italy', website: 'https://www.contedisavoia.com/', image: 'images/spotlight/conte-di-savoia.jpg?v=20260903', blurb: 'A beloved Italian and European specialty grocer on Taylor Street, stocked with imported pastas, cheeses, olive oils, and made-to-order sandwiches.' },
  { name: "Manny's Cafeteria & Delicatessen", address: '1141 S. Jefferson St, Near West Side', website: 'https://www.mannysdeli.com/', image: 'images/spotlight/mannys-deli.jpg?v=20260903', blurb: 'A Chicago Jewish deli institution since 1942, sliding trays down the line for towering corned beef, matzo ball soup, and potato pancakes.' },
  { name: "Kasey's Tavern", address: '701 S. Dearborn St, Printers Row', website: 'https://www.kaseystavern.com/', image: 'images/spotlight/kaseys-tavern.jpg?v=20260903', blurb: 'A cozy neighborhood bar anchoring Printers Row since 1990, with a solid beer list and an easy after-work crowd.' },
  { name: 'National Hellenic Museum', address: '333 S. Halsted St, Greektown', website: 'https://www.nationalhellenicmuseum.org/', image: 'images/spotlight/national-hellenic-museum.jpg?v=20260903', blurb: 'Greektown\'s museum of the Greek American experience, with rotating exhibits, a rooftop with skyline views, and a busy calendar of events.' },
  { name: 'WNDR Museum', address: '1130 W. Monroe St, West Loop', website: 'https://www.wndrmuseum.com/', image: 'images/spotlight/wndr-museum.jpg?v=20260903', blurb: 'An immersive art and technology museum in the West Loop, packed with light rooms, mirror installations, and a famous infinity room.' }
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
  }
  // Always refresh the timestamp so the site's "Last updated" reflects that
  // the site ran today, even on a quiet day with no brand-new stories.
  feed.generated_at = new Date().toISOString();
  await writeFile(feedPath, JSON.stringify(feed, null, 1) + '\n');

  // Rotate the spotlight - AT MOST ONCE PER CHICAGO DAY, never repeating a
  // business until every one in the pool has had its turn.
  //
  // Two bugs used to cause repeats: this ran on whatever schedule fired (the
  // workflow can run more than once a day, which chewed through the pool at
  // double speed), and the date was read in UTC, which rolls over at 7pm
  // Chicago time. Both are fixed here: the day is Chicago's, and a business
  // is only eligible if it has never been featured, falling back to the
  // least-recently-featured one once the whole pool has been used.
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  if (spot.current && spot.current.date === todayStr) {
    console.log(`Spotlight already set today (${spot.current.name}); not rotating again.`);
  } else {
    const past = [...(spot.history || []), spot.current].filter(Boolean);
    const lastSeen = new Map();
    past.forEach((h, i) => { if (h.name) lastSeen.set(h.name, i); });
    const pick =
      SPOTLIGHT_POOL.find((b) => !lastSeen.has(b.name)) ||
      SPOTLIGHT_POOL.slice().sort((a, b) => lastSeen.get(a.name) - lastSeen.get(b.name))[0];
    if (spot.current) { spot.history = spot.history || []; spot.history.push(spot.current); }
    spot.current = {
      date: todayStr,
      name: pick.name, address: pick.address, website: pick.website,
      image: pick.image || '', blurb: pick.blurb
    };
    await writeFile(spotPath, JSON.stringify(spot, null, 1) + '\n');
  }

  // Retire the pinned Top Story after a week: move it into the archive and
  // clear the top slot (back to front-page defaults) until a new one is set
  // by hand. Age is measured from pinned_at (when it went up), not the
  // article date.
  try {
    const featuredPath = join(ROOT, 'data', 'featured.json');
    const featured = JSON.parse(await readFile(featuredPath, 'utf8'));
    const cur = featured.current;
    const pinned = cur && (cur.pinned_at || cur.date);
    if (cur && pinned) {
      const ageDays = (Date.now() - new Date(pinned + 'T12:00:00').getTime()) / 86400000;
      if (ageDays >= 7) {
        featured.history = featured.history || [];
        featured.history.unshift(cur);
        featured.current = null;
        await writeFile(featuredPath, JSON.stringify(featured, null, 1) + '\n');
        console.log(`Top story "${cur.headline}" retired to the archive after ${Math.round(ageDays)} days.`);
      }
    }
  } catch (e) { console.error('Top-story retire skipped:', e.message); }

  console.log(`News refresh: added ${added} item(s) from ${raw.length} feed entries; spotlight -> ${spot.current.name}.`);
}

main().catch((e) => {
  // Never fail the whole workflow just because news could not refresh.
  console.error('News refresh error (non-fatal):', e.message);
  process.exit(0);
});
