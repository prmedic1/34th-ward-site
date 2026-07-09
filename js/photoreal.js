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
        fullscreenButton: false,
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
