(function () {
  if (typeof window.maplibregl === 'undefined') {
    console.warn('MapLibre GL JS failed to load; 3D map disabled.');
    return;
  }
  var container = document.getElementById('ward-3d');
  if (!container) return;

  var DEFAULT_CENTER = [-87.648, 41.879];
  var DEFAULT_ZOOM = 15.2;
  var DEFAULT_PITCH = 58;
  var DEFAULT_BEARING = -18;

  // Optional: paste a Google Maps API key here to show Street View photos in
  // business hover cards (Maps Platform > Street View Static API). Leave empty to skip photos.
  var STREETVIEW_KEY = 'AIzaSyCawzarHisqLFJuUlPOBxt8CcfCwL6gJ4w';

  var map = new maplibregl.Map({
    container: 'ward-3d',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    pitch: DEFAULT_PITCH,
    bearing: DEFAULT_BEARING,
    maxPitch: 75,
    antialias: true,
    // Full 360 degree rotation and zoom, by mouse, touch, and keyboard.
    dragRotate: true,
    pitchWithRotate: true,
    touchZoomRotate: true,
    touchPitch: true,
    keyboard: true
  });

  // touchZoomRotate ships enabled by default, but make sure two finger
  // rotation is on (not just pinch to zoom).
  if (map.touchZoomRotate && typeof map.touchZoomRotate.enableRotation === 'function') {
    map.touchZoomRotate.enableRotation();
  }

  map.addControl(
    new maplibregl.NavigationControl({ visualizePitch: true, showZoom: true, showCompass: true }),
    'top-right'
  );
  map.addControl(new maplibregl.ScaleControl(), 'bottom-left');
  window._wardMap = map; // exposed for QA/diagnostics

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  // Touch devices have no real hover, skip the dwell-popup logic there.
  // "No hover capability" is the right signal, not "has a touchscreen":
  // touchscreen laptops with a mouse should still get hover popups.
  var isTouchDevice = !!(window.matchMedia && window.matchMedia('(hover: none)').matches);

  // Enumerate every fill-extrusion layer in the current style at call time,
  // never hardcode a layer id, since the basemap may or may not ship its own.
  function getExtrusionLayerIds() {
    var styleLayers = (map.getStyle() && map.getStyle().layers) || [];
    var ids = [];
    for (var i = 0; i < styleLayers.length; i++) {
      if (styleLayers[i].type === 'fill-extrusion') ids.push(styleLayers[i].id);
    }
    return ids;
  }

  function getBizLayerIds() {
    var ids = [];
    if (map.getLayer('biz-dots')) ids.push('biz-dots');
    if (map.getLayer('biz-logos')) ids.push('biz-logos');
    if (map.getLayer('biz-cats')) ids.push('biz-cats');
    return ids;
  }

  // --- Chain logo matching (Task B) --------------------------------------
  var CHAINS = [
    { re: /starbucks/i, domain: 'starbucks.com' },
    { re: /mc\s*donald'?s/i, domain: 'mcdonalds.com' },
    { re: /dunkin/i, domain: 'dunkindonuts.com' },
    { re: /subway/i, domain: 'subway.com' },
    { re: /chipotle/i, domain: 'chipotle.com' },
    { re: /potbelly/i, domain: 'potbelly.com' },
    { re: /jimmy\s*john'?s/i, domain: 'jimmyjohns.com' },
    { re: /7[\s-]*eleven/i, domain: '7-eleven.com' },
    { re: /walgreens/i, domain: 'walgreens.com' },
    { re: /\bcvs\b/i, domain: 'cvs.com' },
    { re: /\btarget\b/i, domain: 'target.com' },
    { re: /whole\s*foods/i, domain: 'wholefoodsmarket.com' },
    { re: /mariano'?s/i, domain: 'marianos.com' },
    { re: /portillo'?s/i, domain: 'portillos.com' },
    { re: /panera/i, domain: 'panerabread.com' },
    { re: /five\s*guys/i, domain: 'fiveguys.com' },
    { re: /shake\s*shack/i, domain: 'shakeshack.com' },
    { re: /sweetgreen/i, domain: 'sweetgreen.com' },
    { re: /peet'?s/i, domain: 'peets.com' },
    { re: /chick[\s-]*fil[\s-]*a/i, domain: 'chick-fil-a.com' },
    { re: /wingstop/i, domain: 'wingstop.com' },
    { re: /panda\s*express/i, domain: 'pandaexpress.com' },
    { re: /nando'?s/i, domain: 'nandosperiperi.com' },
    { re: /pret\s*a\s*manger/i, domain: 'pret.com' },
    { re: /au\s*bon\s*pain/i, domain: 'aubonpain.com' },
    { re: /\broti\b/i, domain: 'roti.com' },
    { re: /naf\s*naf/i, domain: 'nafnafgrill.com' },
    { re: /protein\s*bar/i, domain: 'theproteinbar.com' },
    { re: /bank\s*of\s*america/i, domain: 'bankofamerica.com' },
    { re: /\bchase bank\b|\bjpmorgan\b/i, domain: 'chase.com' },
    { re: /fifth\s*third/i, domain: '53.com' },
    { re: /pnc\s*bank/i, domain: 'pnc.com' },
    { re: /fedex/i, domain: 'fedex.com' },
    { re: /ups\s*store/i, domain: 'theupsstore.com' }
  ];

  function matchChainLogo(name) {
    for (var i = 0; i < CHAINS.length; i++) {
      if (CHAINS[i].re.test(name)) return CHAINS[i].domain;
    }
    return null;
  }

  // Business marker precedence: chain brand logo > category icon > red dot.
  // Logos and category icons load asynchronously and can finish in either
  // order, so both completion paths funnel into applyBizFilters(), which
  // (re)builds the layer filters from whatever has actually loaded so far.
  var loadedChainDomains = [];
  var loadedCatIcons = [];

  // What the user has toggled on in the left-side filter panel. Everything
  // starts visible; the panel flips these and calls applyBizFilters().
  var filterState = { cats: {}, chains: true, other: true };

  function bizCursorHandlers(layerId) {
    map.on('mouseenter', layerId, function () {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', layerId, function () {
      map.getCanvas().style.cursor = '';
    });
  }

  function setVisible(layerId, on) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', on ? 'visible' : 'none');
    }
  }

  function applyBizFilters() {
    if (!map.getLayer('biz-dots')) return;
    var domains = ['literal', loadedChainDomains];
    var allCats = ['literal', loadedCatIcons];
    // Categories the user currently wants shown (default true).
    var enabled = loadedCatIcons.filter(function (c) { return filterState.cats[c] !== false; });
    var enabledLit = ['literal', enabled];

    // Red dots: uncategorized, non-chain businesses.
    map.setFilter('biz-dots', ['all',
      ['!', ['in', ['get', 'logo'], domains]],
      ['!', ['in', ['get', 'category'], allCats]]
    ]);
    setVisible('biz-dots', filterState.other);

    if (loadedChainDomains.length) {
      if (!map.getLayer('biz-logos')) {
        map.addLayer({
          id: 'biz-logos',
          type: 'symbol',
          source: 'biz-points',
          minzoom: 14.5,
          filter: ['in', ['get', 'logo'], domains],
          layout: {
            'icon-image': ['get', 'logo'],
            'icon-size': 0.45,
            'icon-allow-overlap': true
          }
        });
        bizCursorHandlers('biz-logos');
      } else {
        map.setFilter('biz-logos', ['in', ['get', 'logo'], domains]);
      }
      setVisible('biz-logos', filterState.chains);
    }

    if (loadedCatIcons.length) {
      // Only the enabled categories, and never a chain (logo wins over icon).
      var catFilter = ['all',
        ['in', ['get', 'category'], enabledLit],
        ['!', ['in', ['get', 'logo'], domains]]
      ];
      if (!map.getLayer('biz-cats')) {
        map.addLayer({
          id: 'biz-cats',
          type: 'symbol',
          source: 'biz-points',
          minzoom: 14.5,
          filter: catFilter,
          layout: {
            'icon-image': ['concat', 'cat-', ['get', 'category']],
            'icon-size': 0.42,
            'icon-allow-overlap': true
          }
        });
        bizCursorHandlers('biz-cats');
      } else {
        map.setFilter('biz-cats', catFilter);
      }
    }
  }

  // --- Left-side category filter panel -----------------------------------
  // Ordered category metadata: emoji, label, and the group heading it sits
  // under. "chains" and "other" are special (they toggle whole layers).
  var CAT_META = {
    restaurant: { e: '🍽️', l: 'Restaurants', g: 'Food & Drink' },
    bar: { e: '🍸', l: 'Bars', g: 'Food & Drink' },
    cafe: { e: '☕', l: 'Cafes', g: 'Food & Drink' },
    liquor: { e: '🍷', l: 'Liquor stores', g: 'Food & Drink' },
    grocery: { e: '🛒', l: 'Grocery', g: 'Food & Drink' },
    salon: { e: '✂️', l: 'Salons & barbers', g: 'Shops & Services' },
    cleaners: { e: '👕', l: 'Dry cleaners', g: 'Shops & Services' },
    fitness: { e: '🏋️', l: 'Gyms & fitness', g: 'Shops & Services' },
    health: { e: '🩺', l: 'Health & medical', g: 'Shops & Services' },
    hotel: { e: '🛏️', l: 'Hotels', g: 'Shops & Services' },
    entertainment: { e: '🎭', l: 'Arts & entertainment', g: 'Community & Culture' },
    worship: { e: '🛐', l: 'Places of worship', g: 'Community & Culture' },
    transit: { e: '🚉', l: 'Train & bus', g: 'Getting Around' }
  };
  var GROUP_ORDER = ['Food & Drink', 'Shops & Services', 'Community & Culture', 'Getting Around'];

  function syncAllCheckbox(panel) {
    var boxes = panel.querySelectorAll('input[data-role="item"]');
    var all = true;
    for (var i = 0; i < boxes.length; i++) { if (!boxes[i].checked) { all = false; break; } }
    var master = panel.querySelector('input[data-role="all"]');
    if (master) master.checked = all;
  }

  function buildFilterPanel(counts) {
    Object.keys(CAT_META).forEach(function (c) {
      if (filterState.cats[c] === undefined) filterState.cats[c] = true;
    });
    if (document.querySelector('.map-legend')) return;

    var panel = document.createElement('div');
    panel.className = 'map-legend';
    if (window.innerWidth < 760) panel.className += ' collapsed';

    var head = document.createElement('div');
    head.className = 'map-legend-head';
    head.innerHTML = '<span>Show on map</span><span class="map-legend-chev">▼</span>';
    head.addEventListener('click', function () { panel.classList.toggle('collapsed'); });
    panel.appendChild(head);

    var body = document.createElement('div');
    body.className = 'map-legend-body';

    // Master "All" toggle.
    var allRow = document.createElement('label');
    allRow.className = 'map-legend-all';
    allRow.innerHTML = '<input type="checkbox" data-role="all" checked> <strong>All categories</strong>';
    body.appendChild(allRow);

    function addRow(key, emoji, label, count, special) {
      if (!count) return;
      var row = document.createElement('label');
      var attr = special ? ' data-special="' + special + '"' : ' data-cat="' + key + '"';
      row.innerHTML = '<input type="checkbox" data-role="item"' + attr + ' checked> ' +
        '<span class="lg-emoji">' + emoji + '</span> <span>' + label + '</span>' +
        '<span class="lg-count">' + count + '</span>';
      body.appendChild(row);
    }

    GROUP_ORDER.forEach(function (group) {
      var rows = [];
      Object.keys(CAT_META).forEach(function (c) {
        if (CAT_META[c].g === group && counts.cats[c]) {
          rows.push({ k: c, e: CAT_META[c].e, l: CAT_META[c].l, n: counts.cats[c] });
        }
      });
      // Chains and Other live in the Shops & Services group.
      var specials = [];
      if (group === 'Shops & Services') {
        if (counts.chains) specials.push({ sp: 'chains', e: '🏷️', l: 'Chain brands', n: counts.chains });
        if (counts.other) specials.push({ sp: 'other', e: '📍', l: 'Other businesses', n: counts.other });
      }
      if (!rows.length && !specials.length) return;
      var gh = document.createElement('div');
      gh.className = 'map-legend-group';
      gh.textContent = group;
      body.appendChild(gh);
      rows.forEach(function (r) { addRow(r.k, r.e, r.l, r.n); });
      specials.forEach(function (s) { addRow(s.sp, s.e, s.l, s.n, s.sp); });
    });

    panel.appendChild(body);

    body.addEventListener('change', function (e) {
      var t = e.target;
      if (t.getAttribute('data-role') === 'all') {
        var on = t.checked;
        body.querySelectorAll('input[data-role="item"]').forEach(function (b) {
          b.checked = on;
          var cat = b.getAttribute('data-cat');
          var sp = b.getAttribute('data-special');
          if (cat) filterState.cats[cat] = on;
          else if (sp === 'chains') filterState.chains = on;
          else if (sp === 'other') filterState.other = on;
        });
      } else if (t.getAttribute('data-role') === 'item') {
        var cat2 = t.getAttribute('data-cat');
        var sp2 = t.getAttribute('data-special');
        if (cat2) filterState.cats[cat2] = t.checked;
        else if (sp2 === 'chains') filterState.chains = t.checked;
        else if (sp2 === 'other') filterState.other = t.checked;
        syncAllCheckbox(panel);
      }
      applyBizFilters();
    });

    container.appendChild(panel);
  }

  function finalizeChainLogos(loadedDomains) {
    loadedChainDomains = loadedDomains;
    applyBizFilters();
  }

  // Category icon badges (martini glass for bars, fork and knife for
  // restaurants, etc.) from images/icons/<category>.png. Any icon that fails
  // to load simply leaves those businesses as red dots.
  var CATEGORY_ICONS = ['bar', 'restaurant', 'cafe', 'grocery', 'liquor',
    'salon', 'cleaners', 'health', 'fitness', 'hotel',
    'entertainment', 'worship', 'transit'];

  function loadCategoryIcons() {
    var ok = [];
    var remaining = CATEGORY_ICONS.length;
    CATEGORY_ICONS.forEach(function (cat) {
      map.loadImage('images/icons/' + cat + '.png')
        .then(function (image) {
          remaining--;
          try {
            if (!map.hasImage('cat-' + cat)) map.addImage('cat-' + cat, image.data);
            ok.push(cat);
          } catch (addErr) {
            console.warn('Could not add category icon ' + cat, addErr);
          }
          if (remaining === 0) { loadedCatIcons = ok; applyBizFilters(); }
        })
        .catch(function () {
          remaining--;
          if (remaining === 0) { loadedCatIcons = ok; applyBizFilters(); }
        });
    });
  }

  function loadChainLogos(distinctDomains) {
    if (!distinctDomains.length) return;
    var loadedDomains = [];
    var remaining = distinctDomains.length;

    distinctDomains.forEach(function (domain) {
      // Local copies (images/logos/, fetched from Google's favicon service at
      // build time) - same-origin, so no CORS issues with the WebGL canvas.
      // Domains with no local file simply stay red dots via the catch below.
      var imgUrl = 'images/logos/' + domain + '.png';
      map
        .loadImage(imgUrl)
        .then(function (image) {
          remaining--;
          try {
            if (!map.hasImage(domain)) map.addImage(domain, image.data);
            loadedDomains.push(domain);
          } catch (addErr) {
            console.warn('Could not add logo image for ' + domain, addErr);
          }
          if (remaining === 0) finalizeChainLogos(loadedDomains);
        })
        .catch(function () {
          // CORS failure or 404, just leave this chain as a red dot.
          remaining--;
          if (remaining === 0) finalizeChainLogos(loadedDomains);
        });
    });
  }

  // --- Building hover address popup (Task A) ------------------------------
  var geocodeCache = new Map();
  var geocodePending = false;
  var hoverPopup = null;
  var hoverTimer = null;
  var hoverId = 0;
  // What the cursor is currently over (business key or building cell). When
  // this changes, the old popup is dismissed immediately so stale info never
  // follows the mouse around.
  var lastHoverAnchor = null;

  function hideHoverPopup() {
    hoverId++;
    lastHoverAnchor = null;
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    if (hoverPopup) {
      hoverPopup.remove();
      hoverPopup = null;
    }
  }

  function geocodeCacheKey(lat, lng) {
    return lat.toFixed(4) + ',' + lng.toFixed(4);
  }

  function addressFromResult(result) {
    if (!result || !result.address) return null;
    var addr = result.address;
    var parts = [];
    if (addr.house_number) parts.push(addr.house_number);
    if (addr.road) parts.push(addr.road);
    if (!parts.length) return null;
    return parts.join(' ') + ', Chicago';
  }

  function reverseGeocode(lat, lng, callback) {
    var key = geocodeCacheKey(lat, lng);
    if (geocodeCache.has(key)) {
      callback(geocodeCache.get(key));
      return;
    }
    if (geocodePending) return; // never more than one request in flight
    geocodePending = true;
    var url =
      'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + lat +
      '&lon=' + lng + '&zoom=18&addressdetails=1';
    fetch(url)
      .then(function (r) {
        return r.json();
      })
      .then(function (result) {
        geocodePending = false;
        geocodeCache.set(key, result);
        callback(result);
      })
      .catch(function () {
        geocodePending = false;
        geocodeCache.set(key, null);
        callback(null);
      });
  }

  function showHoverPopup(lngLat, addressLine) {
    if (hoverPopup) {
      hoverPopup.remove();
      hoverPopup = null;
    }

    var label = addressLine || 'Address unavailable';
    var zillowUrl = 'https://www.zillow.com/homes/' + encodeURIComponent(addressLine || label) + '_rb/';
    var aptsUrl = 'https://www.apartments.com/chicago-il/?sk=' + encodeURIComponent(addressLine || label);

    var imgHtml = '';
    if (STREETVIEW_KEY) {
      try {
        var svImgUrl =
          'https://maps.googleapis.com/maps/api/streetview?size=280x140&location=' +
          lngLat.lat + ',' + lngLat.lng + '&fov=75&key=' + STREETVIEW_KEY;
        imgHtml =
          '<img src="' + esc(svImgUrl) + '" width="100%" height="auto" ' +
          'style="border-radius:6px;display:block;margin:0 0 6px;" ' +
          'onerror="this.style.display=\'none\'">';
      } catch (err) {
        imgHtml = '';
      }
    }

    var html =
      imgHtml +
      '<p style="font-size:0.82rem;font-weight:600;margin:0 0 3px;">' + esc(label) + '</p>' +
      '<p style="font-size:0.72rem;margin:0;color:#5b6b7c;">Building info: ' +
      '<a href="' + esc(zillowUrl) + '" target="_blank" rel="noopener">Zillow</a>' +
      ' &middot; ' +
      '<a href="' + esc(aptsUrl) + '" target="_blank" rel="noopener">Apartments.com</a>' +
      '</p>';

    hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: '240px' })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(map);
  }

  // --- Business hover card, takes priority over the building hover above ---
  function showBizHoverPopup(coords, props) {
    if (hoverPopup) {
      hoverPopup.remove();
      hoverPopup = null;
    }

    var name = props.name || 'Business';
    var address = props.address || '';
    var lat = props.lat;
    var lng = props.lng;
    var logo = props.logo || '';

    var imgHtml = '';
    if (STREETVIEW_KEY) {
      var svImgUrl =
        'https://maps.googleapis.com/maps/api/streetview?size=280x140&location=' +
        lat + ',' + lng + '&fov=75&key=' + STREETVIEW_KEY;
      imgHtml =
        '<img src="' + esc(svImgUrl) + '" width="100%" height="auto" ' +
        'style="border-radius:6px;display:block;margin:0 0 6px;" ' +
        'onerror="this.style.display=\'none\'">';
    }

    var addressHtml = address
      ? '<p style="font-size:0.72rem;margin:0 0 4px;color:#5b6b7c;">' + esc(address) + '</p>'
      : '';

    // Real website when we know it, then chain domain, then a search fallback.
    var websiteUrl = props.website
      ? String(props.website)
      : logo
        ? 'https://' + logo
        : 'https://www.google.com/search?q=' + encodeURIComponent(name + ' ' + address + ' Chicago website');
    var svLinkUrl = 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + lat + ',' + lng;

    var html =
      imgHtml +
      '<p style="font-size:0.82rem;font-weight:600;margin:0 0 3px;">' + esc(name) + '</p>' +
      addressHtml +
      '<p style="font-size:0.72rem;margin:0;">' +
      '<a href="' + esc(websiteUrl) + '" target="_blank" rel="noopener">Website</a>' +
      ' &middot; ' +
      '<a href="' + esc(svLinkUrl) + '" target="_blank" rel="noopener">Street View</a>' +
      '</p>';

    hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: '260px' })
      .setLngLat(coords)
      .setHTML(html)
      .addTo(map);
  }

  map.on('load', function () {
    // 1. 3D buildings
    var hasExtrusion = false;
    var layers = map.getStyle() && map.getStyle().layers ? map.getStyle().layers : [];
    var firstSymbolId;
    for (var i = 0; i < layers.length; i++) {
      if (layers[i].type === 'fill-extrusion') {
        hasExtrusion = true;
      }
      if (!firstSymbolId && layers[i].type === 'symbol') {
        firstSymbolId = layers[i].id;
      }
    }

    if (!hasExtrusion) {
      try {
        map.addLayer(
          {
            id: 'ward-3d-buildings',
            source: 'openmaptiles',
            'source-layer': 'building',
            type: 'fill-extrusion',
            minzoom: 14,
            paint: {
              'fill-extrusion-color': [
                'interpolate',
                ['linear'],
                ['coalesce', ['get', 'render_height'], 0],
                0, '#dfd9d0',
                60, '#c9cdd2',
                180, '#b8c2cc'
              ],
              'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 0],
              'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
              'fill-extrusion-opacity': 0.88
            }
          },
          firstSymbolId
        );
      } catch (err) {
        console.warn('Could not add 3D buildings layer', err);
      }
    }

    // 1b. More realistic buildings: vertical gradient (darker at the base,
    // reads as ambient occlusion), full opacity, and a height-based color
    // ramp, warm masonry tones low, cool glass tones for towers. Applies to
    // every fill-extrusion layer present, ours and/or the basemap's own.
    getExtrusionLayerIds().forEach(function (layerId) {
      try {
        map.setPaintProperty(layerId, 'fill-extrusion-vertical-gradient', true);
      } catch (err) {
        console.warn('Could not set fill-extrusion-vertical-gradient on ' + layerId, err);
      }
      try {
        map.setPaintProperty(layerId, 'fill-extrusion-opacity', 1);
      } catch (err) {
        console.warn('Could not set fill-extrusion-opacity on ' + layerId, err);
      }
      try {
        map.setPaintProperty(layerId, 'fill-extrusion-color', [
          'interpolate',
          ['linear'],
          ['coalesce', ['get', 'render_height'], 0],
          0, '#cfc4b4',
          25, '#c2bab0',
          60, '#aab3ba',
          140, '#93a7b8',
          250, '#7f9cb5'
        ]);
      } catch (err) {
        console.warn('Could not set fill-extrusion-color on ' + layerId, err);
      }
    });

    // Directional light for depth.
    try {
      map.setLight({ anchor: 'viewport', position: [1.3, 200, 35], intensity: 0.45 });
    } catch (err) {
      console.warn('Could not set map light', err);
    }

    // Sky, harmless no-op if this MapLibre build does not support it.
    if (typeof map.setSky === 'function') {
      try {
        map.setSky({
          'sky-color': '#9ec7e6',
          'horizon-color': '#e6eef4',
          'fog-color': '#e8eef2',
          'sky-horizon-blend': 0.6,
          'horizon-fog-blend': 0.7
        });
      } catch (err) {
        console.warn('Could not set sky', err);
      }
    }

    // 1c. Landscape realism: deeper water, natural greens for parks and
    // trees, asphalt-toned streets. Conservative id/type heuristics against
    // the basemap's layers; anything unrecognized is left exactly as-is.
    (function paintLandscape() {
      var styleLayers = (map.getStyle() && map.getStyle().layers) || [];
      styleLayers.forEach(function (l) {
        var id = l.id || '';
        if (/casing|outline|label|shield|oneway|pattern|dash/i.test(id)) return;
        try {
          if (l.type === 'fill' && /water|river|ocean|lake/i.test(id)) {
            map.setPaintProperty(id, 'fill-color', '#3f8fc0');
          } else if (l.type === 'fill' && /wood|forest|tree|scrub/i.test(id)) {
            map.setPaintProperty(id, 'fill-color', '#8fbf85');
          } else if (l.type === 'fill' && /park|grass|golf|cemetery|meadow|garden/i.test(id)) {
            map.setPaintProperty(id, 'fill-color', '#a8cf9a');
          } else if (l.type === 'fill' && /sand|beach/i.test(id)) {
            map.setPaintProperty(id, 'fill-color', '#e8ddb5');
          } else if (l.type === 'line' && /motorway|trunk|primary|highway/i.test(id)) {
            map.setPaintProperty(id, 'line-color', '#8f9aa3');
          } else if (l.type === 'line' && /street|minor|secondary|tertiary|residential|service|link/i.test(id)) {
            map.setPaintProperty(id, 'line-color', '#aab4bc');
          } else if (l.type === 'line' && /path|pedestrian|footway|cycleway/i.test(id)) {
            map.setPaintProperty(id, 'line-color', '#cfd6da');
          }
        } catch (err) { /* leave this layer as-is */ }
      });
    })();

    // 2. Ward boundary
    fetch('data/ward34_boundary.geojson')
      .then(function (r) {
        return r.json();
      })
      .then(function (geo) {
        map.addSource('ward-boundary', { type: 'geojson', data: geo });
        map.addLayer({
          id: 'ward-boundary-fill',
          type: 'fill',
          source: 'ward-boundary',
          paint: { 'fill-color': '#14bef1', 'fill-opacity': 0.05 }
        });
        map.addLayer({
          id: 'ward-boundary-line',
          type: 'line',
          source: 'ward-boundary',
          paint: { 'line-color': '#da1933', 'line-width': 3 }
        });
      })
      .catch(function (err) {
        console.warn('Failed to load ward boundary', err);
      });

    // 3. Business pins, plus churches, transit, and arts venues from OSM.
    Promise.all([
      fetch('data/businesses_geo.json?d=20260709a').then(function (r) { return r.json(); }),
      fetch('data/ward_extra_geo.json?d=20260709a').then(function (r) { return r.json(); }).catch(function () { return []; })
    ])
      .then(function (results) {
        var data = results[0];
        var extra = Array.isArray(results[1]) ? results[1] : [];
        var businesses = data && data.businesses ? data.businesses : [];
        var features = businesses
          .filter(function (b) {
            return typeof b.lat === 'number' && typeof b.lng === 'number';
          })
          .map(function (b) {
            var logo = matchChainLogo(b.name || '');
            return {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [b.lng, b.lat] },
              properties: {
                name: b.name || '',
                address: b.address || '',
                zip: b.zip || '',
                lat: b.lat,
                lng: b.lng,
                logo: logo || '',
                category: b.category || '',
                website: b.website || ''
              }
            };
          });

        // Merge the OSM-sourced community places (no chain logos).
        extra.forEach(function (b) {
          if (typeof b.lat !== 'number' || typeof b.lng !== 'number') return;
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [b.lng, b.lat] },
            properties: {
              name: b.name || '',
              address: b.address || '',
              zip: '',
              lat: b.lat,
              lng: b.lng,
              logo: '',
              category: b.category || '',
              website: b.website || ''
            }
          });
        });

        var distinctDomains = [];
        var domainSeen = {};
        var counts = { cats: {}, chains: 0, other: 0 };
        features.forEach(function (f) {
          var p = f.properties;
          if (p.logo) {
            counts.chains++;
            if (!domainSeen[p.logo]) { domainSeen[p.logo] = true; distinctDomains.push(p.logo); }
          } else if (p.category) {
            counts.cats[p.category] = (counts.cats[p.category] || 0) + 1;
          } else {
            counts.other++;
          }
        });

        map.addSource('biz-points', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: features }
        });

        map.addLayer({
          id: 'biz-dots',
          type: 'circle',
          source: 'biz-points',
          minzoom: 14.5,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 14.5, 3, 18, 7],
            'circle-color': '#da1933',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.25,
            'circle-opacity': 0.9
          }
        });

        buildFilterPanel(counts);
        loadChainLogos(distinctDomains);
        loadCategoryIcons();
      })
      .catch(function (err) {
        console.warn('Failed to load business pins', err);
      });

    // 4. Click handling
    map.on('click', function (e) {
      hideHoverPopup(); // never let the hover popup linger under a click popup

      var bizLayerIds = getBizLayerIds();
      var bizFeatures = bizLayerIds.length
        ? map.queryRenderedFeatures(e.point, { layers: bizLayerIds })
        : [];
      if (bizFeatures.length) {
        var props = bizFeatures[0].properties;
        var coords = bizFeatures[0].geometry.coordinates.slice();
        var name = props.name || '';
        var address = props.address || '';
        var zip = props.zip || '';
        var lat = props.lat;
        var lng = props.lng;

        var searchUrl = props.website
          ? String(props.website)
          : props.logo
            ? 'https://' + props.logo
            : 'https://www.google.com/search?q=' +
              encodeURIComponent(name + ' Chicago ' + address);
        var websiteLabel = (props.website || props.logo) ? 'Website' : 'Find their website';
        var streetViewUrl =
          'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + lat + ',' + lng;

        var html =
          '<h4>' + esc(name) + '</h4>' +
          '<p style="font-size:0.8rem;color:#5b6b7c;margin:0 0 4px;">' +
          esc(address) + (zip ? ', ' + esc(zip) : '') +
          '</p>' +
          '<a class="map-pill" href="' + esc(searchUrl) + '" target="_blank" rel="noopener">' + websiteLabel + '</a>' +
          '<a class="map-pill" href="' + esc(streetViewUrl) + '" target="_blank" rel="noopener">Street View</a>';

        new maplibregl.Popup({ maxWidth: '300px' }).setLngLat(coords).setHTML(html).addTo(map);
        return;
      }

      // Query every fill-extrusion layer present (the basemap style ships its
      // own 3D buildings layer, so ours may not exist).
      var extrusionIds = getExtrusionLayerIds();
      if (!extrusionIds.length) return;

      var buildingFeatures = map.queryRenderedFeatures(e.point, { layers: extrusionIds });
      if (!buildingFeatures.length) return;

      var bProps = buildingFeatures[0].properties || {};
      var buildingName = bProps.name ? bProps.name : 'Building';
      var renderHeight = Number(bProps.render_height) || 0;
      var storiesHtml = '';
      if (renderHeight > 0) {
        var stories = Math.round(renderHeight / 3.2);
        storiesHtml = '<p style="font-size:0.8rem;color:#5b6b7c;margin:0 0 4px;">~' + stories + ' stories</p>';
      }

      var clickLat = e.lngLat.lat;
      var clickLng = e.lngLat.lng;
      var svUrl =
        'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + clickLat + ',' + clickLng;
      var gmapsUrl =
        'https://www.google.com/maps/search/?api=1&query=' + clickLat + ',' + clickLng;

      var bHtml =
        "<h4>What's here?</h4>" +
        '<p style="font-size:0.8rem;color:#5b6b7c;margin:0 0 4px;">' + esc(buildingName) + '</p>' +
        storiesHtml +
        '<a class="map-pill" href="' + esc(svUrl) + '" target="_blank" rel="noopener">Street View</a>' +
        '<a class="map-pill" href="' + esc(gmapsUrl) + '" target="_blank" rel="noopener">Open in Google Maps</a>';

      new maplibregl.Popup({ maxWidth: '300px' }).setLngLat(e.lngLat).setHTML(bHtml).addTo(map);
    });

    map.on('mouseenter', 'biz-dots', function () {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'biz-dots', function () {
      map.getCanvas().style.cursor = '';
    });

    // 5. Building hover address popup, desktop only (no real hover on touch)
    if (!isTouchDevice) {
      map.on('mousemove', function (e) {
        // Business hover cards take priority over the building-address hover.
        // Check them first; only fall through to the building logic when
        // nothing business-related is under the cursor.
        var bizLayerIds = getBizLayerIds();
        var bizFeatures = bizLayerIds.length
          ? map.queryRenderedFeatures(e.point, { layers: bizLayerIds })
          : [];

        if (bizFeatures.length) {
          var bizProps = bizFeatures[0].properties;
          var bizCoords = bizFeatures[0].geometry.coordinates.slice();

          // Dismiss the previous popup the moment the cursor is over a
          // DIFFERENT business; keep it (no flicker) while over the same one.
          var bizAnchor = 'biz:' + (bizProps.name || '') + '|' + (bizProps.address || '');
          if (lastHoverAnchor !== bizAnchor) {
            hideHoverPopup();
            lastHoverAnchor = bizAnchor;
          } else if (hoverPopup) {
            return; // card for this business is already up
          }

          // Dwell debounce, snappier than the building hover since this is
          // the primary interaction: settle for ~180ms, then show the card.
          if (hoverTimer) clearTimeout(hoverTimer);
          var thisBizHoverId = ++hoverId;

          hoverTimer = setTimeout(function () {
            hoverTimer = null;
            if (thisBizHoverId !== hoverId) return; // mouse moved off before this fired
            showBizHoverPopup(bizCoords, bizProps);
          }, 180);
          return;
        }

        var extrusionIds = getExtrusionLayerIds();
        if (!extrusionIds.length) {
          hideHoverPopup();
          return;
        }

        var buildingFeatures = map.queryRenderedFeatures(e.point, { layers: extrusionIds });
        if (!buildingFeatures.length) {
          hideHoverPopup();
          return;
        }

        // Dismiss the previous popup as soon as the cursor moves to a
        // different building cell (about a house-lot of movement); keep the
        // popup steady while hovering the same spot.
        var lngLat = e.lngLat;
        var bldAnchor = 'bld:' + geocodeCacheKey(lngLat.lat, lngLat.lng);
        if (lastHoverAnchor !== bldAnchor) {
          hideHoverPopup();
          lastHoverAnchor = bldAnchor;
        } else if (hoverPopup) {
          return; // popup for this spot is already up
        }

        // Dwell debounce: keep pushing the timer out while the cursor keeps
        // moving, only fire once it settles for ~450ms over a building.
        if (hoverTimer) clearTimeout(hoverTimer);
        var thisHoverId = ++hoverId;

        hoverTimer = setTimeout(function () {
          hoverTimer = null;
          var lat = Math.round(lngLat.lat * 10000) / 10000;
          var lng = Math.round(lngLat.lng * 10000) / 10000;
          reverseGeocode(lat, lng, function (result) {
            if (thisHoverId !== hoverId) return; // mouse moved off before this resolved
            showHoverPopup(lngLat, addressFromResult(result));
          });
        }, 450);
      });

      map.getCanvas().addEventListener('mouseleave', hideHoverPopup);
    }
  });

  // 6. Buttons
  var birdsBtn = document.getElementById('view-birds');
  var streetBtn = document.getElementById('view-street');
  var resetBtn = document.getElementById('view-reset');
  var rotateLeftBtn = document.getElementById('view-rotate-left');
  var rotateRightBtn = document.getElementById('view-rotate-right');
  var orbitBtn = document.getElementById('view-orbit');

  if (birdsBtn) {
    birdsBtn.addEventListener('click', function () {
      map.flyTo({ center: DEFAULT_CENTER, zoom: 14.2, pitch: 35, bearing: 0, duration: 1800 });
    });
  }
  if (streetBtn) {
    streetBtn.addEventListener('click', function () {
      map.flyTo({ zoom: 17.8, pitch: 74, bearing: -30, duration: 1800 });
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      map.flyTo({
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        pitch: DEFAULT_PITCH,
        bearing: DEFAULT_BEARING,
        duration: 1600
      });
    });
  }

  // 7. Rotate left / rotate right, 45 degree steps
  if (rotateLeftBtn) {
    rotateLeftBtn.addEventListener('click', function () {
      stopOrbit();
      map.easeTo({ bearing: map.getBearing() - 45, duration: 600 });
    });
  }
  if (rotateRightBtn) {
    rotateRightBtn.addEventListener('click', function () {
      stopOrbit();
      map.easeTo({ bearing: map.getBearing() + 45, duration: 600 });
    });
  }

  // 8. Orbit toggle, slow continuous auto-rotate around the current center
  var orbitFrameId = null;
  var ORBIT_DEGREES_PER_FRAME = 0.15;

  function orbitStep() {
    map.setBearing(map.getBearing() + ORBIT_DEGREES_PER_FRAME);
    orbitFrameId = window.requestAnimationFrame(orbitStep);
  }

  function startOrbit() {
    if (orbitFrameId !== null) return;
    orbitFrameId = window.requestAnimationFrame(orbitStep);
    if (orbitBtn) orbitBtn.classList.add('active');
  }

  function stopOrbit() {
    if (orbitFrameId === null) return;
    window.cancelAnimationFrame(orbitFrameId);
    orbitFrameId = null;
    if (orbitBtn) orbitBtn.classList.remove('active');
  }

  if (orbitBtn) {
    orbitBtn.addEventListener('click', function () {
      if (orbitFrameId === null) {
        startOrbit();
      } else {
        stopOrbit();
      }
    });
  }

  // Stop orbiting as soon as the user takes control of the map.
  map.on('mousedown', stopOrbit);
  map.on('touchstart', stopOrbit);
  map.on('dragstart', stopOrbit);
})();
