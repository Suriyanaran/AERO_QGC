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

function handleTelemetryUpdate(data) {
  // 1. Update Primary Flight Display (PFD)
  if (pfd) {
    pfd.updateData(data);
  }

  // 2. Update Tactical Map
  if (mapManager && data.lat && data.lon) {
    mapManager.updateDronePosition(data.lat, data.lon, data.yaw, data.alt);
  }

  // 3. Update Header Badges
  valMode.textContent = data.mode || 'STABILIZE';

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

  // Audio Alerts on state changes
  if (lastArmedState !== null && lastArmedState !== data.armed) {
    speakAlert(data.armed ? 'Warning: Motors Armed. Propellers Active.' : 'Motors Disarmed.');
  }
  lastArmedState = data.armed;

  if (lastFlightMode !== null && lastFlightMode !== data.mode) {
    speakAlert(`Flight Mode: ${data.mode}`);
  }
  lastFlightMode = data.mode;

  // Active Mode Button Highlight
  document.querySelectorAll('.mode-btn').forEach(btn => {
    if (btn.dataset.mode === data.mode) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Top Metrics
  topBattPct.textContent = `${Math.round(data.battery_pct || 98)}%`;
  topBattVolt.textContent = `${(data.voltage || 16.6).toFixed(1)}V`;
  topGpsSats.textContent = `${data.satellites || 16} SATS`;
  topGpsFix.textContent = data.fix_type >= 3 ? '3D FIX' : 'NO FIX';
  topRssi.textContent = `${data.rssi || 99}%`;
  topFlightTime.textContent = formatTime(data.flight_time || 0);

  // Blackbox Record Counter update
  totalBlackboxLogs++;
  const elBbRecords = document.getElementById('top-blackbox-records');
  if (elBbRecords) {
    elBbRecords.textContent = `${totalBlackboxLogs} LOGS (CSV)`;
  }

  // Update FPV HUD OSD Overlays
  const fpvAlt = document.getElementById('fpv-osd-alt');
  const fpvSpd = document.getElementById('fpv-osd-spd');
  const fpvBat = document.getElementById('fpv-osd-bat');
  const fpvHdg = document.getElementById('fpv-osd-hdg');
  const fpvMode = document.getElementById('fpv-osd-mode');
  if (fpvAlt) fpvAlt.textContent = `${(data.alt || 0).toFixed(1)}m`;
  if (fpvSpd) fpvSpd.textContent = `${(data.groundspeed || 0).toFixed(1)}m/s`;
  if (fpvBat) fpvBat.textContent = `${(data.voltage || 16.6).toFixed(1)}V`;
  if (fpvHdg) fpvHdg.textContent = `${Math.round(data.yaw || 0).toString().padStart(3, '0')}°`;
  if (fpvMode) fpvMode.textContent = data.mode || 'LOITER';

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
      // Check if already in console
      const existing = Array.from(consoleOutput.children).some(el => el.textContent === log);
      if (!existing) {
        appendLog(log, 'info');
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

  function updateConnFields() {
    const isSerial = connModeSelect.value === 'serial';
    fieldPort.style.display = isSerial ? 'flex' : 'none';
    fieldBaud.style.display = isSerial ? 'flex' : 'none';
  }
  connModeSelect.addEventListener('change', updateConnFields);
  updateConnFields();

  // Load available COM ports
  fetch('/api/ports')
    .then(r => r.json())
    .then(d => {
      if (d.ports && d.ports.length > 0) {
        connPortSelect.innerHTML = '';
        d.ports.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.device;
          opt.textContent = `${p.device} (${p.description})`;
          connPortSelect.appendChild(opt);
        });
      }
    });

  btnConnect.addEventListener('click', async () => {
    const mode = connModeSelect.value;
    const port = connPortSelect.value;
    const baud = parseInt(connBaudSelect.value) || 57600;

    btnConnect.textContent = 'CONNECTING...';
    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, port, baud })
      });
      const data = await res.json();
      if (data.status === 'ok') {
        speakAlert(`Connected to ${data.mode}. Telemetry established.`);
        appendLog(`[COMM] Connected successfully in ${data.mode} mode.`, 'info');
      } else {
        alert(data.message || 'Connection failed');
      }
    } finally {
      btnConnect.textContent = 'ESTABLISH LINK';
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
