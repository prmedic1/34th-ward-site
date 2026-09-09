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

  // Owner opt-out: loading any page with ?notrack=1 permanently stops this
  // device/browser from being counted (a flag saved in the browser). Use
  // ?notrack=0 to start counting again. Clearing Safari website data resets it.
  // A brief on-screen banner confirms the change so the owner can see it took.
  function showNotice(text) {
    try {
      var el = document.createElement('div');
      el.textContent = text;
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:9999;background:#0a5a78;color:#fff;font:600 14px/1.4 Inter,system-ui,sans-serif;padding:12px 18px;border-radius:8px;box-shadow:0 6px 18px rgba(10,35,64,.28);max-width:88%;text-align:center';
      (document.body || document.documentElement).appendChild(el);
      setTimeout(function () { el.style.transition = 'opacity .5s'; el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 500); }, 4500);
    } catch (e) { /* never break the page over a banner */ }
  }
  try {
    if (/[?&]notrack=1/.test(location.search)) {
      localStorage.setItem('w34_notrack', '1');
      showNotice('Got it - this device will not be counted in the visit stats.');
    } else if (/[?&]notrack=0/.test(location.search)) {
      localStorage.removeItem('w34_notrack');
      showNotice('Visit counting is turned back on for this device.');
    }
    if (localStorage.getItem('w34_notrack') === '1') return; // don't count the owner
  } catch (e) { /* storage blocked: just count normally */ }

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
