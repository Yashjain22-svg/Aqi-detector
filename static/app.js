/**
 * VayuPath - AQI Smart Route Optimizer
 * Main Frontend JavaScript
 */

// ============================================================
// GLOBALS
// ============================================================

let map;
let routeLayers = [];
let markerLayers = [];
let heatmapLayer = null;
let hospitalMarkers = [];
let currentRouteData = null;
let activeRouteIndex = 0;
let isSidebarOpen = true;

// India bounds for map
const INDIA_CENTER = [22.5, 82.5];
const INDIA_ZOOM = 5;

// ============================================================
// MAP INITIALIZATION
// ============================================================

function initMap() {
  map = L.map('map', {
    center: INDIA_CENTER,
    zoom: INDIA_ZOOM,
    zoomControl: true,
    attributionControl: false,
  });

  // Dark map tile
  const darkTile = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© CartoDB',
    subdomains: 'abcd',
    maxZoom: 19
  });

  const lightTile = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© CartoDB',
    subdomains: 'abcd',
    maxZoom: 19
  });

  // Choose tile based on theme
  const theme = document.documentElement.getAttribute('data-theme');
  (theme === 'light' ? lightTile : darkTile).addTo(map);

  // Store tile references globally for theme switching
  window._darkTile = darkTile;
  window._lightTile = lightTile;

  // Attribution
  L.control.attribution({ prefix: false }).addTo(map);

  map.on('click', () => closePopup());
}

// ============================================================
// THEME TOGGLE
// ============================================================

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const newTheme = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', newTheme);
  document.getElementById('darkModeToggle').textContent = newTheme === 'dark' ? '🌙' : '☀️';

  // Swap map tiles
  if (newTheme === 'light') {
    map.removeLayer(window._darkTile);
    window._lightTile.addTo(map);
  } else {
    map.removeLayer(window._lightTile);
    window._darkTile.addTo(map);
  }

  localStorage.setItem('vayupath-theme', newTheme);
}

// ============================================================
// ROUTE FINDING
// ============================================================

async function findRoutes() {
  const source = document.getElementById('source-input').value.trim();
  const dest = document.getElementById('dest-input').value.trim();

  if (!source || !dest) {
    showToast('⚠️ Please enter both source and destination');
    return;
  }

  setLoading(true, 'Geocoding cities...');

  try {
    const avoidPolluted = document.getElementById('avoidPolluted').checked;

    // Show progress messages
    const messages = [
      'Geocoding cities...',
      'Calculating route variants...',
      'Fetching live AQI data...',
      'Analyzing pollution exposure...',
      'Scoring routes...'
    ];
    let msgIdx = 0;
    const msgInterval = setInterval(() => {
      if (msgIdx < messages.length) {
        setLoadingText(messages[msgIdx++]);
      }
    }, 800);

    const res = await fetch('/api/find-routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, destination: dest, avoid_polluted: avoidPolluted })
    });

    clearInterval(msgInterval);

    const data = await res.json();

    if (!data.success) {
      showToast('❌ ' + (data.error || 'Could not find routes'));
      setLoading(false);
      return;
    }

    currentRouteData = data;
    activeRouteIndex = 0;

    renderRoutes(data);
    drawRoutesOnMap(data);

    // Update ticker
    updateTicker(data.routes[0]);

    setLoading(false);
    showToast('✅ Routes found! Showing best options.');

  } catch (err) {
    setLoading(false);
    showToast('❌ Network error. Please try again.');
    console.error(err);
  }
}

// ============================================================
// RENDER ROUTE CARDS
// ============================================================

function renderRoutes(data) {
  const panel = document.getElementById('results-panel');
  const cardsEl = document.getElementById('route-cards');
  const timeEl = document.getElementById('results-time');

  timeEl.textContent = data.timestamp;
  cardsEl.innerHTML = '';

  data.routes.forEach((route, idx) => {
    const cat = route.aqi_category;
    const isRec = route.is_recommended;

    const card = document.createElement('div');
    card.className = `route-card ${isRec ? 'recommended' : ''} ${idx === 0 ? 'active-route' : ''}`;
    card.dataset.idx = idx;
    card.onclick = () => selectRoute(idx);

    const aqiPct = Math.min(100, (route.avg_aqi / 400) * 100);

    card.innerHTML = `
      ${isRec ? '<div class="route-badge">⭐ RECOMMENDED</div>' : ''}
      <div class="card-header">
        <span class="route-name">${route.name}</span>
        <span class="aqi-badge" style="background:${cat.color}">${cat.label}</span>
      </div>
      <div class="card-stats">
        <div class="stat-item">
          <div class="stat-val">${route.avg_aqi}</div>
          <div class="stat-label">Avg AQI</div>
        </div>
        <div class="stat-item">
          <div class="stat-val">${route.distance_km} km</div>
          <div class="stat-label">Distance</div>
        </div>
        <div class="stat-item">
          <div class="stat-val">${route.travel_time}</div>
          <div class="stat-label">Est. Time</div>
        </div>
      </div>
      <div class="aqi-bar-wrap">
        <div class="aqi-bar" style="width:${aqiPct}%;background:${cat.color}"></div>
      </div>
      ${route.hazardous_zones > 0 ? `<div style="font-size:.75rem;color:var(--danger);margin-top:.5rem">⚠️ ${route.hazardous_zones} hazardous zone${route.hazardous_zones > 1 ? 's' : ''} on this route</div>` : ''}
    `;

    cardsEl.appendChild(card);
  });

  // Render alerts
  renderAlerts(data.routes[0]);

  // Render prediction chart for recommended route
  renderPredictionChart(data.routes[0].aqi_prediction);

  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function selectRoute(idx) {
  activeRouteIndex = idx;
  document.querySelectorAll('.route-card').forEach((c, i) => {
    c.classList.toggle('active-route', i === idx);
  });

  // Highlight selected route on map
  highlightRouteOnMap(idx);

  // Update alerts and prediction for selected route
  if (currentRouteData) {
    renderAlerts(currentRouteData.routes[idx]);
    renderPredictionChart(currentRouteData.routes[idx].aqi_prediction);
  }
}

// ============================================================
// ALERTS
// ============================================================

function renderAlerts(route) {
  const section = document.getElementById('alerts-section');
  const list = document.getElementById('alerts-list');
  list.innerHTML = '';

  const alerts = [];

  if (route.avg_aqi > 200) {
    alerts.push('🔴 Very high pollution detected on this route. Wear N95/N99 masks mandatory.');
  }
  if (route.max_aqi > 300) {
    alerts.push('🚨 HAZARDOUS zones present. Consider alternative route or postpone travel.');
  }
  if (route.avg_aqi > 100 && route.avg_aqi <= 200) {
    alerts.push('🟠 Moderate-to-high pollution. Sensitive individuals should wear masks.');
  }
  if (route.hazardous_zones > 0) {
    alerts.push(`⚠️ ${route.hazardous_zones} highly polluted zone(s) detected. Stock up on N95 masks.`);
  }
  if (route.avg_aqi > 150) {
    alerts.push('💊 Carry antihistamines and keep car windows closed in polluted stretches.');
  }
  if (route.avg_aqi <= 50) {
    alerts.push('✅ Excellent air quality on this route. Safe for all travellers.');
  }

  if (alerts.length === 0) {
    alerts.push('✅ Air quality is acceptable. Standard precautions apply.');
  }

  alerts.forEach(a => {
    const el = document.createElement('div');
    el.className = 'alert-item';
    el.textContent = a;
    list.appendChild(el);
  });

  section.style.display = 'block';
}

// ============================================================
// PREDICTION CHART
// ============================================================

function renderPredictionChart(predictions) {
  const box = document.getElementById('prediction-box');
  const chart = document.getElementById('prediction-chart');

  if (!predictions || !predictions.length) {
    box.style.display = 'none';
    return;
  }

  const maxAqi = Math.max(...predictions.map(p => p.aqi), 50);
  chart.innerHTML = '';

  predictions.forEach(p => {
    const pct = Math.min(100, (p.aqi / maxAqi) * 100);
    const wrap = document.createElement('div');
    wrap.className = 'pred-bar-wrap';
    wrap.innerHTML = `
      <div class="pred-val">${p.aqi}</div>
      <div class="pred-bar" style="height:${pct}%;background:${p.category.color}"></div>
      <div class="pred-label">${p.hour}</div>
    `;
    chart.appendChild(wrap);
  });

  box.style.display = 'block';
}

// ============================================================
// MAP DRAWING
// ============================================================

function drawRoutesOnMap(data) {
  clearMapLayers();

  const src = data.source;
  const dst = data.destination;

  // Source marker
  const srcMarker = L.marker([src.lat, src.lon], {
    icon: createPinIcon('A', '#00e5a0')
  }).addTo(map).bindPopup(`<b>📍 ${src.name}</b>`);

  // Destination marker
  const dstMarker = L.marker([dst.lat, dst.lon], {
    icon: createPinIcon('B', '#00b4d8')
  }).addTo(map).bindPopup(`<b>🏁 ${dst.name}</b>`);

  markerLayers.push(srcMarker, dstMarker);

  const routeColors = ['#00e5a0', '#00b4d8', '#ffa726'];

  data.routes.forEach((route, idx) => {
    const color = routeColors[idx] || '#ffffff';
    const latlngs = route.waypoints.map(w => [w.lat, w.lon]);

    // Draw route polyline
    const polyline = L.polyline(latlngs, {
      color: color,
      weight: idx === 0 ? 5 : 3,
      opacity: idx === 0 ? 0.95 : 0.5,
      dashArray: idx === 0 ? null : '8,6',
    }).addTo(map);

    polyline.on('click', () => selectRoute(idx));
    routeLayers.push(polyline);

    // Draw AQI markers on route
    route.waypoints.forEach((wp, wIdx) => {
      if (wIdx === 0 || wIdx === route.waypoints.length - 1) return; // skip endpoints
      if (wIdx % 2 !== 0) return; // every other point

      const aqiCat = wp.category;
      const marker = L.marker([wp.lat, wp.lon], {
        icon: createAqiMarkerIcon(wp.aqi, aqiCat.color)
      }).addTo(map);

      marker.on('click', () => showAqiPopup(wp, route.name));
      markerLayers.push(marker);
    });
  });

  // Fit map to route bounds
  const allPoints = data.routes[0].waypoints.map(w => [w.lat, w.lon]);
  allPoints.push([src.lat, src.lon], [dst.lat, dst.lon]);
  const bounds = L.latLngBounds(allPoints);
  map.fitBounds(bounds, { padding: [50, 50] });
}

function highlightRouteOnMap(activeIdx) {
  const routeColors = ['#00e5a0', '#00b4d8', '#ffa726'];
  routeLayers.forEach((layer, idx) => {
    layer.setStyle({
      weight: idx === activeIdx ? 5 : 2.5,
      opacity: idx === activeIdx ? 0.95 : 0.35,
      color: routeColors[idx] || '#ffffff'
    });
  });
}

function createPinIcon(label, color) {
  return L.divIcon({
    className: '',
    html: `
      <div style="
        background:${color};
        width:30px;height:30px;border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        border:2px solid white;
        box-shadow:0 2px 8px rgba(0,0,0,0.4);
        display:flex;align-items:center;justify-content:center;
      ">
        <span style="transform:rotate(45deg);color:#050a14;font-weight:700;font-size:.75rem">${label}</span>
      </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30]
  });
}

function createAqiMarkerIcon(aqi, color) {
  return L.divIcon({
    className: 'custom-aqi-marker',
    html: `<div class="aqi-marker-inner" style="background:${color}">${aqi}</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
}

function showAqiPopup(wp, routeName) {
  const popup = document.getElementById('aqiPopup');
  const content = document.getElementById('popupContent');
  const cat = wp.category;

  content.innerHTML = `
    <div style="margin-bottom:.75rem">
      <div style="font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.1em">${routeName}</div>
      <div style="font-family:'Syne',sans-serif;font-size:1.5rem;font-weight:800;color:${cat.color}">${wp.aqi} AQI</div>
      <div style="display:inline-block;background:${cat.color};color:white;padding:2px 10px;border-radius:20px;font-size:.75rem;font-weight:600;margin-top:.25rem">${cat.label}</div>
    </div>
    <div style="font-size:.8rem;color:var(--text2);line-height:1.5;padding:.75rem;background:rgba(0,0,0,.2);border-radius:8px">
      💡 ${cat.advice}
    </div>
    <div style="font-size:.72rem;color:var(--muted);margin-top:.5rem">
      📍 ${wp.lat.toFixed(3)}, ${wp.lon.toFixed(3)}
    </div>
  `;

  popup.style.display = 'block';
}

function closePopup() {
  document.getElementById('aqiPopup').style.display = 'none';
}

function clearMapLayers() {
  routeLayers.forEach(l => map.removeLayer(l));
  markerLayers.forEach(l => map.removeLayer(l));
  hospitalMarkers.forEach(l => map.removeLayer(l));
  routeLayers = [];
  markerLayers = [];
  hospitalMarkers = [];
}

// ============================================================
// HEATMAP
// ============================================================

async function toggleHeatmap(enabled) {
  if (!enabled) {
    if (heatmapLayer) {
      map.removeLayer(heatmapLayer);
      heatmapLayer = null;
    }
    return;
  }

  setLoading(true, 'Generating AQI heatmap...');

  try {
    const bounds = map.getBounds();
    const res = await fetch('/api/aqi-heatmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bounds: {
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest()
        }
      })
    });

    const data = await res.json();
    setLoading(false);

    // Draw heatmap as colored circles (leaflet doesn't have built-in heatmap)
    const heatGroup = L.layerGroup();

    data.heatmap.forEach(([lat, lon, intensity]) => {
      const aqi = Math.round(intensity * 300);
      const color = getAqiColor(aqi);
      L.circleMarker([lat, lon], {
        radius: 18,
        color: 'transparent',
        fillColor: color,
        fillOpacity: 0.35
      }).addTo(heatGroup);
    });

    heatmapLayer = heatGroup;
    heatmapLayer.addTo(map);

  } catch(e) {
    setLoading(false);
    showToast('⚠️ Could not generate heatmap');
  }
}

function getAqiColor(aqi) {
  if (aqi <= 50) return '#00C853';
  if (aqi <= 100) return '#FFD600';
  if (aqi <= 150) return '#FF6D00';
  if (aqi <= 200) return '#D50000';
  if (aqi <= 300) return '#6A0080';
  return '#3E2723';
}

// ============================================================
// HOSPITALS
// ============================================================

async function findHospitals() {
  if (!currentRouteData) {
    showToast('⚠️ Please find a route first');
    return;
  }

  const modal = document.getElementById('hospitalsModal');
  const list = document.getElementById('hospitalsList');
  list.innerHTML = '<p class="muted-text">🔍 Searching for nearby hospitals...</p>';
  modal.style.display = 'flex';

  // Use midpoint of recommended route
  const route = currentRouteData.routes[0];
  const mid = route.waypoints[Math.floor(route.waypoints.length / 2)];

  try {
    const res = await fetch('/api/nearby-hospitals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: mid.lat, lon: mid.lon, radius: 10000 })
    });

    const data = await res.json();

    if (!data.hospitals || data.hospitals.length === 0) {
      list.innerHTML = '<p class="muted-text">No hospitals found in range. Try expanding your search area.</p>';
      return;
    }

    list.innerHTML = '';
    data.hospitals.forEach(h => {
      const item = document.createElement('div');
      item.className = 'hospital-item';
      item.innerHTML = `
        <span class="hospital-icon">🏥</span>
        <div class="hospital-info">
          <h4>${h.name}</h4>
          <p>📞 ${h.phone}</p>
        </div>
        <span class="hospital-dist">${h.distance_km} km</span>
      `;
      item.onclick = () => {
        const hMarker = L.marker([h.lat, h.lon], { icon: createPinIcon('H', '#ff4d6d') })
          .addTo(map)
          .bindPopup(`<b>🏥 ${h.name}</b><br>${h.distance_km} km away`).openPopup();
        hospitalMarkers.push(hMarker);
        closeHospitals();
        map.setView([h.lat, h.lon], 13);
      };
      list.appendChild(item);
    });

  } catch(e) {
    list.innerHTML = '<p class="muted-text">Error fetching hospitals. Check your connection.</p>';
  }
}

function closeHospitals() {
  document.getElementById('hospitalsModal').style.display = 'none';
}

// ============================================================
// SAVE ROUTE
// ============================================================

function saveCurrentRoute() {
  if (!currentRouteData) {
    showToast('⚠️ No route to save. Find a route first.');
    return;
  }
  document.getElementById('saveRouteModal').style.display = 'flex';
  document.getElementById('routeNickname').focus();
}

async function confirmSaveRoute() {
  const nickname = document.getElementById('routeNickname').value.trim();
  const route = currentRouteData.routes[activeRouteIndex];

  try {
    const res = await fetch('/api/save-route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: currentRouteData.source.name,
        destination: currentRouteData.destination.name,
        route_data: route,
        avg_aqi: route.avg_aqi,
        distance: route.distance_km,
        nickname: nickname
      })
    });

    const data = await res.json();
    if (data.success) {
      closeSaveModal();
      showToast('⭐ Route saved successfully!');
    }
  } catch(e) {
    showToast('❌ Could not save route. Please sign in.');
  }
}

function closeSaveModal() {
  document.getElementById('saveRouteModal').style.display = 'none';
}

// ============================================================
// SAVED ROUTES
// ============================================================

async function openSavedRoutes() {
  const modal = document.getElementById('savedRoutesModal');
  const list = document.getElementById('savedRoutesList');
  list.innerHTML = '<p class="muted-text">Loading...</p>';
  modal.style.display = 'flex';
  toggleUserMenu(); // close dropdown

  try {
    const res = await fetch('/api/saved-routes');
    const data = await res.json();

    if (!data.routes || data.routes.length === 0) {
      list.innerHTML = '<p class="muted-text">No saved routes yet. Find and save a route first!</p>';
      return;
    }

    list.innerHTML = '';
    data.routes.forEach(r => {
      const item = document.createElement('div');
      item.className = 'saved-route-item';
      item.innerHTML = `
        <div class="saved-route-info">
          <h4>${r.nickname || (r.source + ' → ' + r.destination)}</h4>
          <p>${r.source} → ${r.destination} | Avg AQI: ${r.avg_aqi} | ${r.distance} km | ${r.saved_at}</p>
        </div>
        <div class="saved-route-actions">
          <button class="small-btn danger" onclick="deleteRoute(${r.id}, this)">🗑️</button>
        </div>
      `;
      list.appendChild(item);
    });

  } catch(e) {
    list.innerHTML = '<p class="muted-text">Error loading routes.</p>';
  }
}

async function deleteRoute(id, btn) {
  try {
    await fetch(`/api/delete-route/${id}`, { method: 'DELETE' });
    btn.closest('.saved-route-item').remove();
    showToast('🗑️ Route deleted');
  } catch(e) {
    showToast('❌ Could not delete route');
  }
}

function closeSavedRoutes() {
  document.getElementById('savedRoutesModal').style.display = 'none';
}

// ============================================================
// PDF REPORT
// ============================================================

function downloadReport() {
  if (!currentRouteData) {
    showToast('⚠️ No route data. Find a route first.');
    return;
  }

  const data = currentRouteData;
  const route = data.routes[activeRouteIndex];
  const cat = route.aqi_category;
  const now = new Date().toLocaleString();

  // Build printable HTML
  const html = `<!DOCTYPE html>
<html>
<head>
<title>VayuPath Route Report</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:Arial,sans-serif; color:#111; padding:2cm; }
  h1 { color:#00a372; font-size:2rem; margin-bottom:.25rem; }
  .sub { color:#555; font-size:.9rem; margin-bottom:2rem; }
  .section { margin-bottom:1.5rem; }
  h2 { color:#00a372; font-size:1.1rem; border-bottom:2px solid #00a372; padding-bottom:.4rem; margin-bottom:.75rem; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:.5rem .75rem; border:1px solid #ddd; font-size:.875rem; }
  th { background:#f0f9f5; }
  .badge { display:inline-block; padding:2px 10px; border-radius:20px; color:white; font-size:.8rem; }
  .footer { margin-top:2rem; font-size:.75rem; color:#888; border-top:1px solid #ddd; padding-top:1rem; }
</style>
</head>
<body>
<h1>🌬️ VayuPath Route Report</h1>
<div class="sub">Generated on ${now}</div>

<div class="section">
<h2>Journey Details</h2>
<table>
  <tr><th>From</th><td>${data.source.name}</td></tr>
  <tr><th>To</th><td>${data.destination.name}</td></tr>
  <tr><th>Recommended Route</th><td>${route.name}</td></tr>
  <tr><th>Distance</th><td>${route.distance_km} km</td></tr>
  <tr><th>Est. Travel Time</th><td>${route.travel_time}</td></tr>
</table>
</div>

<div class="section">
<h2>Air Quality Summary</h2>
<table>
  <tr><th>Average AQI</th><td>${route.avg_aqi} <span class="badge" style="background:${cat.color}">${cat.label}</span></td></tr>
  <tr><th>Maximum AQI</th><td>${route.max_aqi}</td></tr>
  <tr><th>Hazardous Zones</th><td>${route.hazardous_zones}</td></tr>
  <tr><th>Advice</th><td>${cat.advice}</td></tr>
</table>
</div>

<div class="section">
<h2>All Route Options</h2>
<table>
  <tr><th>Route</th><th>Avg AQI</th><th>Distance</th><th>Time</th><th>Hazardous Zones</th></tr>
  ${data.routes.map(r => `<tr>
    <td>${r.name}${r.is_recommended ? ' ⭐' : ''}</td>
    <td>${r.avg_aqi}</td>
    <td>${r.distance_km} km</td>
    <td>${r.travel_time}</td>
    <td>${r.hazardous_zones}</td>
  </tr>`).join('')}
</table>
</div>

<div class="section">
<h2>AQI Scale Reference</h2>
<table>
  <tr><td style="background:#e8f5e9">🟢 Good (0–50)</td><td>Air quality is satisfactory</td></tr>
  <tr><td style="background:#fffde7">🟡 Moderate (51–100)</td><td>Sensitive groups should take care</td></tr>
  <tr><td style="background:#fff3e0">🟠 Unhealthy for Sensitive (101–150)</td><td>Wear masks</td></tr>
  <tr><td style="background:#ffebee">🔴 Unhealthy (151–200)</td><td>N95 mask recommended</td></tr>
  <tr><td style="background:#f3e5f5">🟣 Very Unhealthy (201–300)</td><td>Minimize outdoor exposure</td></tr>
  <tr><td style="background:#efebe9">⬛ Hazardous (300+)</td><td>Stay indoors. Health emergency.</td></tr>
</table>
</div>

<div class="footer">
  <strong>VayuPath — AQI Smart Route Optimizer</strong><br>
  This report is generated based on real-time/simulated AQI data. Always check current conditions before travelling.
</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  setTimeout(() => w.print(), 500);
  showToast('📥 Opening print dialog...');
}

// ============================================================
// VOICE INPUT
// ============================================================

function startVoice() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    showToast('🎤 Voice input not supported in this browser');
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  recognition.lang = 'en-IN';
  recognition.continuous = false;
  recognition.interimResults = false;

  showToast('🎤 Listening... Say "from [city] to [city]"');

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    parseVoiceInput(transcript);
  };

  recognition.onerror = () => {
    showToast('🎤 Voice recognition failed. Try again.');
  };

  recognition.start();
}

function parseVoiceInput(transcript) {
  const lower = transcript.toLowerCase();
  const fromMatch = lower.match(/from\s+(\w+(?:\s+\w+)?)/);
  const toMatch = lower.match(/to\s+(\w+(?:\s+\w+)?)/);

  if (fromMatch) {
    document.getElementById('source-input').value = capitalize(fromMatch[1]);
  }
  if (toMatch) {
    document.getElementById('dest-input').value = capitalize(toMatch[1]);
  }

  showToast(`🎤 Heard: "${transcript}"`);
}

function capitalize(s) {
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ============================================================
// UTILITIES
// ============================================================

function swapLocations() {
  const src = document.getElementById('source-input');
  const dst = document.getElementById('dest-input');
  const tmp = src.value;
  src.value = dst.value;
  dst.value = tmp;
}

function useMyLocation() {
  if (!navigator.geolocation) {
    showToast('❌ Geolocation not supported');
    return;
  }
  showToast('📍 Getting your location...');
  navigator.geolocation.getCurrentPosition(
    pos => {
      document.getElementById('source-input').value =
        `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
      showToast('📍 Location detected!');
    },
    () => showToast('❌ Could not get location. Check permissions.')
  );
}

function resetMapView() {
  map.setView(INDIA_CENTER, INDIA_ZOOM);
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (window.innerWidth <= 768) {
    sidebar.classList.toggle('open');
  } else {
    isSidebarOpen = !isSidebarOpen;
    sidebar.classList.toggle('collapsed', !isSidebarOpen);
  }
}

function toggleUserMenu() {
  const dropdown = document.getElementById('userDropdown');
  if (dropdown) dropdown.classList.toggle('open');
}

function setLoading(show, text = 'Loading...') {
  const overlay = document.getElementById('mapLoading');
  const btn = document.getElementById('findBtn');
  overlay.style.display = show ? 'flex' : 'none';
  if (show) {
    document.getElementById('loadingText').textContent = text;
    btn.disabled = true;
    document.getElementById('find-btn-text').textContent = 'Analyzing...';
  } else {
    btn.disabled = false;
    document.getElementById('find-btn-text').textContent = 'Find Optimal Route';
  }
}

function setLoadingText(text) {
  document.getElementById('loadingText').textContent = text;
}

function showToast(msg, duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

function updateTicker(route) {
  const el = document.getElementById('ticker-text');
  if (el && route) {
    const cat = route.aqi_category;
    el.textContent = `Live AQI on recommended route: ${route.avg_aqi} — ${cat.label}`;
  }
}

// Live AQI ticker for major cities
async function refreshTicker() {
  const cities = ['delhi', 'mumbai', 'bangalore', 'chennai', 'kolkata'];
  const city = cities[Math.floor(Math.random() * cities.length)];
  try {
    const res = await fetch(`/api/aqi-live/${city}`);
    const data = await res.json();
    const el = document.getElementById('ticker-text');
    if (el && data.aqi) {
      el.textContent = `${capitalize(city)}: AQI ${data.aqi} — ${data.category.label}`;
    }
  } catch(e) { /* silent */ }
}

// Close modals on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
  }

  // Close user dropdown if click outside
  if (!e.target.closest('.user-menu')) {
    const dd = document.getElementById('userDropdown');
    if (dd) dd.classList.remove('open');
  }
});

// Enter key handler
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const src = document.getElementById('source-input');
    const dst = document.getElementById('dest-input');
    if (document.activeElement === src || document.activeElement === dst) {
      findRoutes();
    }
  }
});

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Restore theme
  const savedTheme = localStorage.getItem('vayupath-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  const btn = document.getElementById('darkModeToggle');
  if (btn) btn.textContent = savedTheme === 'dark' ? '🌙' : '☀️';

  // Init map
  initMap();

  // Start live ticker
  refreshTicker();
  setInterval(refreshTicker, 30000);
});
