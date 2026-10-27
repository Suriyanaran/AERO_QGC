/**
 * AERO-Q Tactical Map & Waypoint Mission Planner
 * High-performance dark tactical mapping powered by Leaflet.js.
 */

class TacticalMapManager {
  constructor(mapElementId) {
    this.mapId = mapElementId;
    this.map = null;
    this.droneMarker = null;
    this.homeMarker = null;
    this.flightPathPolyline = null;
    this.missionPolyline = null;
    
    this.flightBreadcrumbs = [];
    this.waypoints = [];
    this.planningMode = false;
    
    this.lastLat = 13.0827;
    this.lastLon = 80.2707;
    this.lastYaw = 0;
    
    this.initMap();
  }

  initMap() {
    // 1. Initialize Leaflet map
    this.map = L.map(this.mapId, {
      center: [this.lastLat, this.lastLon],
      zoom: 16,
      zoomControl: false,
      attributionControl: false
    });

    // Zoom control in bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // 2. High-contrast Tactical Satellite & Dark Layers (No API Key Required)
    const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: ''
    }).addTo(this.map);

    const tacticalDarkLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 16,
      maxZoom: 19,
      attribution: ''
    });

    // Layer control toggle
    L.control.layers({
      "Satellite Imagery": satelliteLayer,
      "Tactical Dark": tacticalDarkLayer
    }, null, { position: 'topright' }).addTo(this.map);

    // 3. Custom Tactical Police Drone SVG Icon with Red & Blue Emergency Strobes
    const droneSvgIcon = L.divIcon({
      className: 'tactical-drone-marker',
      html: `
        <div id="drone-icon-wrapper" style="width: 64px; height: 64px; transform: rotate(0deg); transition: transform 0.1s linear;">
          <svg class="police-drone-svg" viewBox="0 0 100 100" width="64" height="64">
            <defs>
              <linearGradient id="fuselageGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#141c2e"/>
                <stop offset="50%" stop-color="#0a101f"/>
                <stop offset="100%" stop-color="#050811"/>
              </linearGradient>
              <linearGradient id="armGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#334155"/>
                <stop offset="100%" stop-color="#0f172a"/>
              </linearGradient>
            </defs>

            <!-- 1. Carbon Frame Arms -->
            <line x1="50" y1="50" x2="22" y2="22" stroke="url(#armGrad)" stroke-width="7" stroke-linecap="round"/>
            <line x1="50" y1="50" x2="78" y2="22" stroke="url(#armGrad)" stroke-width="7" stroke-linecap="round"/>
            <line x1="50" y1="50" x2="22" y2="78" stroke="url(#armGrad)" stroke-width="7" stroke-linecap="round"/>
            <line x1="50" y1="50" x2="78" y2="78" stroke="url(#armGrad)" stroke-width="7" stroke-linecap="round"/>

            <!-- Arm Cyber Inset Accents -->
            <line x1="50" y1="50" x2="22" y2="22" stroke="#00e5ff" stroke-width="1.4" opacity="0.7"/>
            <line x1="50" y1="50" x2="78" y2="22" stroke="#00e5ff" stroke-width="1.4" opacity="0.7"/>
            <line x1="50" y1="50" x2="22" y2="78" stroke="#00e5ff" stroke-width="1.4" opacity="0.7"/>
            <line x1="50" y1="50" x2="78" y2="78" stroke="#00e5ff" stroke-width="1.4" opacity="0.7"/>

            <!-- 2. Rotor Guards & Motor Pods (Static & Clean) -->
            <circle cx="22" cy="22" r="14" fill="rgba(8,16,32,0.4)" stroke="#334155" stroke-width="1.2"/>
            <circle cx="78" cy="22" r="14" fill="rgba(8,16,32,0.4)" stroke="#334155" stroke-width="1.2"/>
            <circle cx="22" cy="78" r="14" fill="rgba(8,16,32,0.4)" stroke="#334155" stroke-width="1.2"/>
            <circle cx="78" cy="78" r="14" fill="rgba(8,16,32,0.4)" stroke="#334155" stroke-width="1.2"/>

            <circle cx="22" cy="22" r="5.5" fill="#0b1329" stroke="#64748b" stroke-width="1.4"/>
            <circle cx="78" cy="22" r="5.5" fill="#0b1329" stroke="#64748b" stroke-width="1.4"/>
            <circle cx="22" cy="78" r="5.5" fill="#0b1329" stroke="#64748b" stroke-width="1.4"/>
            <circle cx="78" cy="78" r="5.5" fill="#0b1329" stroke="#64748b" stroke-width="1.4"/>

            <!-- 3. Tactical Police Fuselage (Chassis) -->
            <polygon points="50,14 63,28 66,48 58,73 50,83 42,73 34,48 37,28" 
                     fill="url(#fuselageGrad)" stroke="#1e293b" stroke-width="2.5" stroke-linejoin="round"/>
            
            <polygon points="50,18 59,29 62,47 56,70 50,78 44,70 38,47 41,29" 
                     fill="#0b1329" stroke="#00e5ff" stroke-width="0.8" opacity="0.9" stroke-linejoin="round"/>

            <!-- Forward Heading Chevron (Points directly forward 0° heading) -->
            <polygon points="50,22 55,29 50,27 45,29" fill="#00e5ff"/>

            <!-- Front Optical FLIR Gimbal Lens / Headlight -->
            <circle cx="50" cy="17" r="3.2" fill="#0284c7" stroke="#ffffff" stroke-width="1"/>
            <circle cx="50" cy="17" r="1.2" fill="#ffffff"/>

            <!-- 4. POLICE TOP EMERGENCY LIGHTBAR (Red & Blue Wig-Wag Strobes) -->
            <rect x="34" y="36" width="32" height="8" rx="2" fill="#020611" stroke="#64748b" stroke-width="1"/>
            <!-- Left Strobe: RED -->
            <rect x="35.5" y="37.5" width="13" height="5" rx="1.5" fill="#ff1744" class="police-light-red"/>
            <line x1="37" y1="40" x2="47" y2="40" stroke="#ffffff" stroke-width="1.2" class="police-light-red"/>
            <!-- Right Strobe: BLUE -->
            <rect x="51.5" y="37.5" width="13" height="5" rx="1.5" fill="#00e5ff" class="police-light-blue"/>
            <line x1="53" y1="40" x2="63" y2="40" stroke="#ffffff" stroke-width="1.2" class="police-light-blue"/>
            <line x1="50" y1="36" x2="50" y2="44" stroke="#0f172a" stroke-width="1.8"/>

            <!-- 5. Police Identification & Emblem -->
            <polygon points="50,47 53,50 50,55 47,50" fill="#facc15" stroke="#ca8a04" stroke-width="0.7"/>
            <text x="50" y="63" font-family="'Orbitron', 'Rajdhani', sans-serif" font-size="6.5" font-weight="900" fill="#f8fafc" text-anchor="middle" letter-spacing="1">POLICE</text>
            <text x="50" y="71" font-family="'Rajdhani', sans-serif" font-size="4.8" font-weight="700" fill="#38bdf8" text-anchor="middle" letter-spacing="0.8">INTERCEPTOR</text>

            <!-- 6. Corner Police Flashing Strobe Lights (4 Arms) -->
            <!-- Front-Left: Red Strobe -->
            <circle cx="22" cy="22" r="4" fill="#ff1744" class="police-light-red"/>
            <circle cx="22" cy="22" r="1.5" fill="#ffffff" class="police-light-red"/>

            <!-- Rear-Left: Red Strobe -->
            <circle cx="22" cy="78" r="4" fill="#ff1744" class="police-light-red"/>
            <circle cx="22" cy="78" r="1.5" fill="#ffffff" class="police-light-red"/>

            <!-- Front-Right: Blue Strobe -->
            <circle cx="78" cy="22" r="4" fill="#00e5ff" class="police-light-blue"/>
            <circle cx="78" cy="22" r="1.5" fill="#ffffff" class="police-light-blue"/>

            <!-- Rear-Right: Blue Strobe -->
            <circle cx="78" cy="78" r="4" fill="#00e5ff" class="police-light-blue"/>
            <circle cx="78" cy="78" r="1.5" fill="#ffffff" class="police-light-blue"/>
          </svg>
        </div>
      `,
      iconSize: [64, 64],
      iconAnchor: [32, 32]
    });

    this.droneMarker = L.marker([this.lastLat, this.lastLon], { icon: droneSvgIcon }).addTo(this.map);

    // 4. Live Breadcrumbs Flight Trail
    this.flightPathPolyline = L.polyline([], {
      color: '#00e5ff',
      weight: 3,
      opacity: 0.85,
      dashArray: '5, 5'
    }).addTo(this.map);

    // 5. Waypoint Mission Route Polyline
    this.missionPolyline = L.polyline([], {
      color: '#ffea00',
      weight: 2.5,
      opacity: 0.9,
      dashArray: '8, 8'
    }).addTo(this.map);

    // Map Click Listener (for Waypoint creation)
    this.map.on('click', (e) => {
      if (this.planningMode) {
        this.addWaypoint(e.latlng.lat, e.latlng.lng);
      }
    });
  }

  updateDronePosition(lat, lon, yaw, alt) {
    if (!lat || !lon) return;

    this.lastLat = lat;
    this.lastLon = lon;
    this.lastYaw = yaw || 0;

    // Update marker position
    this.droneMarker.setLatLng([lat, lon]);

    // Update marker rotation
    const wrapper = document.getElementById('drone-icon-wrapper');
    if (wrapper) {
      wrapper.style.transform = `rotate(${this.lastYaw}deg)`;
    }

    // Append to breadcrumb trail
    this.flightBreadcrumbs.push([lat, lon]);
    if (this.flightBreadcrumbs.length > 250) {
      this.flightBreadcrumbs.shift();
    }
    this.flightPathPolyline.setLatLngs(this.flightBreadcrumbs);

    // Coordinates Readout Overlay
    const latEl = document.getElementById('map-drone-lat');
    const lonEl = document.getElementById('map-drone-lon');
    const altEl = document.getElementById('map-drone-alt');
    if (latEl) latEl.textContent = lat.toFixed(6);
    if (lonEl) lonEl.textContent = lon.toFixed(6);
    if (altEl) altEl.textContent = `${alt.toFixed(2)} m`;
  }

  addWaypoint(lat, lon) {
    const wpNum = this.waypoints.length + 1;
    const wpAlt = parseFloat(document.getElementById('takeoff-alt-input')?.value || 15.0);

    // Custom Waypoint Marker Pin
    const wpIcon = L.divIcon({
      className: 'tactical-wp-pin',
      html: `
        <div style="background: rgba(2, 132, 199, 0.9); border: 1.5px solid #00e5ff; color: #fff; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-family: 'Orbitron', sans-serif; font-size: 10px; font-weight: bold; box-shadow: 0 0 10px #00e5ff;">
          ${wpNum}
        </div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    const marker = L.marker([lat, lon], { icon: wpIcon }).addTo(this.map);
    
    this.waypoints.push({
      num: wpNum,
      lat: lat,
      lon: lon,
      alt: wpAlt,
      marker: marker
    });

    this.updateMissionPolyline();
    this.calculateMissionStats();
  }

  updateMissionPolyline() {
    const coords = this.waypoints.map(wp => [wp.lat, wp.lon]);
    this.missionPolyline.setLatLngs(coords);
  }

  clearWaypoints() {
    this.waypoints.forEach(wp => {
      this.map.removeLayer(wp.marker);
    });
    this.waypoints = [];
    this.missionPolyline.setLatLngs([]);
    this.calculateMissionStats();
  }

  calculateMissionStats() {
    let totalDistMeters = 0;
    for (let i = 0; i < this.waypoints.length - 1; i++) {
      const p1 = L.latLng(this.waypoints[i].lat, this.waypoints[i].lon);
      const p2 = L.latLng(this.waypoints[i + 1].lat, this.waypoints[i + 1].lon);
      totalDistMeters += p1.distanceTo(p2);
    }

    const distKm = (totalDistMeters / 1000).toFixed(2);
    const speedMs = 7.0; // Cruise speed
    const totalSecs = Math.round(totalDistMeters / speedMs);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;

    const countEl = document.getElementById('stat-wp-count');
    const distEl = document.getElementById('stat-wp-dist');
    const timeEl = document.getElementById('stat-wp-time');

    if (countEl) countEl.textContent = this.waypoints.length;
    if (distEl) distEl.textContent = `${distKm} km`;
    if (timeEl) timeEl.textContent = `${mins}m ${secs.toString().padStart(2, '0')}s`;
  }

  recenter() {
    if (this.lastLat && this.lastLon) {
      this.map.panTo([this.lastLat, this.lastLon], { animate: true });
    }
  }
}
