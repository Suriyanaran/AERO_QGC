# Aero-Q GCS

Aero-Q GCS is a Windows ground control station with a browser-based flight dashboard, a built-in drone simulator, and MAVLink connection options for compatible autopilots.

## Features

- Live flight dashboard with a primary flight display, map, and telemetry panels
- Built-in flight simulator for testing the interface without connecting to a vehicle
- MAVLink connection over a serial port or UDP
- Flight-mode, arm/disarm, and takeoff controls
- Map-based waypoint planning
- FPV panel with a simulated camera view or a local webcam
- Flight telemetry recording and CSV download

## Run on Windows

### Standalone application

1. Open the `Aero-Q-GCS` folder.
2. Double-click `Aero-Q_GCS.exe`.
3. The application opens in an Edge or Chrome app window when available; otherwise, it opens in your default browser.

Keep the executable in the project folder so its `ui` and `assets` files remain available. The dashboard uses online map and font resources, so some visual elements may require an internet connection.

### Run from source

Install Python and the application dependencies:

```powershell
python -m pip install fastapi uvicorn pyserial pymavlink
```

From the `Aero-Q-GCS` folder, start the application:

```powershell
python main.py
```

The local server listens on `http://127.0.0.1:18080`. `main.py` opens the dashboard in Edge or Chrome if installed, or in your default browser.

## Connect to a vehicle

Aero-Q GCS supports 3 connection modes:

### 1. 🔌 Direct Hardware Serial (Recommended for Physical Drones)
Direct connection to Pixhawk / ArduPilot / PX4 flight controllers:
1. Connect your flight controller via USB cable or plug in your SiK / 3DR Telemetry Radio.
2. In the Communications Interface, click **"⚡ AUTO-DETECT & CONNECT DRONE"** — Aero-Q automatically scans all COM ports and baud rates (115200 for direct USB, 57600 for Telemetry Radio) and locks onto the vehicle heartbeat.
3. You can also manually choose your COM port from the dropdown and click **"CONNECT TO BACKEND"**.
4. Real-time telemetry (Battery voltage, percentage, satellites, GPS fix, attitude, flight modes) streams directly to the Tactical HUD.

### 2. 🎮 Built-in Tactical Flight Simulator (6-DOF)
Allows testing the artificial horizon (PFD), tactical map, waypoints, and flight mode commands without connecting physical drone hardware. Select **"BUILT-IN TACTICAL SIMULATOR"** in the dropdown and click connect.

### 3. ⚡ QGroundControl Backend (Optional)
If you have QGroundControl installed on Windows and wish to use QGC as the MAVLink driver while viewing the Aero-Q tactical dashboard:
1. Select **"QGROUNDCONTROL BACKEND"**.
2. Click **"LAUNCH QGC BACKEND"** to run QGC in the background. Telemetry forwards over local UDP port `14550`.

## Flight logs

Telemetry is recorded to CSV files in a `logs` folder under the application's current working directory. Select the blackbox/CSV control in the dashboard to download the active log. Flight logs can contain operational data; review them before sharing or committing them.

## Project layout

```text
Aero-Q-GCS/
├── assets/           # Application logos and images
├── logs/             # Generated telemetry and launcher logs
├── ui/               # Dashboard HTML, CSS, and JavaScript
├── main.py           # Standalone server and dashboard entry point
├── server.py         # FastAPI backend, simulator, and MAVLink bridge
├── Aero-Q_GCS.exe    # Windows standalone application
└── Aero-Q_GCS.spec   # PyInstaller build configuration
```
