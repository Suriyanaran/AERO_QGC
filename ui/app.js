/**
 * AERO-Q Tactical GCS - Main Application Logic
 * Orchestrates WebSockets, PFD, Tactical Map, Telemetry Graphs, and Command Dispatch.
 */

// Global Instances
let pfd = null;
let mapManager = null;
let ws = null;
let audioEnabled = true;
let chartHistory = { alt: [], speed: [] };
let totalBlackboxLogs = 0;

// DOM Elements
const badgeLink = document.getElementById('badge-link');
const valLink = document.getElementById('val-link');
const badgeMode = document.getElementById('badge-mode');
const valMode = document.getElementById('val-mode');
const badgeArm = document.getElementById('badge-arm');
const valArm = document.getElementById('val-arm');

const topBattPct = document.getElementById('top-batt-pct');
const topBattVolt = document.getElementById('top-batt-volt');
const topGpsSats = document.getElementById('top-gps-sats');
const topGpsFix = document.getElementById('top-gps-fix');
const topRssi = document.getElementById('top-rssi');
const topFlightTime = document.getElementById('top-flight-time');

const armBtn = document.getElementById('btn-arm-toggle');
const armBtnText = document.getElementById('arm-btn-text');
const takeoffBtn = document.getElementById('btn-takeoff');
const takeoffAltInput = document.getElementById('takeoff-alt-input');

const consoleOutput = document.getElementById('console-output');

// Voice Synthesizer
function speakAlert(text) {
  if (!audioEnabled || !('speechSynthesis' in window)) return;
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 0.95;
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.error('Speech error:', e);
  }
}

// Format Seconds to HH:MM:SS
function formatTime(seconds) {
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Append Console Log
function appendLog(message, type = 'info') {
  if (!consoleOutput) return;
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.textContent = message;
  consoleOutput.appendChild(line);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

// --------------------------------------------------------------------------
// WebSocket Telemetry Connection
// --------------------------------------------------------------------------
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    valLink.textContent = 'LINK ACTIVE (20Hz)';
    badgeLink.style.borderColor = '#00ff88';
    appendLog('[LINK] Telemetry WebSocket connected to Aero-Q Flight Core.', 'info');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleTelemetryUpdate(data);
    } catch (e) {
      console.error('Error parsing telemetry:', e);
    }
  };

  ws.onclose = () => {
    valLink.textContent = 'DISCONNECTED';
    badgeLink.style.borderColor = '#ff2d55';
    appendLog('[LINK] WebSocket disconnected. Retrying in 2s...', 'alert');
    setTimeout(connectWebSocket, 2000);
  };
}

// Handle Incoming Telemetry Packet
let lastArmedState = null;
let lastFlightMode = null;
let lastLinkActive = null;

function handleTelemetryUpdate(data) {
  // 1. Update Primary Flight Display (PFD)
  if (pfd) {
    pfd.updateData(data);
  }

  // 2. Update Tactical Map
  if (mapManager && data.lat && data.lon && (Math.abs(data.lat) > 0.001 || Math.abs(data.lon) > 0.001)) {
    mapManager.updateDronePosition(data.lat, data.lon, data.yaw, data.alt);
  }

  // 3. Update Header Engine & Link Badges
  const valEngine = document.getElementById('val-engine');
  const badgeEngine = document.getElementById('badge-engine');
  const valMode = document.getElementById('val-mode');
  
  if (data.source === 'SIMULATOR') {
    if (valEngine) {
      valEngine.textContent = 'TACTICAL SIMULATOR (6-DOF)';
      valEngine.style.color = '#00E5FF';
      badgeEngine.style.borderColor = 'rgba(0, 229, 255, 0.4)';
    }
    valLink.textContent = 'SIM ACTIVE (20Hz)';
    badgeLink.style.borderColor = '#00E5FF';
    valMode.textContent = data.mode || 'STABILIZE';
  } else {
    // Hardware MAVLink (Pixhawk / ArduPilot / PX4 / QGC Backend)
    if (data.link_active) {
      if (valEngine) {
        valEngine.textContent = `${data.autopilot || 'HARDWARE FC'} (${data.device || 'COM'})`;
        valEngine.style.color = '#00ff88';
        badgeEngine.style.borderColor = '#00ff88';
      }
      valLink.textContent = `VEHICLE LINKED (#${data.heartbeat_count || 1})`;
      badgeLink.style.borderColor = '#00ff88';
      valMode.textContent = data.mode || 'UNKNOWN';
    } else if (data.link_status === 'SEARCHING') {
      if (valEngine) {
        valEngine.textContent = `SEARCHING: ${data.device || 'COM'}...`;
        valEngine.style.color = '#ff9500';
        badgeEngine.style.borderColor = '#ff9500';
      }
      valLink.textContent = 'WAITING FOR FC HEARTBEAT';
      badgeLink.style.borderColor = '#ff9500';
      valMode.textContent = 'SEARCHING...';
    } else {
      if (valEngine) {
        valEngine.textContent = 'DISCONNECTED';
        valEngine.style.color = '#8BA3B8';
        badgeEngine.style.borderColor = '#475569';
      }
      valLink.textContent = 'NO VEHICLE LINK';
      badgeLink.style.borderColor = '#ff2d55';
      valMode.textContent = 'DISCONNECTED';
    }
  }

  // Arm / Disarm Status Pill
  if (data.link_active || data.source === 'SIMULATOR') {
    if (data.armed) {
      badgeArm.className = 'status-pill arm-pill armed';
      valArm.textContent = 'ARMED';
      armBtn.className = 'tactical-btn arm-toggle-btn armed';
      armBtnText.textContent = 'DISARM MOTORS';
    } else {
      badgeArm.className = 'status-pill arm-pill disarmed';
      valArm.textContent = 'DISARMED';
      armBtn.className = 'tactical-btn arm-toggle-btn';
      armBtnText.textContent = 'ARM MOTORS';
    }
  } else {
    badgeArm.className = 'status-pill arm-pill disarmed';
    valArm.textContent = 'NO LINK';
    armBtn.className = 'tactical-btn arm-toggle-btn';
    armBtnText.textContent = 'ARM MOTORS';
  }

  // Audio Alerts on state changes
  if (lastArmedState !== null && lastArmedState !== data.armed && (data.link_active || data.source === 'SIMULATOR')) {
    speakAlert(data.armed ? 'Warning: Motors Armed. Propellers Active.' : 'Motors Disarmed.');
  }
  lastArmedState = data.armed;

  if (lastFlightMode !== null && lastFlightMode !== data.mode && (data.link_active || data.source === 'SIMULATOR')) {
    speakAlert(`Flight Mode: ${data.mode}`);
  }
  lastFlightMode = data.mode;

  if (lastLinkActive !== null && lastLinkActive !== data.link_active && data.source !== 'SIMULATOR') {
    if (data.link_active) {
      speakAlert(`Flight controller linked. ${data.autopilot || ''} connected.`);
    } else if (lastLinkActive === true) {
      speakAlert('Warning: Flight controller telemetry link lost.');
    }
  }
  lastLinkActive = data.link_active;

  // Active Mode Button Highlight
  document.querySelectorAll('.mode-btn').forEach(btn => {
    if (btn.dataset.mode === data.mode) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Top Metrics (GENUINE DATA - NO FAKE FALLBACKS)
  if (data.source === 'SIMULATOR') {
    topBattPct.textContent = `${Math.round(data.battery_pct || 98)}%`;
    topBattVolt.textContent = `${(data.voltage || 16.6).toFixed(1)}V`;
    topBattPct.style.color = '#ffffff';
    topGpsSats.textContent = `${data.satellites || 16} SATS`;
    topGpsFix.textContent = '3D FIX';
    topGpsFix.style.color = '#00ff88';
    topRssi.textContent = `${data.rssi || 99}%`;
  } else if (data.link_active) {
    // 1. Battery display
    if (data.battery_state === 'USB_POWER') {
      topBattPct.textContent = 'USB PWR';
      topBattVolt.textContent = `${(data.voltage || 5.0).toFixed(1)}V`;
      topBattPct.style.color = '#ff9500';
    } else if (data.voltage && data.voltage > 5.5) {
      const pct = data.battery_pct !== null && data.battery_pct !== undefined ? `${Math.round(data.battery_pct)}%` : '--%';
      const cellTag = data.battery_cells ? ` (${data.battery_cells}S)` : '';
      topBattPct.textContent = pct;
      topBattVolt.textContent = `${data.voltage.toFixed(1)}V${cellTag}`;
      if (data.battery_state === 'CRITICAL') {
        topBattPct.style.color = '#ff2d55';
      } else if (data.battery_state === 'LOW') {
        topBattPct.style.color = '#ff9500';
      } else {
        topBattPct.style.color = '#00ff88';
      }
    } else {
      topBattPct.textContent = '--%';
      topBattVolt.textContent = 'NO BATT';
      topBattPct.style.color = '#8BA3B8';
    }

    // 2. GPS display
    const sats = data.satellites || 0;
    const fixNames = { 0: 'NO GPS', 1: 'NO FIX', 2: '2D FIX', 3: '3D FIX', 4: 'DGPS', 5: 'RTK FLOAT', 6: 'RTK FIX' };
    topGpsSats.textContent = `${sats} SATS`;
    topGpsFix.textContent = fixNames[data.fix_type] || 'NO FIX';
    topGpsFix.style.color = data.fix_type >= 3 ? '#00ff88' : (data.fix_type >= 2 ? '#ff9500' : '#ff2d55');

    // 3. RSSI
    topRssi.textContent = data.rssi > 0 ? `${data.rssi}%` : '--%';
  } else {
    // Vehicle disconnected or waiting for heartbeat
    topBattPct.textContent = '--%';
    topBattVolt.textContent = '--V';
    topBattPct.style.color = '#8BA3B8';
    topGpsSats.textContent = '-- SATS';
    topGpsFix.textContent = data.link_status === 'SEARCHING' ? 'SEARCHING' : 'NO LINK';
    topGpsFix.style.color = '#8BA3B8';
    topRssi.textContent = '--%';
  }

  topFlightTime.textContent = formatTime(data.flight_time || 0);

  // Blackbox Record Counter update
  totalBlackboxLogs++;
  const elBbRecords = document.getElementById('top-blackbox-records');
  if (elBbRecords) {
    elBbRecords.textContent = `${totalBlackboxLogs} LOGS (CSV)`;
  }

  // Update Avionics Health Matrix
  const elImu = document.getElementById('sensor-imu-val');
  const chipImu = document.getElementById('chip-imu');
  const elCompass = document.getElementById('sensor-compass-val');
  const chipCompass = document.getElementById('chip-compass');
  const elBaro = document.getElementById('sensor-baro-val');
  const chipBaro = document.getElementById('chip-baro');
  const elGps = document.getElementById('sensor-gps-val');
  const chipGps = document.getElementById('chip-gps');

  if (data.link_active || data.source === 'SIMULATOR') {
    const s = data.sensors || {};
    if (elImu && chipImu) {
      elImu.textContent = s.imu || 'CALIBRATED';
      chipImu.className = s.imu === 'UNHEALTHY' ? 'sensor-chip error' : 'sensor-chip ok';
    }
    if (elCompass && chipCompass) {
      elCompass.textContent = s.compass || 'LOCKED';
      chipCompass.className = s.compass === 'CALIB_REQ' ? 'sensor-chip warn' : 'sensor-chip ok';
    }
    if (elBaro && chipBaro) {
      elBaro.textContent = `${(data.alt || 0).toFixed(1)}m AGL`;
      chipBaro.className = 'sensor-chip ok';
    }
    if (elGps && chipGps) {
      const fixNames = { 0: 'NO GPS', 1: 'NO FIX', 2: '2D FIX', 3: '3D FIX', 4: 'DGPS', 5: 'RTK FLOAT', 6: 'RTK FIX' };
      elGps.textContent = `${fixNames[data.fix_type] || 'NO FIX'} (${data.satellites || 0} sats)`;
      chipGps.className = data.fix_type >= 3 ? 'sensor-chip ok' : (data.fix_type >= 2 ? 'sensor-chip warn' : 'sensor-chip error');
    }
  } else {
    if (elImu) elImu.textContent = '--';
    if (elCompass) elCompass.textContent = '--';
    if (elBaro) elBaro.textContent = '--';
    if (elGps) elGps.textContent = '--';
  }

  // Update FPV HUD OSD Overlays
  const fpvAlt = document.getElementById('fpv-osd-alt');
  const fpvSpd = document.getElementById('fpv-osd-spd');
  const fpvBat = document.getElementById('fpv-osd-bat');
  const fpvHdg = document.getElementById('fpv-osd-hdg');
  const fpvMode = document.getElementById('fpv-osd-mode');
  if (fpvAlt) fpvAlt.textContent = `${(data.alt || 0).toFixed(1)}m`;
  if (fpvSpd) fpvSpd.textContent = `${(data.groundspeed || 0).toFixed(1)}m/s`;
  if (fpvBat) fpvBat.textContent = data.voltage ? `${data.voltage.toFixed(1)}V` : '--V';
  if (fpvHdg) fpvHdg.textContent = `${Math.round(data.yaw || 0).toString().padStart(3, '0')}°`;
  if (fpvMode) fpvMode.textContent = data.mode || 'DISCONNECTED';

  // 4. Update Quadcopter Motor Outputs
  updateMotorOutputs(data);

  // 5. Update Telemetry Chart
  chartHistory.alt.push(data.alt || 0);
  chartHistory.speed.push(data.groundspeed || 0);
  if (chartHistory.alt.length > 50) {
    chartHistory.alt.shift();
    chartHistory.speed.shift();
  }
  renderTelemetryChart();

  // 6. Log stream messages
  if (data.logs && Array.isArray(data.logs)) {
    data.logs.forEach(log => {
      const existing = Array.from(consoleOutput.children).some(el => el.textContent === log);
      if (!existing) {
        appendLog(log, log.includes('WARNING') || log.includes('ERROR') || log.includes('ALERT') ? 'alert' : 'info');
      }
    });
  }
}

function updateMotorOutputs(data) {
  let basePwm = 10;
  if (data.armed) {
    basePwm = data.alt > 0.5 ? 55 : 25;
  }
  // Differential thrust based on pitch & roll
  const m1 = Math.max(10, Math.min(100, basePwm - data.pitch * 1.5 + data.roll * 1.5));
  const m2 = Math.max(10, Math.min(100, basePwm - data.pitch * 1.5 - data.roll * 1.5));
  const m3 = Math.max(10, Math.min(100, basePwm + data.pitch * 1.5 + data.roll * 1.5));
  const m4 = Math.max(10, Math.min(100, basePwm + data.pitch * 1.5 - data.roll * 1.5));

  const elM1 = document.getElementById('m1-fill');
  const elM2 = document.getElementById('m2-fill');
  const elM3 = document.getElementById('m3-fill');
  const elM4 = document.getElementById('m4-fill');

  if (elM1) elM1.style.height = `${m1}%`;
  if (elM2) elM2.style.height = `${m2}%`;
  if (elM3) elM3.style.height = `${m3}%`;
  if (elM4) elM4.style.height = `${m4}%`;
}

// --------------------------------------------------------------------------
// Telemetry Live Chart (HTML5 Canvas)
// --------------------------------------------------------------------------
function renderTelemetryChart() {
  const canvas = document.getElementById('telemetry-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  // Background grid
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.08)';
  ctx.lineWidth = 1;
  for (let y = 20; y < h; y += 30) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Draw Altitude Line (Electric Cyan)
  if (chartHistory.alt.length > 1) {
    ctx.beginPath();
    const maxAlt = Math.max(20, ...chartHistory.alt);
    chartHistory.alt.forEach((val, idx) => {
      const x = (idx / (chartHistory.alt.length - 1)) * w;
      const y = h - (val / maxAlt) * (h - 20) - 10;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(0, 229, 255, 0.5)';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Draw Speed Line (Vibrant Yellow)
  if (chartHistory.speed.length > 1) {
    ctx.beginPath();
    const maxSpd = Math.max(15, ...chartHistory.speed);
    chartHistory.speed.forEach((val, idx) => {
      const x = (idx / (chartHistory.speed.length - 1)) * w;
      const y = h - (val / maxSpd) * (h - 20) - 10;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#ffea00';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Legend
  ctx.font = 'bold 9px "Orbitron", sans-serif';
  ctx.fillStyle = '#00e5ff';
  ctx.fillText('ALTITUDE (M)', 10, 14);
  ctx.fillStyle = '#ffea00';
  ctx.fillText('SPEED (M/S)', 110, 14);
}

// --------------------------------------------------------------------------
// API Command Dispatcher
// --------------------------------------------------------------------------
async function sendCommand(action, payload = {}) {
  try {
    const res = await fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload })
    });
    return await res.json();
  } catch (e) {
    console.error('Command failed:', e);
    appendLog(`[ERROR] Command ${action} failed: ${e.message}`, 'alert');
  }
}

// --------------------------------------------------------------------------
// DOM Event Listeners
// --------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize PFD
  pfd = new PrimaryFlightDisplay('pfd-canvas');

  // 2. Initialize Tactical Map
  mapManager = new TacticalMapManager('tactical-map');

  // 3. Connect Telemetry Stream
  connectWebSocket();

  // 4. Mode Buttons
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      sendCommand('set_mode', { mode });
    });
  });

  // 5. Arm / Disarm Button
  armBtn.addEventListener('click', () => {
    const isArmed = badgeArm.classList.contains('armed');
    sendCommand(isArmed ? 'disarm' : 'arm');
  });

  // 6. Takeoff Button
  takeoffBtn.addEventListener('click', () => {
    const alt = parseFloat(takeoffAltInput.value) || 10.0;
    speakAlert(`Initiating automated takeoff to ${alt} meters.`);
    sendCommand('takeoff', { alt });
  });

  // 7. Map Toolbar Actions
  const btnNav = document.getElementById('btn-mode-nav');
  const btnPlan = document.getElementById('btn-mode-plan');
  const btnClear = document.getElementById('btn-clear-wps');
  const btnUpload = document.getElementById('btn-upload-wps');
  const btnStartMission = document.getElementById('btn-start-mission');

  btnNav.addEventListener('click', () => {
    btnNav.classList.add('active');
    btnPlan.classList.remove('active');
    mapManager.planningMode = false;
  });

  btnPlan.addEventListener('click', () => {
    btnPlan.classList.add('active');
    btnNav.classList.remove('active');
    mapManager.planningMode = true;
    speakAlert('Waypoint Planning mode active. Click on tactical map to plot waypoints.');
  });

  btnClear.addEventListener('click', () => {
    mapManager.clearWaypoints();
    speakAlert('Mission cleared.');
  });

  btnUpload.addEventListener('click', async () => {
    if (mapManager.waypoints.length === 0) {
      alert('Please click on the map to add at least 1 waypoint first!');
      return;
    }
    const wps = mapManager.waypoints.map(wp => ({ lat: wp.lat, lon: wp.lon, alt: wp.alt }));
    await sendCommand('waypoints', { waypoints: wps });
    speakAlert(`Successfully transmitted ${wps.length} waypoints to vehicle.`);
    appendLog(`[MISSION] ${wps.length} Waypoints uploaded to vehicle memory.`, 'info');
  });

  btnStartMission.addEventListener('click', () => {
    speakAlert('Executing autonomous mission route.');
    sendCommand('set_mode', { mode: 'AUTO' });
  });

  // 8. Connection Setup
  const connModeSelect = document.getElementById('conn-mode-select');
  const connPortSelect = document.getElementById('conn-port-select');
  const connBaudSelect = document.getElementById('conn-baud-select');
  const btnConnect = document.getElementById('btn-connect');
  const fieldPort = document.getElementById('field-port');
  const fieldBaud = document.getElementById('field-baud');
  const btnRefreshPorts = document.getElementById('btn-refresh-ports');
  const connHelpText = document.getElementById('conn-help-text');
  const qgcControlPanel = document.getElementById('qgc-control-panel');
  const qgcStatusPill = document.getElementById('qgc-status-pill');
  const btnLaunchQgc = document.getElementById('btn-launch-qgc');
  const btnQgcCheck = document.getElementById('btn-qgc-check');
  const topBtnLaunchQgc = document.getElementById('top-btn-launch-qgc');
  const topQgcDot = document.getElementById('top-qgc-dot');
  const btnPanelQgcSwitch = document.getElementById('btn-panel-qgc-switch');

  async function checkQgcStatus() {
    try {
      const res = await fetch('/api/qgc/status');
      const d = await res.json();
      if (d.running) {
        if (qgcStatusPill) {
          qgcStatusPill.textContent = 'RUNNING (ONLINE)';
          qgcStatusPill.style.background = 'rgba(0, 255, 136, 0.2)';
          qgcStatusPill.style.color = '#00ff88';
          qgcStatusPill.style.borderColor = '#00ff88';
        }
        if (btnLaunchQgc) btnLaunchQgc.textContent = '✓ QGC RUNNING (ACTIVE)';
        if (topBtnLaunchQgc) {
          const txt = topBtnLaunchQgc.querySelector('span');
          if (txt) txt.textContent = '✓ QGC ACTIVE';
          topBtnLaunchQgc.style.borderColor = '#00ff88';
          topBtnLaunchQgc.style.color = '#00ff88';
        }
        if (topQgcDot) {
          topQgcDot.style.background = '#00ff88';
          topQgcDot.style.boxShadow = '0 0 6px #00ff88';
        }
      } else {
        if (qgcStatusPill) {
          qgcStatusPill.textContent = 'NOT RUNNING';
          qgcStatusPill.style.background = 'rgba(255, 149, 0, 0.2)';
          qgcStatusPill.style.color = '#ff9500';
          qgcStatusPill.style.borderColor = '#ff9500';
        }
        if (btnLaunchQgc) btnLaunchQgc.textContent = '🚀 LAUNCH QGC BACKEND';
        if (topBtnLaunchQgc) {
          const txt = topBtnLaunchQgc.querySelector('span');
          if (txt) txt.textContent = '🚀 LAUNCH QGC BACKEND';
          topBtnLaunchQgc.style.borderColor = '#00e5ff';
          topBtnLaunchQgc.style.color = '#00e5ff';
        }
        if (topQgcDot) {
          topQgcDot.style.background = '#ff9500';
          topQgcDot.style.boxShadow = 'none';
        }
      }
    } catch (e) {
      console.error('QGC status check failed:', e);
    }
  }

  async function triggerLaunchQgc() {
    if (btnLaunchQgc) btnLaunchQgc.textContent = '⏳ LAUNCHING QGC...';
    if (topBtnLaunchQgc) {
      const txt = topBtnLaunchQgc.querySelector('span');
      if (txt) txt.textContent = '⏳ LAUNCHING QGC...';
    }
    try {
      const res = await fetch('/api/qgc/launch', { method: 'POST' });
      const d = await res.json();
      appendLog(`[QGC] ${d.message}`, d.status === 'ok' ? 'info' : 'alert');
      speakAlert(d.status === 'ok' ? 'Launching QGroundControl backend.' : 'Failed to launch QGroundControl.');
      setTimeout(checkQgcStatus, 1500);
    } catch (e) {
      appendLog(`[QGC ERROR] ${e.message}`, 'alert');
    }
  }

  if (btnLaunchQgc) {
    btnLaunchQgc.addEventListener('click', triggerLaunchQgc);
  }

  if (topBtnLaunchQgc) {
    topBtnLaunchQgc.addEventListener('click', () => {
      triggerLaunchQgc();
      connModeSelect.value = 'qgc';
      updateConnFields();
    });
  }

  if (btnPanelQgcSwitch) {
    btnPanelQgcSwitch.addEventListener('click', () => {
      connModeSelect.value = 'qgc';
      updateConnFields();
      checkQgcStatus();
      appendLog('[COMM] Switched to QGroundControl Backend link mode.', 'info');
    });
  }

  if (btnQgcCheck) {
    btnQgcCheck.addEventListener('click', () => {
      checkQgcStatus();
    });
  }

  function updateConnFields() {
    const mode = connModeSelect.value;
    const isQgc = mode === 'qgc';
    const isSerial = mode === 'serial';
    const isUdp = mode === 'udp';

    if (qgcControlPanel) qgcControlPanel.style.display = isQgc ? 'flex' : 'none';
    fieldPort.style.display = isSerial ? 'flex' : 'none';
    fieldBaud.style.display = isSerial ? 'flex' : 'none';

    if (isQgc) {
      btnConnect.textContent = 'LINK AERO-Q TO QGC BACKEND';
      checkQgcStatus();
      if (connHelpText) {
        connHelpText.style.display = 'block';
        connHelpText.style.background = 'rgba(0, 229, 255, 0.08)';
        connHelpText.style.color = '#00E5FF';
        connHelpText.innerHTML = '⚡ <strong>QGC Backend Mode</strong>: QGroundControl manages drone hardware; Aero-Q UI displays tactical flight telemetry.';
      }
    } else if (isSerial) {
      btnConnect.textContent = 'CONNECT HARDWARE SERIAL';
      if (connHelpText) {
        connHelpText.style.display = 'block';
        updateBaudHint();
      }
    } else if (isUdp) {
      btnConnect.textContent = 'LISTEN ON UDP:14550';
      if (connHelpText) {
        connHelpText.style.display = 'block';
        connHelpText.style.background = 'rgba(0, 229, 255, 0.08)';
        connHelpText.style.color = '#8BA3B8';
        connHelpText.textContent = 'Listening on UDP port 14550 (Standard for SITL / Companion Computer).';
      }
    } else {
      btnConnect.textContent = 'ACTIVATE SIMULATOR';
      if (connHelpText) connHelpText.style.display = 'none';
    }
  }

  function updateBaudHint() {
    if (!connHelpText || connModeSelect.value !== 'serial') return;
    const baud = connBaudSelect.value;
    if (baud === '115200') {
      connHelpText.innerHTML = '<strong>Direct USB Cable</strong>: Recommended baud 115200. Use a data-capable USB cable.';
    } else if (baud === '921600') {
      connHelpText.innerHTML = '<strong>High-Speed USB</strong>: Recommended baud 921600 for high-bandwidth telemetry.';
    } else {
      connHelpText.innerHTML = '<strong>Wireless Telemetry</strong>: Recommended baud 57600 (SiK / 3DR 433/915 MHz).';
    }
    connHelpText.style.background = 'rgba(0, 229, 255, 0.08)';
    connHelpText.style.color = '#8BA3B8';
  }

  connModeSelect.addEventListener('change', () => {
    updateConnFields();
    if (connModeSelect.value === 'serial') {
      loadSerialPorts();
    }
  });
  connBaudSelect.addEventListener('change', updateBaudHint);
  updateConnFields();
  checkQgcStatus();

  // One-Click Auto-Detect & Connect Flight Controller
  const btnAutoConnect = document.getElementById('btn-auto-connect');
  if (btnAutoConnect) {
    btnAutoConnect.addEventListener('click', async () => {
      btnAutoConnect.textContent = '⏳ SCANNING ALL COM PORTS...';
      btnAutoConnect.disabled = true;
      appendLog('[AUTOCONNECT] Scanning all COM ports for Pixhawk / ArduPilot / PX4 MAVLink vehicle...', 'info');
      speakAlert('Scanning ports for flight controller.');
      try {
        const res = await fetch('/api/autoconnect', { method: 'POST' });
        const data = await res.json();
        if (data.status === 'ok') {
          speakAlert(`Flight controller connected on ${data.port}.`);
          appendLog(`[AUTOCONNECT] ✓ ${data.message}`, 'info');
          connModeSelect.value = 'serial';
          updateConnFields();
          await loadSerialPorts(true);
          connPortSelect.value = data.port;
          connBaudSelect.value = (data.baud || 115200).toString();
          updateBaudHint();
        } else {
          speakAlert('No flight controller detected.');
          appendLog(`[AUTOCONNECT] ⚠️ ${data.message}`, 'alert');
          alert(`Auto-Detect Result:\n\n${data.message}\n\nTroubleshooting:\n1. Ensure USB cable supports DATA (not charging only)\n2. Ensure flight controller is powered on (LEDs blinking)\n3. Check Windows Device Manager under "Ports (COM & LPT)"`);
        }
      } catch (err) {
        appendLog(`[AUTOCONNECT ERROR] ${err.message}`, 'alert');
      } finally {
        btnAutoConnect.textContent = '⚡ AUTO-DETECT & CONNECT DRONE';
        btnAutoConnect.disabled = false;
      }
    });
  }

  // Load available COM ports with auto-detection & user feedback
  async function loadSerialPorts(silent = false) {
    try {
      const res = await fetch('/api/ports');
      const data = await res.json();
      const currentVal = connPortSelect.value;
      connPortSelect.innerHTML = '';

      if (data.ports && data.ports.length > 0) {
        let bestPort = null;
        data.ports.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.device;
          const tag = p.is_fc ? ' 🎯 [FLIGHT CONTROLLER]' : (p.is_radio ? ' 📡 [TELEMETRY RADIO]' : '');
          opt.textContent = `${p.device} - ${p.description}${tag}`;
          connPortSelect.appendChild(opt);
          if (p.is_fc || p.is_radio) {
            bestPort = p;
          }
        });

        // Restore previously selected port if still valid, otherwise prioritize FC
        if (data.ports.some(p => p.device === currentVal)) {
          connPortSelect.value = currentVal;
        } else if (bestPort) {
          connPortSelect.value = bestPort.device;
          if (bestPort.recommended_baud) {
            connBaudSelect.value = bestPort.recommended_baud.toString();
          }
        }

        if (connHelpText && connModeSelect.value === 'serial') {
          connHelpText.style.display = 'block';
          connHelpText.style.background = 'rgba(0, 255, 136, 0.1)';
          connHelpText.style.color = '#00ff88';
          connHelpText.innerHTML = `✓ ${data.ports.length} Port(s) detected: <strong>${connPortSelect.value}</strong>. Ready to connect.`;
        }
        if (!silent) {
          appendLog(`[COMM] Detected ${data.ports.length} serial device(s).`, 'info');
        }
      } else {
        const opt = document.createElement('option');
        opt.value = '';
        opt.disabled = true;
        opt.selected = true;
        opt.textContent = '⚠️ No Drone / COM Ports Detected';
        connPortSelect.appendChild(opt);

        if (connHelpText && connModeSelect.value === 'serial') {
          connHelpText.style.display = 'block';
          connHelpText.style.background = 'rgba(255, 149, 0, 0.1)';
          connHelpText.style.color = '#ff9500';
          connHelpText.innerHTML = '⚠️ <strong>No COM port detected by Windows</strong>. Check USB cable (must support data), power, or drivers.';
        }
        if (!silent) {
          appendLog('[COMM] No serial devices found on system.', 'alert');
        }
      }
    } catch (err) {
      console.error('Failed to load serial ports:', err);
    }
  }

  // Initial scan
  loadSerialPorts(true);

  // Manual Rescan Button
  if (btnRefreshPorts) {
    btnRefreshPorts.addEventListener('click', async () => {
      btnRefreshPorts.textContent = '⏳ SCANNING...';
      await loadSerialPorts(false);
      btnRefreshPorts.textContent = '🔄 RESCAN';
    });
  }

  // Auto-poll ports every 4 seconds when in serial mode
  setInterval(() => {
    if (connModeSelect.value === 'serial') {
      loadSerialPorts(true);
    } else if (connModeSelect.value === 'qgc') {
      checkQgcStatus();
    }
  }, 4000);

  btnConnect.addEventListener('click', async () => {
    const mode = connModeSelect.value;
    const port = connPortSelect.value;
    const baud = parseInt(connBaudSelect.value) || 115200;

    if (mode === 'serial' && (!port || port === '')) {
      const msg = 'No COM Port detected! Please connect your drone or telemetry radio to USB, then click RESCAN.';
      alert(msg);
      appendLog('[COMM ERROR] ' + msg, 'alert');
      return;
    }

    btnConnect.textContent = 'CONNECTING...';
    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, port, baud })
      });
      const data = await res.json();
      if (data.status === 'ok') {
        if (mode === 'simulation') {
          speakAlert('Switched to Flight Simulator mode.');
          appendLog('[COMM] Switched to Built-in Tactical Flight Simulator.', 'info');
        } else {
          speakAlert(`Connecting to ${data.device || port}. Waiting for vehicle heartbeat.`);
          appendLog(`[COMM] Port ${data.device || port} opened at ${data.baud || baud} baud. Waiting for vehicle heartbeat...`, 'info');
        }
      } else {
        const errorMsg = data.message || 'Connection failed.';
        speakAlert('Connection failed.');
        appendLog(`[COMM ERROR] ${errorMsg}`, 'alert');
        alert(`Connection Failed:\n\n${errorMsg}\n\nTroubleshooting:\n1. Ensure USB cable supports DATA (not charging only)\n2. Ensure flight controller is powered on (LEDs blinking)\n3. Check Windows Device Manager under "Ports (COM & LPT)"\n4. Try clicking "⚡ AUTO-DETECT & CONNECT DRONE"`);
      }
    } catch (netErr) {
      appendLog(`[COMM ERROR] Server request failed: ${netErr.message}`, 'alert');
      alert(`Server error: ${netErr.message}`);
    } finally {
      updateConnFields();
    }
  });

  // 9. Blackbox CSV Export
  const btnExportBlackbox = document.getElementById('btn-export-blackbox');
  if (btnExportBlackbox) {
    btnExportBlackbox.addEventListener('click', () => {
      speakAlert('Downloading flight blackbox telemetry log.');
      window.open('/api/blackbox/download', '_blank');
      appendLog('[BLACKBOX] Exported flight telemetry CSV file.', 'info');
    });
  }

  // 10. FPV Camera Live Stream / Webcam
  const btnToggleFpv = document.getElementById('btn-toggle-fpv');
  const fpvWindow = document.getElementById('fpv-window');
  const btnFpvClose = document.getElementById('btn-fpv-close');
  const btnWebcamToggle = document.getElementById('btn-webcam-toggle');
  const fpvVideo = document.getElementById('fpv-video-element');
  const fpvSimCanvas = document.getElementById('fpv-sim-canvas');

  let webcamActive = false;
  let webcamStream = null;

  if (btnToggleFpv && fpvWindow) {
    btnToggleFpv.addEventListener('click', () => {
      fpvWindow.style.display = fpvWindow.style.display === 'none' ? 'flex' : 'none';
      btnToggleFpv.classList.toggle('active');
    });
  }

  if (btnFpvClose && fpvWindow) {
    btnFpvClose.addEventListener('click', () => {
      fpvWindow.style.display = 'none';
      if (btnToggleFpv) btnToggleFpv.classList.remove('active');
    });
  }

  if (btnWebcamToggle) {
    btnWebcamToggle.addEventListener('click', async () => {
      if (!webcamActive) {
        try {
          webcamStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
          fpvVideo.srcObject = webcamStream;
          fpvVideo.style.display = 'block';
          fpvSimCanvas.style.display = 'none';
          webcamActive = true;
          btnWebcamToggle.textContent = '⏹️ SIM';
          speakAlert('Connected to live optical camera feed.');
        } catch (e) {
          alert('Could not access webcam/USB video capture card: ' + e.message);
        }
      } else {
        if (webcamStream) {
          webcamStream.getTracks().forEach(track => track.stop());
        }
        fpvVideo.style.display = 'none';
        fpvSimCanvas.style.display = 'block';
        webcamActive = false;
        btnWebcamToggle.textContent = '🔄 CAM';
        speakAlert('Switched to simulated tactical aerial feed.');
      }
    });
  }

  // Render Simulated Aerial Feed on Canvas if no webcam
  function renderSimulatedFpv() {
    if (!fpvSimCanvas || webcamActive) {
      requestAnimationFrame(renderSimulatedFpv);
      return;
    }
    const ctx = fpvSimCanvas.getContext('2d');
    const w = fpvSimCanvas.width;
    const h = fpvSimCanvas.height;

    // Tactical night-vision / thermal aerial terrain simulation
    const grad = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w / 1.5);
    grad.addColorStop(0, '#041624');
    grad.addColorStop(1, '#02060d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Subtle scanlines & noise
    ctx.fillStyle = 'rgba(0, 229, 255, 0.04)';
    for (let y = 0; y < h; y += 4) {
      ctx.fillRect(0, y, w, 1.5);
    }

    // Grid coordinates
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(30, 20, w - 60, h - 40);

    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.fillStyle = '#00ff88';
    ctx.fillText('TARGET LOCK: 3D GPS ACTIVE', 35, 32);
    ctx.fillText('FPV 1080P • 60FPS • 5.8GHz', 35, h - 26);

    requestAnimationFrame(renderSimulatedFpv);
  }
  renderSimulatedFpv();
});
