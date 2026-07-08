(function () {
  const DATA_V = '20260708a';
  const REFRESH_MS = 15 * 60 * 1000; // refresh scores, weather, and drive times every 15 minutes
  const header = document.querySelector('.site-header');
  if (!header) return;

  header.insertAdjacentHTML(
    'afterend',
    `<div class="ticker" role="complementary" aria-label="Live updates ticker">
      <span class="ticker-clock" id="ticker-clock"></span>
      <div class="ticker-viewport">
        <div class="ticker-track" id="ticker-track"><span class="ticker-item">Loading updates&hellip;</span></div>
      </div>
    </div>`
  );

  // Live Chicago clock
  const clockEl = document.getElementById('ticker-clock');
  function tickClock() {
    clockEl.textContent = new Date().toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Chicago'
    });
  }
  tickClock();
  setInterval(tickClock, 15000);

  const WEATHER_TEXT = {
    0: 'Sunny', 1: 'Mostly sunny', 2: 'Partly cloudy', 3: 'Cloudy',
    45: 'Foggy', 48: 'Foggy', 51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow',
    80: 'Showers', 81: 'Showers', 82: 'Heavy showers',
    85: 'Snow showers', 86: 'Snow showers',
    95: 'Thunderstorms', 96: 'Thunderstorms', 99: 'Thunderstorms'
  };

  function escapeTicker(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function teamLine(ev, names) {
    const comp = ev.competitions && ev.competitions[0];
    if (!comp) return null;
    const us = comp.competitors.find((c) => names.includes(c.team.abbreviation));
    if (!us) return null;
    const them = comp.competitors.find((c) => c !== us);
    const state = ev.status.type.state;
    const detail = ev.status.type.shortDetail || '';
    const usName = us.team.shortDisplayName;
    const themName = them.team.shortDisplayName;
    if (state === 'pre') {
      const when = new Date(ev.date).toLocaleString('en-US', {
        weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago'
      });
      return `${usName} ${us.homeAway === 'home' ? 'vs' : '@'} ${themName} &middot; ${when}`;
    }
    const score = `${usName} ${us.score}, ${themName} ${them.score}`;
    return state === 'post' ? `Final: ${score}` : `${score} (${detail})`;
  }

  function loadTicker() {
    const items = [];

    const weather = fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=41.8781&longitude=-87.6298&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&temperature_unit=fahrenheit&timezone=America%2FChicago'
    )
      .then((r) => r.json())
      .then((d) => {
        const t = Math.round(d.current.temperature_2m);
        const cond = WEATHER_TEXT[d.current.weather_code] || '';
        const hi = Math.round(d.daily.temperature_2m_max[0]);
        const lo = Math.round(d.daily.temperature_2m_min[0]);
        items.push(`<strong>${t}&deg;F</strong> ${cond} &middot; H ${hi}&deg; / L ${lo}&deg;`);
      })
      .catch(() => {});

    const leagues = [
      { url: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard', teams: ['CHC', 'CHW'] },
      { url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard', teams: ['CHI'] },
      { url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard', teams: ['CHI'] }
    ];
    const sports = Promise.all(
      leagues.map((lg) =>
        fetch(lg.url)
          .then((r) => r.json())
          .then((d) => {
            (d.events || []).forEach((ev) => {
              const line = teamLine(ev, lg.teams);
              if (line) items.push(line);
            });
          })
          .catch(() => {})
      )
    );

    // Estimated drive times to the airports (OSRM, from the West Loop)
    const WL = '-87.6412,41.8827';
    const airports = Promise.all([
      fetch(`https://router.project-osrm.org/route/v1/driving/${WL};-87.9073,41.9803?overview=false`).then((r) => r.json()),
      fetch(`https://router.project-osrm.org/route/v1/driving/${WL};-87.7522,41.7868?overview=false`).then((r) => r.json())
    ])
      .then(([ord, mdw]) => {
        const o = Math.round(ord.routes[0].duration / 60);
        const m = Math.round(mdw.routes[0].duration / 60);
        items.push(`<strong>O'Hare</strong> ~${o} min &middot; <strong>Midway</strong> ~${m} min (est. drive)`);
      })
      .catch(() => {});

    const news = fetch('data/feed.json?d=' + DATA_V)
      .then((r) => r.json())
      .then((d) => {
        d.items.slice(0, 3).forEach((it) => {
          items.push(escapeTicker(it.title));
        });
      })
      .catch(() => {});

    Promise.all([weather, sports, airports, news]).then(() => {
      if (!items.length) return;
      const track = document.getElementById('ticker-track');
      if (!track) return;
      const content = items.map((i) => `<span class="ticker-item">${i}</span>`).join('<span class="ticker-sep">&bull;</span>');
      // duplicate for a seamless loop
      track.innerHTML = content + '<span class="ticker-sep">&bull;</span>' + content + '<span class="ticker-sep">&bull;</span>';
      track.classList.add('scrolling');
    });
  }

  loadTicker();
  setInterval(loadTicker, REFRESH_MS);
})();
