/*
 * Photoreal 3D mode for the ward explorer.
 * Swaps the vector 3D map for Google's Photorealistic 3D Tiles (the same
 * photogrammetry imagery as Google Earth) rendered with CesiumJS, loaded
 * lazily only when the user clicks the toggle so normal visits pay nothing.
 * Requires the Map Tiles API to be enabled on the Google key; if it is not,
 * the mode shows a friendly note and returns to the vector map.
 */
(function () {
  var GOOGLE_KEY = 'AIzaSyCawzarHisqLFJuUlPOBxt8CcfCwL6gJ4w';
  var CESIUM_VER = '1.119';
  var CESIUM_BASE = 'https://cesium.com/downloads/cesiumjs/releases/' + CESIUM_VER + '/Build/Cesium/';

  var wardEl = document.getElementById('ward-3d');
  if (!wardEl) return;
  var controls = document.querySelector('.map3d-controls');
  if (!controls) return;

  // Container that replaces the vector map while photoreal mode is active.
  var photoEl = document.createElement('div');
  photoEl.id = 'photoreal-3d';
  photoEl.style.cssText =
    'display:none; width:100%; height:72vh; min-height:420px;' +
    'border:3px solid var(--navy, #0a5a78); border-radius:14px; overflow:hidden;' +
    'box-shadow:0 6px 24px rgba(6,48,63,0.18); background:#0b1520; position:relative;';
  wardEl.parentNode.insertBefore(photoEl, wardEl.nextSibling);

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'map3d-btn';
  btn.id = 'view-photoreal';
  btn.textContent = 'Photoreal 3D';
  controls.appendChild(btn);

  var active = false;
  var viewer = null;
  var loading = false;

  function note(msg) {
    photoEl.innerHTML =
      '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'color:#dce8f0;font:500 0.95rem/1.5 Inter,sans-serif;padding:24px;text-align:center;">' + msg + '</div>';
  }

  function loadCesium(cb) {
    if (window.Cesium) { cb(); return; }
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = CESIUM_BASE + 'Widgets/widgets.css';
    document.head.appendChild(css);
    var s = document.createElement('script');
    s.src = CESIUM_BASE + 'Cesium.js';
    s.onload = cb;
    s.onerror = function () {
      note('Could not load the 3D engine. Check your connection and try again.');
      loading = false;
    };
    document.head.appendChild(s);
  }

  function startViewer() {
    if (viewer) { flyHome(); return; }
    try {
      window.CESIUM_BASE_URL = CESIUM_BASE;
      viewer = new Cesium.Viewer('photoreal-3d', {
        globe: false,
        baseLayerPicker: false,
        geocoder: false,
        timeline: false,
        animation: false,
        sceneModePicker: false,
        homeButton: false,
        navigationHelpButton: false,
        fullscreenButton: true,
        infoBox: false,
        selectionIndicator: false,
        requestRenderMode: true
      });
      viewer.scene.skyAtmosphere.show = true;
      Cesium.Cesium3DTileset.fromUrl(
        'https://tile.googleapis.com/v1/3dtiles/root.json?key=' + GOOGLE_KEY,
        { showCreditsOnScreen: true }
      ).then(function (tileset) {
        viewer.scene.primitives.add(tileset);
        flyHome();
        addWardBoundary();
        addBusinessPoints();
        loading = false;
      }).catch(function () {
        note('Photoreal mode is almost ready. It needs one more Google setting: enable the ' +
          '<strong>Map Tiles API</strong> for this project and add it to the API key\'s allowed APIs, ' +
          'then reload this page.');
        loading = false;
      });
    } catch (err) {
      note('This browser could not start the photoreal 3D engine.');
      loading = false;
    }
  }

  // Red outline of the 34th Ward, draped on the photoreal terrain.
  function addWardBoundary() {
    fetch('data/ward34_boundary.geojson')
      .then(function (r) { return r.json(); })
      .then(function (geo) {
        var feats = geo.type === 'FeatureCollection' ? geo.features : [geo];
        feats.forEach(function (f) {
          var g = f.geometry || f;
          var polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
          polys.forEach(function (poly) {
            var ring = poly[0];
            var coords = [];
            ring.forEach(function (c) { coords.push(c[0], c[1]); });
            viewer.entities.add({
              polyline: {
                positions: Cesium.Cartesian3.fromDegreesArray(coords),
                width: 4,
                material: Cesium.Color.fromCssColorString('#da1933'),
                clampToGround: true
              }
            });
          });
        });
      })
      .catch(function () { /* boundary is optional */ });
  }

  // Same chain list as the vector map, so brands show their logo here too.
  var CHAINS = [
    [/starbucks/i, 'starbucks.com'], [/mc\s*donald'?s/i, 'mcdonalds.com'], [/dunkin/i, 'dunkindonuts.com'],
    [/subway/i, 'subway.com'], [/chipotle/i, 'chipotle.com'], [/potbelly/i, 'potbelly.com'],
    [/jimmy\s*john'?s/i, 'jimmyjohns.com'], [/7[\s-]*eleven/i, '7-eleven.com'], [/walgreens/i, 'walgreens.com'],
    [/\bcvs\b/i, 'cvs.com'], [/\btarget\b/i, 'target.com'], [/whole\s*foods/i, 'wholefoodsmarket.com'],
    [/mariano'?s/i, 'marianos.com'], [/portillo'?s/i, 'portillos.com'], [/panera/i, 'panerabread.com'],
    [/five\s*guys/i, 'fiveguys.com'], [/shake\s*shack/i, 'shakeshack.com'], [/sweetgreen/i, 'sweetgreen.com'],
    [/peet'?s/i, 'peets.com'], [/chick[\s-]*fil[\s-]*a/i, 'chick-fil-a.com'], [/wingstop/i, 'wingstop.com'],
    [/panda\s*express/i, 'pandaexpress.com'], [/nando'?s/i, 'nandosperiperi.com'], [/pret\s*a\s*manger/i, 'pret.com'],
    [/\broti\b/i, 'roti.com'], [/naf\s*naf/i, 'nafnafgrill.com'], [/protein\s*bar/i, 'theproteinbar.com'],
    [/\bchase bank\b|\bjpmorgan\b/i, 'chase.com'], [/fifth\s*third/i, '53.com'], [/pnc\s*bank/i, 'pnc.com'],
    [/fedex/i, 'fedex.com'], [/ups\s*store/i, 'theupsstore.com']
  ];
  function matchChainLogo(name) {
    for (var i = 0; i < CHAINS.length; i++) { if (CHAINS[i][0].test(name)) return CHAINS[i][1]; }
    return null;
  }

  // Same category groups and labels as the vector map's filter panel.
  var PCAT_META = {
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
  var PGROUPS = ['Food & Drink', 'Shops & Services', 'Community & Culture', 'Getting Around'];

  var entitiesByKind = {}; // kind ("chain","other", or a category) -> [entities]

  // Business, church, transit, and arts markers with icons + click info.
  function addBusinessPoints() {
    Promise.all([
      fetch('data/businesses_geo.json?d=20260709b').then(function (r) { return r.json(); }),
      fetch('data/ward_extra_geo.json?d=20260709b').then(function (r) { return r.json(); }).catch(function () { return []; })
    ]).then(function (res) {
      var biz = (res[0] && res[0].businesses) ? res[0].businesses : [];
      var extra = Array.isArray(res[1]) ? res[1] : [];
      var all = biz.concat(extra);
      var counts = { cats: {}, chains: 0, other: 0 };

      all.forEach(function (b) {
        if (typeof b.lat !== 'number' || typeof b.lng !== 'number') return;
        var site = b.website ||
          'https://www.google.com/search?q=' + encodeURIComponent((b.name || '') + ' Chicago ' + (b.address || ''));
        var logo = matchChainLogo(b.name || '');
        var props = { name: b.name || 'Business', address: b.address || '', site: site };
        var kind, ent;

        if (logo) {
          kind = 'chain'; counts.chains++;
          ent = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(b.lng, b.lat),
            billboard: iconBillboard('images/logos/' + logo + '.png', 0.5),
            properties: props
          });
        } else if (b.category) {
          kind = b.category; counts.cats[kind] = (counts.cats[kind] || 0) + 1;
          ent = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(b.lng, b.lat),
            billboard: iconBillboard('images/icons/' + b.category + '.png?v=20260709b', 0.55),
            properties: props
          });
        } else {
          kind = 'other'; counts.other++;
          ent = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(b.lng, b.lat),
            point: {
              pixelSize: 8,
              color: Cesium.Color.fromCssColorString('#da1933'),
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 1.5,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            properties: props
          });
        }
        (entitiesByKind[kind] = entitiesByKind[kind] || []).push(ent);
      });

      buildPhotoPanel(counts);
    }).catch(function () { /* points are optional */ });

    // Click a marker to see its info card; click empty space to dismiss.
    var handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(function (click) {
      var picked = viewer.scene.pick(click.position);
      if (picked && picked.id && picked.id.properties) {
        var p = picked.id.properties;
        showPhotoCard(p.name.getValue(), p.address.getValue(), p.site.getValue());
      } else {
        hidePhotoCard();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function iconBillboard(image, scale) {
    return {
      image: image,
      scale: scale,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    };
  }

  function setKindVisible(kind, on) {
    var list = entitiesByKind[kind] || [];
    for (var i = 0; i < list.length; i++) list[i].show = on;
  }

  // Filter panel identical in spirit to the vector map's, toggling entities.
  function buildPhotoPanel(counts) {
    if (photoEl.querySelector('.map-legend')) return;
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
    var allRow = document.createElement('label');
    allRow.className = 'map-legend-all';
    allRow.innerHTML = '<input type="checkbox" data-role="all" checked> <strong>All categories</strong>';
    body.appendChild(allRow);

    function row(kind, emoji, label, count) {
      if (!count) return;
      var el = document.createElement('label');
      el.innerHTML = '<input type="checkbox" data-role="item" data-kind="' + kind + '" checked> ' +
        '<span class="lg-emoji">' + emoji + '</span> <span>' + label + '</span>' +
        '<span class="lg-count">' + count + '</span>';
      body.appendChild(el);
    }

    PGROUPS.forEach(function (group) {
      var items = [];
      Object.keys(PCAT_META).forEach(function (c) {
        if (PCAT_META[c].g === group && counts.cats[c]) items.push([c, PCAT_META[c].e, PCAT_META[c].l, counts.cats[c]]);
      });
      var specials = [];
      if (group === 'Shops & Services') {
        if (counts.chains) specials.push(['chain', '🏷️', 'Chain brands', counts.chains]);
        if (counts.other) specials.push(['other', '📍', 'Other businesses', counts.other]);
      }
      if (!items.length && !specials.length) return;
      var gh = document.createElement('div');
      gh.className = 'map-legend-group';
      gh.textContent = group;
      body.appendChild(gh);
      items.forEach(function (r) { row(r[0], r[1], r[2], r[3]); });
      specials.forEach(function (r) { row(r[0], r[1], r[2], r[3]); });
    });

    panel.appendChild(body);
    body.addEventListener('change', function (e) {
      var t = e.target;
      if (t.getAttribute('data-role') === 'all') {
        var on = t.checked;
        body.querySelectorAll('input[data-role="item"]').forEach(function (b) {
          b.checked = on;
          setKindVisible(b.getAttribute('data-kind'), on);
        });
      } else if (t.getAttribute('data-role') === 'item') {
        setKindVisible(t.getAttribute('data-kind'), t.checked);
        var boxes = body.querySelectorAll('input[data-role="item"]');
        var all = true;
        for (var i = 0; i < boxes.length; i++) { if (!boxes[i].checked) { all = false; break; } }
        var master = body.querySelector('input[data-role="all"]');
        if (master) master.checked = all;
      }
      if (viewer) viewer.scene.requestRender();
    });

    photoEl.appendChild(panel);
  }

  var photoCard = null;
  function showPhotoCard(name, address, site) {
    hidePhotoCard();
    photoCard = document.createElement('div');
    photoCard.style.cssText =
      'position:absolute; left:12px; bottom:12px; z-index:6; max-width:260px;' +
      'background:rgba(255,255,255,0.96); border:1px solid #cdd6dd; border-radius:10px;' +
      'box-shadow:0 2px 12px rgba(6,48,63,0.25); padding:11px 13px; font:13px/1.35 Inter,sans-serif; color:#243b4a;';
    photoCard.innerHTML =
      '<div style="font-weight:700; margin-bottom:3px;">' + escapeHtml(name) + '</div>' +
      (address ? '<div style="color:#5b6b7c; font-size:12px; margin-bottom:6px;">' + escapeHtml(address) + '</div>' : '') +
      '<a href="' + escapeHtml(site) + '" target="_blank" rel="noopener" style="color:#0a5a78; font-weight:600;">Website</a>' +
      '<span style="float:right; cursor:pointer; color:#97a3ad;" id="photo-card-x">Close</span>';
    photoEl.appendChild(photoCard);
    var x = photoCard.querySelector('#photo-card-x');
    if (x) x.addEventListener('click', hidePhotoCard);
  }
  function hidePhotoCard() {
    if (photoCard && photoCard.parentNode) photoCard.parentNode.removeChild(photoCard);
    photoCard = null;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function flyHome() {
    if (!viewer) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(-87.6485, 41.8715, 900),
      orientation: {
        heading: Cesium.Math.toRadians(8),
        pitch: Cesium.Math.toRadians(-32),
        roll: 0
      },
      duration: 0
    });
  }

  btn.addEventListener('click', function () {
    if (loading) return;
    active = !active;
    if (active) {
      btn.classList.add('active');
      btn.textContent = 'Back to Map View';
      wardEl.style.display = 'none';
      photoEl.style.display = 'block';
      if (!viewer) {
        loading = true;
        note('Loading photoreal 3D imagery&hellip;');
        loadCesium(startViewer);
      }
    } else {
      btn.classList.remove('active');
      btn.textContent = 'Photoreal 3D';
      photoEl.style.display = 'none';
      wardEl.style.display = '';
      if (window._wardMap && typeof window._wardMap.resize === 'function') {
        window._wardMap.resize();
      }
    }
  });
})();
