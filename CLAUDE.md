# What this is
- 34thward.com — a live, auto-updating community news hub for Chicago's 34th Ward (West Loop, Greektown, Loop, Printers Row, South Loop). It is publicly live: a mistake here is public the moment it deploys.

# Who it's for
- Neighbors and local readers. Voice: a welcoming local newspaper — factual, warm, community-first, never partisan attack copy.

# The standards
- Brand: sky blue #14bef1, red #da1933, deep blue #0a5a78, flag-white #f7f9fa, Wrigley-green ticker. NO yellow anywhere. NO em dashes in any site content — use hyphens or commas instead.
- Everything published must be current and verified: no past-date events, no unverified deals, no stale information. When in doubt, leave it out.
- A robot commits updates to this site daily, so before pushing changes always run git pull --rebase first (this pulls in the robot's changes so yours don't collide).
- After deploying, verify with one small file check — not repeated large downloads (that burned through a hosting plan once already).
- When CSS, JavaScript, or data files change, bump the cache-busting versions (the ?v= numbers on assets and the DATA_V value in the js files) so readers' browsers pick up the change.

# The don'ts
- Do NOT spotlight Ald. Bill Conway personally. Lead with community impact; his newsletter gets factual source attribution only.
- Any item that names a person together with an allegation or dispute: hold it and show me before it publishes. Never publish a legal claim or accusation as fact.
- Never let the site show wrong odds, scores, or prices rather than none — if a data source breaks, hide that section and tell me.

# Start of every session
- Check the live site (https://34thward.com) and pull the latest before changing anything — the daily bot may have run since we last worked.
