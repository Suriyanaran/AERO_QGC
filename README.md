# 🦇 AERO-Q TACTICAL GCS | Enterprise Production Edition
**Complete Operator, Video Stream, Blackbox & Deployment Guide**

---

## ⚡ 1. What Makes This 100% Production Grade

| Feature | How It Works in Aero-Q GCS |
| :--- | :--- |
| **📷 Live FPV Video Camera** | Click **`📷 FPV CAMERA`** on the map toolbar. A picture-in-picture window opens with tactical reticle crosshairs and flight OSD (Alt, Speed, Battery, Heading). Click **`🔄 CAM`** to switch between **Tactical Aerial Sim** and **Real Laptop Webcam / USB FPV Capture Card**! |
| **💾 Flight Data Blackbox** | Active recorder in header (**`REC ⏺️`**). Automatically logs every telemetry packet (Time, Mode, Armed, Pitch, Roll, Yaw, GPS, Alt, Speed, Battery) to `.CSV`. Click **`REC ⏺️ [x] LOGS (CSV)`** to download the flight log instantly! |
| **📦 Standalone `.exe` Binary** | Packaged into a single standalone Windows executable: [`c:/Users/SURYA P/QGC/Aero-Q-GCS/Aero-Q_GCS.exe`](file:///c:/Users/SURYA%20P/QGC/Aero-Q-GCS/Aero-Q_GCS.exe). Can run on ANY Windows computer without needing Python or manual setup! |
| **🛰️ Tactical Dark & Satellite Map** | Powered by Leaflet with high-contrast tactical dark tiles (no watermarks) and Esri Satellite Imagery toggle. Rotating Tactical Police Drone marker with active red & blue emergency strobe lights and live breadcrumbs trail. |
| **✈️ 60 FPS PFD Horizon** | Canvas-accelerated artificial horizon, pitch ladder (-30° to +30°), roll arc, airspeed tape, altitude tape, and heading rose. |

---

## 🚀 2. How to Run the Standalone `.EXE`

1. Go to your **Windows Desktop**.
2. Double-click **`Aero-Q GCS`** (Tactical Police Drone GCS).  
   *(It points directly to `c:/Users/SURYA P/QGC/Aero-Q-GCS/Aero-Q_GCS.exe`)*
3. The dedicated tactical application window opens full-screen!

---

## 💾 3. How to Use the Flight Data Blackbox (.CSV Export)

1. While the app is running or after completing a flight, look at the top-right header:
   * You will see: **`REC ⏺️  [XXXX] LOGS (CSV)`**.
2. Click that button.
3. Your browser will instantly download the flight blackbox CSV file (e.g. `flight_blackbox_20261016_xxxx.csv`).
4. You can open this file in **Microsoft Excel**, **Google Sheets**, or **Python Pandas** to show evaluators complete flight graphs, telemetry data, and flight duration proof!
