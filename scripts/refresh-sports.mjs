/*
 * Refresh Chicago home-game entries on the events calendar from ESPN's free,
 * CORS-open API (same source the ticker uses), so the sports schedule stays
 * current automatically instead of being hand-curated.
 *
 * For each team we pull its season schedule, keep HOME games in the next ~16
 * days, and replace that team's cat entries in data/events_week.json; every
 * other venue's hand-curated entries are left alone. Fail-safe: if a team's
 * fetch breaks, we KEEP that team's existing entries (never blank the section);
 * a team that fetches fine but is out of season simply has no upcoming games.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ESPN 403s any User-Agent containing "bot", so use a plain browser UA.
const UA = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' } };

const TEAMS = [
  { cat: 'cubs',  sport: 'baseball',   league: 'mlb',   id: 16,  short: 'Cubs',      venue: 'Wrigley Field',  address: '1060 W. Addison St, Wrigleyville',        fallback: 'https://www.mlb.com/cubs/schedule' },
  { cat: 'sox',   sport: 'baseball',   league: 'mlb',   id: 4,   short: 'White Sox', venue: 'Rate Field',     address: '333 W. 35th St, Bridgeport',              fallback: 'https://www.mlb.com/whitesox/schedule' },
  { cat: 'bears', sport: 'football',   league: 'nfl',   id: 3,   short: 'Bears',     venue: 'Soldier Field',  address: '1410 Special Olympics Dr, Museum Campus', fallback: 'https://www.chicagobears.com/schedule/' },
  { cat: 'fire',  sport: 'soccer',     league: 'usa.1', id: 182, short: 'Fire',      venue: 'Soldier Field',  address: '1410 Special Olympics Dr, Museum Campus', fallback: 'https://www.chicagofirefc.com/matches' },
  { cat: 'sky',   sport: 'basketball', league: 'wnba',  id: 19,  short: 'Sky',       venue: 'Wintrust Arena', address: '200 E. Cermak Rd, South Loop',            fallback: 'https://sky.wnba.com/schedule/' },
  { cat: 'bulls', sport: 'basketball', league: 'nba',   id: 4,   short: 'Bulls',     venue: 'United Center',  address: '1901 W. Madison St, Near West Side',      fallback: 'https://www.nba.com/bulls/schedule' }
];

const centralDate = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const centralTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });

function gameUrl(e, fallback) {
  const l = (e.links || []).find((x) => /^https?:/.test(x.href || '') && (x.rel || []).includes('desktop') && (x.rel || []).includes('event'));
  return (l && l.href) || ((e.links || []).find((x) => /^https?:/.test(x.href || '')) || {}).href || fallback;
}

async function main() {
  const today = new Date();
  const end = new Date(); end.setDate(end.getDate() + 16);
  const todayStr = today.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const endStr = end.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

  const fetched = {}; // cat -> array of entries (team fetched OK)
  const failed = new Set(); // cat -> fetch broke, keep old entries
  for (const T of TEAMS) {
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${T.sport}/${T.league}/teams/${T.id}/schedule`, UA);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const out = [];
      for (const e of (data.events || [])) {
        const c = e.competitions && e.competitions[0];
        if (!c) continue;
        const home = (c.competitors || []).find((z) => z.homeAway === 'home');
        if (!home || !home.team || String(home.team.id) !== String(T.id)) continue; // home games only
        const date = centralDate(e.date);
        if (date < todayStr || date > endStr) continue;
        const away = (c.competitors || []).find((z) => z.homeAway === 'away');
        const opp = (away && away.team && (away.team.displayName || away.team.name)) || 'TBD';
        out.push({
          title: T.short + ' vs. ' + opp, venue: T.venue, cat: T.cat, date,
          time: e.timeValid ? centralTime(e.date) : '', address: T.address, local: false, url: gameUrl(e, T.fallback)
        });
      }
      fetched[T.cat] = out;
    } catch (err) {
      failed.add(T.cat);
      console.error(`Sports: ${T.cat} fetch failed (${err.message}); keeping existing entries.`);
    }
  }

  const cats = new Set(TEAMS.map((t) => t.cat));
  const path = join(ROOT, 'data', 'events_week.json');
  const data = JSON.parse(await readFile(path, 'utf8'));
  const kept = data.shows.filter((s) => !cats.has(s.cat) || failed.has(s.cat));
  const added = TEAMS.filter((t) => !failed.has(t.cat)).flatMap((t) => fetched[t.cat] || []);
  data.shows = kept.concat(added).sort((a, b) => a.date.localeCompare(b.date));
  data.updated_at = todayStr;

  const keys = Object.keys(data);
  let outStr = '{\n';
  keys.forEach((k, i) => {
    const comma = i < keys.length - 1 ? ',' : '';
    if (k === 'shows') outStr += ' "shows": [\n' + data.shows.map((s) => '  ' + JSON.stringify(s)).join(',\n') + '\n ]' + comma + '\n';
    else outStr += ' ' + JSON.stringify(k) + ': ' + JSON.stringify(data[k]) + comma + '\n';
  });
  outStr += '}\n';
  await writeFile(path, outStr);
  console.log(`Sports: added ${added.length} home game(s) across ${TEAMS.length - failed.size} team(s); ${failed.size} kept as-is.`);
}

main();
