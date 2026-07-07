# 34thward.com — In & Around the West Loop

A static community news + civic hub for Chicago's 34th Ward. Plain HTML/CSS/vanilla JS — no build step.

## Publish (one-time setup)

1. **Create a GitHub repo** named `34th-ward-site` (private or public).
2. From this folder, push it:
   ```
   git remote add origin https://github.com/<you>/34th-ward-site.git
   git branch -M main
   git push -u origin main
   ```
3. **Connect Netlify** (netlify.com → Add new site → Import from GitHub → pick the repo).
   Build command: *(blank)*  •  Publish directory: `.`  (already set in `netlify.toml`).
4. **Custom domain:** Netlify → Domain settings → add `34thward.com`, then point the domain's
   DNS at Netlify (Netlify shows the exact records). HTTPS is automatic.

After this, **every `git push` auto-deploys** — no manual steps.

## What updates on its own (no rebuild needed)

These read live third-party data in the browser on every page load:
- **Ticker:** weather (Open-Meteo), Cubs/Sox/Sky/Fire scores (ESPN), airport drive times (OSRM).
- **Happy Hours:** the entire page reads the community Google Sheet live (CSV export).

## What the daily agent rebuilds

These are JSON snapshots in `data/` that only change when the ingestion pipeline re-runs:
- `data/feed.json` — the newspaper Front Page, summarized from Gmail newsletters
  (Politico, Axios, Skyline, Conway's Corner, WCA, IGWL).
- `data/spotlight.json` — the daily Business Spotlight (rotates each day).
- `data/mayor_race.json` — 2027 mayor's race Kalshi odds (KXMAYORCHI-27).
- `data/happy_hours_sheet.json` — fallback snapshot of the happy-hour sheet.

### Daily refresh routine (what the scheduled agent does each morning)
1. Pull the latest newsletters from Gmail (chicagojustice@gmail.com) and rebuild `feed.json`,
   applying the editorial rules (no Conway spotlight, no stale/expired items, hold person+allegation
   items for review).
2. Rotate the Business Spotlight; refresh Kalshi odds; re-snapshot the happy-hour sheet.
3. Bump the `?v=`/`?d=` cache tokens if code changed.
4. `git commit -am "Daily refresh <date>" && git push` → Netlify redeploys automatically.

## Local preview

Any static server, e.g. `npx serve -l 3457 .`, then open http://localhost:3457.
