/*
 * Lightweight, privacy-friendly visit counting + app-shell registration.
 *
 * Counting uses the free Abacus counter API (abacus.jasoncameron.dev):
 * anonymous tallies only - no cookies, no personal data, no consent banner
 * needed. Each page load bumps a sitewide "total" and a per-page counter;
 * one "visitors" bump per browser session approximates unique visits.
 * The daily GitHub Action reads these totals and logs a good/usual/bad
 * verdict to data/traffic-log.json.
 */
(function () {
  var host = location.hostname;
  var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '';

  // Register the service worker so the site installs as a phone app.
  if ('serviceWorker' in navigator && !isLocal) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  }

  // Share button: opens the phone's native share sheet (Messages, Messenger,
  // WhatsApp, email, etc.). On a desktop with no share support, it copies the
  // link instead and briefly confirms.
  var shareBtn = document.getElementById('share-site');
  if (shareBtn) {
    var shareData = {
      title: 'The Official 34th Ward Neighborhood Page',
      text: 'Daily news and happenings in Chicago\'s 34th Ward - the West Loop, Greektown, the Loop, and more. Add it to your phone:',
      url: 'https://34thward.com/'
    };
    shareBtn.addEventListener('click', function () {
      if (navigator.share) {
        navigator.share(shareData).catch(function () {});
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText('https://34thward.com/').then(function () {
          var t = shareBtn.textContent;
          shareBtn.textContent = 'Link copied!';
          setTimeout(function () { shareBtn.textContent = t; }, 1800);
        }).catch(function () {});
      } else {
        window.prompt('Copy this link to share:', 'https://34thward.com/');
      }
    });
  }

  if (isLocal) return; // never count our own previews

  var NS = 'https://abacus.jasoncameron.dev/hit/34thward-com/';
  function bump(key) {
    try {
      fetch(NS + key, { keepalive: true, mode: 'cors' }).catch(function () {});
    } catch (e) { /* counting must never break the site */ }
  }

  var page = (location.pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'home').toLowerCase();
  bump('total');
  bump('page-' + page.slice(0, 40));

  // One visitor bump per browser session.
  try {
    if (!sessionStorage.getItem('w34_v')) {
      sessionStorage.setItem('w34_v', '1');
      bump('visitors');
    }
  } catch (e) { /* private browsing may block storage; fine */ }
})();
