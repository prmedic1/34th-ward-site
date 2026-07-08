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

    // 3. Business pins
    fetch('data/businesses_geo.json?d=20260707c')
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var businesses = data && data.businesses ? data.businesses : [];
        var features = businesses
          .filter(function (b) {
            return typeof b.lat === 'number' && typeof b.lng === 'number';
          })
          .map(function (b) {
            return {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [b.lng, b.lat] },
              properties: {
                name: b.name || '',
                address: b.address || '',
                zip: b.zip || '',
                lat: b.lat,
                lng: b.lng
              }
            };
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
      })
      .catch(function (err) {
        console.warn('Failed to load business pins', err);
      });

    // 4. Click handling
    map.on('click', function (e) {
      var bizFeatures = map.getLayer('biz-dots')
        ? map.queryRenderedFeatures(e.point, { layers: ['biz-dots'] })
        : [];
      if (bizFeatures.length) {
        var props = bizFeatures[0].properties;
        var coords = bizFeatures[0].geometry.coordinates.slice();
        var name = props.name || '';
        var address = props.address || '';
        var zip = props.zip || '';
        var lat = props.lat;
        var lng = props.lng;

        var searchUrl =
          'https://www.google.com/search?q=' +
          encodeURIComponent(name + ' Chicago ' + address);
        var streetViewUrl =
          'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + lat + ',' + lng;

        var html =
          '<h4>' + esc(name) + '</h4>' +
          '<p style="font-size:0.8rem;color:#5b6b7c;margin:0 0 4px;">' +
          esc(address) + (zip ? ', ' + esc(zip) : '') +
          '</p>' +
          '<a class="map-pill" href="' + esc(searchUrl) + '" target="_blank" rel="noopener">Find their website</a>' +
          '<a class="map-pill" href="' + esc(streetViewUrl) + '" target="_blank" rel="noopener">Street View</a>';

        new maplibregl.Popup({ maxWidth: '300px' }).setLngLat(coords).setHTML(html).addTo(map);
        return;
      }

      // Query every fill-extrusion layer present (the basemap style ships its
      // own 3D buildings layer, so ours may not exist).
      var styleLayers = (map.getStyle() && map.getStyle().layers) || [];
      var extrusionIds = [];
      for (var li = 0; li < styleLayers.length; li++) {
        if (styleLayers[li].type === 'fill-extrusion') extrusionIds.push(styleLayers[li].id);
      }
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
