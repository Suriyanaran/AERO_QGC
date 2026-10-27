"""
Aero-Q Tactical Ground Control Station - Backend Server
Supports real Pixhawk / ArduPilot / PX4 MAVLink communication and built-in 6-DOF Simulator.
"""

import os
import sys

# Prevent crash when running headless under pythonw.exe
try:
    if sys.stdout is None or getattr(sys.stdout, 'closed', False):
        sys.stdout = open(os.devnull, "w")
    if sys.stderr is None or getattr(sys.stderr, 'closed', False):
        sys.stderr = open(os.devnull, "w")
except Exception:
    pass

import time
import math
import json
import csv
import asyncio
import threading
from typing import List, Dict, Any, Optional

try:
    import serial
    import serial.tools.list_ports
except ImportError:
    serial = None

try:
    from pymavlink import mavutil
except ImportError:
    mavutil = None

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

if getattr(sys, 'frozen', False):
    BASE_DIR = sys._MEIPASS
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

UI_DIR = os.path.join(BASE_DIR, "ui")
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
LOGS_DIR = os.path.join(os.getcwd(), "logs")

app = FastAPI(title="Aero-Q Tactical GCS Backend")

# Ensure directories exist
os.makedirs(UI_DIR, exist_ok=True)
os.makedirs(ASSETS_DIR, exist_ok=True)
os.makedirs(LOGS_DIR, exist_ok=True)


class BlackboxLogger:
    """Records real-time flight telemetry to high-resolution CSV files."""
    def __init__(self):
        self.active_file = None
        self.writer = None
        self.fp = None
        self.record_count = 0
        self.filename = ""
        self.start_new_log()

    def start_new_log(self):
        if self.fp:
            try: self.fp.close()
            except Exception: pass
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        self.filename = f"flight_blackbox_{timestamp}.csv"
        self.active_file = os.path.join(LOGS_DIR, self.filename)
        self.fp = open(self.active_file, "w", newline="", encoding="utf-8")
        self.writer = csv.writer(self.fp)
        self.writer.writerow([
            "timestamp", "flight_time", "mode", "armed",
            "pitch", "roll", "yaw",
            "lat", "lon", "alt", "target_alt",
            "groundspeed", "airspeed", "climb",
            "voltage", "current", "battery_pct",
            "satellites", "fix_type", "hdop", "rssi"
        ])
        self.fp.flush()
        self.record_count = 0

    def log_telemetry(self, t: Dict[str, Any]):
        if not self.writer or not self.fp:
            return
        row = [
            time.strftime("%Y-%m-%d %H:%M:%S"),
            t.get("flight_time", 0.0),
            t.get("mode", ""),
            t.get("armed", False),
            t.get("pitch", 0.0),
            t.get("roll", 0.0),
            t.get("yaw", 0.0),
            t.get("lat", 0.0),
            t.get("lon", 0.0),
            t.get("alt", 0.0),
            t.get("target_alt", 0.0),
            t.get("groundspeed", 0.0),
            t.get("airspeed", 0.0),
            t.get("climb", 0.0),
            t.get("voltage", 0.0),
            t.get("current", 0.0),
            t.get("battery_pct", 0.0),
            t.get("satellites", 0),
            t.get("fix_type", 0),
            t.get("hdop", 0.0),
            t.get("rssi", 0)
        ]
        try:
            self.writer.writerow(row)
            self.record_count += 1
            if self.record_count % 10 == 0:
                self.fp.flush()
        except Exception:
            pass

blackbox = BlackboxLogger()


class DroneSimulator:
    """High-fidelity 6-DOF Quadcopter Simulation Engine."""
    def __init__(self):
        self.active = True
        self.armed = False
        self.mode = "STABILIZE"
        
        # Position & Orientation
        self.home_lat = 13.0827
        self.home_lon = 80.2707
        self.lat = 13.0827
        self.lon = 80.2707
        self.alt = 0.0          # meters AGL
        self.target_alt = 0.0
        
        self.pitch = 0.0        # degrees
        self.roll = 0.0         # degrees
        self.yaw = 0.0          # degrees (0 = North)
        
        self.vx = 0.0           # m/s North
        self.vy = 0.0           # m/s East
        self.vz = 0.0           # m/s Up (climb)
        self.groundspeed = 0.0  # m/s
        self.airspeed = 0.0
        
        # Power Subsystem
        self.battery_cells = 4
        self.voltage = 16.6     # 4.15V per cell
        self.current = 0.4      # idle current in Amps
        self.battery_pct = 98.0
        self.mah_consumed = 50.0
        
        # GPS & Comms
        self.satellites = 16
        self.fix_type = 3       # 3D Fix
        self.hdop = 0.8
        self.rssi = 99
        
        # Mission / Waypoints
        self.waypoints: List[Dict[str, float]] = []
        self.current_wp_idx = 0
        
        # Flight Log
        self.flight_time = 0.0
        self.logs: List[str] = [
            "Aero-Q Tactical Avionics v2.4 initialized",
            "Simulator engine online: 6-DOF physics enabled",
            "GPS 3D Fix verified (16 Satellites)",
            "System healthy - Ready to Arm"
        ]

    def reset_home(self, lat: float, lon: float):
        self.home_lat = lat
        self.home_lon = lon
        self.lat = lat
        self.lon = lon
        self.alt = 0.0

    def add_log(self, msg: str):
        timestamp = time.strftime("%H:%M:%S")
        self.logs.append(f"[{timestamp}] {msg}")
        if len(self.logs) > 60:
            self.logs.pop(0)

    def arm(self):
        if not self.armed:
            self.armed = True
            self.current = 4.2
            self.add_log("Motors ARMED. Throttle idle active.")

    def disarm(self):
        if self.alt > 1.0:
            self.add_log("WARNING: Emergency disarm in flight!")
        self.armed = False
        self.current = 0.4
        self.pitch = 0.0
        self.roll = 0.0
        self.vx = 0.0
        self.vy = 0.0
        self.vz = 0.0
        self.add_log("Motors DISARMED.")

    def set_mode(self, mode: str):
        self.mode = mode.upper()
        self.add_log(f"Flight Mode changed to: {self.mode}")
        if self.mode == "TAKEOFF" and self.armed:
            self.target_alt = 15.0
            self.mode = "LOITER"
        elif self.mode == "RTL":
            self.add_log("Return-to-Launch engaged. Navigating to Home.")
        elif self.mode == "LAND":
            self.target_alt = 0.0
            self.add_log("Landing sequence started.")

    def takeoff(self, alt: float = 10.0):
        if not self.armed:
            self.arm()
        self.target_alt = max(3.0, alt)
        self.mode = "LOITER"
        self.add_log(f"Automated Takeoff command executed. Target Alt: {self.target_alt:.1f}m")

    def update(self, dt: float):
        """Step simulation physics by dt seconds."""
        if not self.active:
            return

        if self.armed:
            self.flight_time += dt

            # Battery discharge
            burn_rate = 18.0 if self.alt > 0.5 else 4.0
            self.mah_consumed += (burn_rate * 1000.0 / 3600.0) * dt
            self.battery_pct = max(0.0, 100.0 - (self.mah_consumed / 4500.0 * 100.0))
            self.voltage = max(13.2, 16.6 - (self.mah_consumed / 4500.0 * 3.0))

            # Altitude dynamics
            if self.mode in ["LOITER", "AUTO", "RTL"] and self.target_alt > 0:
                alt_diff = self.target_alt - self.alt
                if abs(alt_diff) > 0.1:
                    climb_speed = 2.5 if alt_diff > 0 else -1.8
                    self.vz = climb_speed * min(1.0, abs(alt_diff) / 2.0)
                    self.alt = max(0.0, self.alt + self.vz * dt)
                else:
                    self.vz = 0.0
                    self.alt = self.target_alt

            elif self.mode == "LAND":
                self.vz = -1.2
                self.alt += self.vz * dt
                if self.alt <= 0.0:
                    self.alt = 0.0
                    self.vz = 0.0
                    self.disarm()
                    self.add_log("Touchdown detected. Disarmed.")

            # Horizontal Navigation
            target_lat, target_lon = None, None
            if self.mode == "RTL":
                target_lat, target_lon = self.home_lat, self.home_lon
                # Land when within 2m of home
                dist_to_home = math.hypot((self.lat - self.home_lat) * 111319.5, (self.lon - self.home_lon) * 111319.5)
                if dist_to_home < 3.0 and self.alt > 1.0:
                    self.mode = "LAND"

            elif self.mode == "AUTO" and self.waypoints:
                if self.current_wp_idx < len(self.waypoints):
                    wp = self.waypoints[self.current_wp_idx]
                    target_lat, target_lon = wp.get("lat"), wp.get("lon")
                    wp_alt = wp.get("alt", 15.0)
                    self.target_alt = wp_alt
                    
                    dist_to_wp = math.hypot((self.lat - target_lat) * 111319.5, (self.lon - target_lon) * 111319.5)
                    if dist_to_wp < 3.5:
                        self.add_log(f"Waypoint #{self.current_wp_idx + 1} reached.")
                        self.current_wp_idx += 1
                        if self.current_wp_idx >= len(self.waypoints):
                            self.add_log("Mission Complete. Holding position (LOITER).")
                            self.mode = "LOITER"

            if target_lat is not None and target_lon is not None and self.alt > 1.0:
                # Vector to target
                dy = (target_lat - self.lat) * 111319.5
                dx = (target_lon - self.lon) * (111319.5 * math.cos(math.radians(self.lat)))
                dist = math.hypot(dx, dy)
                
                if dist > 1.0:
                    desired_yaw = math.degrees(math.atan2(dx, dy)) % 360
                    # Turn yaw towards desired
                    yaw_diff = (desired_yaw - self.yaw + 180) % 360 - 180
                    self.yaw = (self.yaw + math.copysign(min(abs(yaw_diff), 45.0 * dt), yaw_diff)) % 360

                    # Cruise speed 7 m/s
                    speed = min(7.5, dist * 0.8)
                    self.groundspeed = speed
                    self.airspeed = speed + 0.5 * math.sin(self.flight_time)
                    
                    # Pitch forward during movement
                    self.pitch = -12.0 * (speed / 7.5)
                    self.roll = max(-15.0, min(15.0, yaw_diff * 0.5))

                    self.lat += (speed * math.cos(math.radians(self.yaw)) * dt) / 111319.5
                    self.lon += (speed * math.sin(math.radians(self.yaw)) * dt) / (111319.5 * math.cos(math.radians(self.lat)))
                else:
                    self.groundspeed = 0.0
                    self.pitch = 0.0
                    self.roll = 0.0
            else:
                if self.alt > 0.5:
                    # Gentle hover micro-perturbation
                    self.pitch = 1.2 * math.sin(self.flight_time * 1.5)
                    self.roll = 1.0 * math.cos(self.flight_time * 1.8)
                    self.groundspeed = 0.2
                    self.airspeed = 0.8
                else:
                    self.pitch = 0.0
                    self.roll = 0.0
                    self.groundspeed = 0.0
                    self.airspeed = 0.0

    def get_telemetry_dict(self) -> Dict[str, Any]:
        return {
            "source": "SIMULATOR",
            "armed": self.armed,
            "mode": self.mode,
            "pitch": round(self.pitch, 2),
            "roll": round(self.roll, 2),
            "yaw": round(self.yaw, 1),
            "lat": round(self.lat, 7),
            "lon": round(self.lon, 7),
            "alt": round(self.alt, 2),
            "target_alt": round(self.target_alt, 1),
            "groundspeed": round(self.groundspeed, 2),
            "airspeed": round(self.airspeed, 2),
            "climb": round(self.vz, 2),
            "voltage": round(self.voltage, 2),
            "current": round(self.current, 2),
            "battery_pct": round(self.battery_pct, 1),
            "satellites": self.satellites,
            "fix_type": self.fix_type,
            "hdop": round(self.hdop, 2),
            "rssi": self.rssi,
            "flight_time": round(self.flight_time, 1),
            "wp_idx": self.current_wp_idx,
            "total_wps": len(self.waypoints),
            "logs": self.logs[-15:]
        }


class RealMavlinkBridge:
    """Manages physical serial / UDP connection to Pixhawk / PX4 / ArduPilot."""
    def __init__(self):
        self.conn = None
        self.connected = False
        self.running = False
        self.thread: Optional[threading.Thread] = None
        
        self.telemetry = {
            "source": "PIXHAWK_MAVLINK",
            "armed": False,
            "mode": "DISCONNECTED",
            "pitch": 0.0,
            "roll": 0.0,
            "yaw": 0.0,
            "lat": 0.0,
            "lon": 0.0,
            "alt": 0.0,
            "groundspeed": 0.0,
            "airspeed": 0.0,
            "climb": 0.0,
            "voltage": 0.0,
            "current": 0.0,
            "battery_pct": 0.0,
            "satellites": 0,
            "fix_type": 0,
            "hdop": 99.0,
            "rssi": 0,
            "flight_time": 0.0,
            "logs": []
        }

    def connect(self, device: str, baud: int = 57600) -> bool:
        if not mavutil:
            return False
        self.disconnect()
        try:
            self.conn = mavutil.mavlink_connection(device, baud=baud)
            self.connected = True
            self.running = True
            self.thread = threading.Thread(target=self._read_loop, daemon=True)
            self.thread.start()
            return True
        except Exception as e:
            self.connected = False
            return False

    def disconnect(self):
        self.running = False
        if self.conn:
            try:
                self.conn.close()
            except Exception:
                pass
            self.conn = None
        self.connected = False

    def _read_loop(self):
        while self.running and self.conn:
            try:
                msg = self.conn.recv_match(blocking=True, timeout=1.0)
                if not msg:
                    continue
                
                mtype = msg.get_type()
                if mtype == "HEARTBEAT":
                    self.telemetry["armed"] = bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)
                    # Mode extraction
                    mode_id = msg.custom_mode
                    self.telemetry["mode"] = str(mode_id)
                elif mtype == "ATTITUDE":
                    self.telemetry["pitch"] = round(math.degrees(msg.pitch), 2)
                    self.telemetry["roll"] = round(math.degrees(msg.roll), 2)
                    self.telemetry["yaw"] = round((math.degrees(msg.yaw) + 360) % 360, 1)
                elif mtype == "GLOBAL_POSITION_INT":
                    self.telemetry["lat"] = msg.lat / 1e7
                    self.telemetry["lon"] = msg.lon / 1e7
                    self.telemetry["alt"] = round(msg.relative_alt / 1000.0, 2)
                elif mtype == "VFR_HUD":
                    self.telemetry["groundspeed"] = round(msg.groundspeed, 2)
                    self.telemetry["airspeed"] = round(msg.airspeed, 2)
                    self.telemetry["climb"] = round(msg.climb, 2)
                elif mtype == "SYS_STATUS":
                    self.telemetry["voltage"] = round(msg.voltage_battery / 1000.0, 2)
                    self.telemetry["current"] = round(msg.current_battery / 100.0, 2)
                    self.telemetry["battery_pct"] = msg.battery_remaining
                elif mtype == "GPS_RAW_INT":
                    self.telemetry["fix_type"] = msg.fix_type
                    self.telemetry["satellites"] = msg.satellites_visible
                    self.telemetry["hdop"] = round(msg.eph / 100.0, 2)
            except Exception:
                time.sleep(0.05)


# Global instances
simulator = DroneSimulator()
mav_bridge = RealMavlinkBridge()
active_mode = "SIMULATOR"  # 'SIMULATOR' or 'MAVLINK'


# Background simulation runner (runs at 30 Hz)
def sim_background_loop():
    last_time = time.time()
    while True:
        now = time.time()
        dt = now - last_time
        last_time = now
        if active_mode == "SIMULATOR":
            simulator.update(dt)
        time.sleep(0.033)

threading.Thread(target=sim_background_loop, daemon=True).start()


# API Models
class ConnectRequest(BaseModel):
    mode: str               # 'simulation', 'serial', 'udp'
    port: Optional[str] = "COM3"
    baud: Optional[int] = 57600

class CommandRequest(BaseModel):
    action: str             # 'arm', 'disarm', 'set_mode', 'takeoff', 'waypoints', 'reset_home'
    payload: Optional[Dict[str, Any]] = None


@app.get("/api/ports")
def get_serial_ports():
    ports = []
    if serial:
        for p in serial.tools.list_ports.comports():
            ports.append({"device": p.device, "description": p.description})
    return {"ports": ports, "active_mode": active_mode}


@app.post("/api/connect")
def connect_drone(req: ConnectRequest):
    global active_mode
    if req.mode == "simulation":
        active_mode = "SIMULATOR"
        mav_bridge.disconnect()
        simulator.add_log("Switched to Aero-Q Flight Simulator mode.")
        return {"status": "ok", "mode": "SIMULATOR"}
    elif req.mode in ["serial", "udp"]:
        dev = req.port if req.mode == "serial" else "udpin:0.0.0.0:14550"
        baud = req.baud or 57600
        ok = mav_bridge.connect(dev, baud=baud)
        if ok:
            active_mode = "MAVLINK"
            return {"status": "ok", "mode": "MAVLINK", "device": dev}
        else:
            return JSONResponse(status_code=400, content={"status": "error", "message": f"Could not open {dev}"})
    return {"status": "error", "message": "Unknown mode"}


@app.post("/api/command")
def handle_command(cmd: CommandRequest):
    action = cmd.action.lower()
    payload = cmd.payload or {}
    
    if active_mode == "SIMULATOR":
        if action == "arm":
            simulator.arm()
        elif action == "disarm":
            simulator.disarm()
        elif action == "set_mode":
            simulator.set_mode(payload.get("mode", "STABILIZE"))
        elif action == "takeoff":
            simulator.takeoff(payload.get("alt", 10.0))
        elif action == "waypoints":
            wps = payload.get("waypoints", [])
            simulator.waypoints = wps
            simulator.current_wp_idx = 0
            simulator.add_log(f"Mission loaded: {len(wps)} waypoints.")
        elif action == "reset_home":
            lat = payload.get("lat", 13.0827)
            lon = payload.get("lon", 80.2707)
            simulator.reset_home(lat, lon)
        return {"status": "ok", "action": action}
    else:
        # Physical Drone MAVLink Command Dispatch
        if mav_bridge.conn:
            try:
                target_sys = getattr(mav_bridge.conn, 'target_system', 1)
                target_comp = getattr(mav_bridge.conn, 'target_component', 1)
                
                if action == "arm":
                    mav_bridge.conn.mav.command_long_send(
                        target_sys, target_comp,
                        mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
                        0, 1, 0, 0, 0, 0, 0, 0
                    )
                elif action == "disarm":
                    mav_bridge.conn.mav.command_long_send(
                        target_sys, target_comp,
                        mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
                        0, 0, 0, 0, 0, 0, 0, 0
                    )
                elif action == "takeoff":
                    alt = float(payload.get("alt", 10.0))
                    mav_bridge.conn.mav.command_long_send(
                        target_sys, target_comp,
                        mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
                        0, 0, 0, 0, 0, 0, 0, alt
                    )
                elif action == "set_mode":
                    mode_str = payload.get("mode", "LOITER")
                    if hasattr(mav_bridge.conn, 'mode_mapping'):
                        mapping = mav_bridge.conn.mode_mapping()
                        if mapping and mode_str in mapping:
                            mav_bridge.conn.set_mode(mapping[mode_str])
            except Exception as e:
                print("MAVLink send error:", e)
        return {"status": "ok", "action": action}


@app.get("/api/blackbox/stats")
def get_blackbox_stats():
    return {
        "filename": blackbox.filename,
        "records": blackbox.record_count,
        "filepath": blackbox.active_file
    }

@app.get("/api/blackbox/download")
def download_blackbox():
    if blackbox.active_file and os.path.exists(blackbox.active_file):
        blackbox.fp.flush()
        return FileResponse(
            path=blackbox.active_file,
            filename=blackbox.filename,
            media_type="text/csv"
        )
    return JSONResponse(status_code=404, content={"message": "No blackbox log available"})

@app.websocket("/ws")
async def websocket_telemetry(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            if active_mode == "SIMULATOR":
                data = simulator.get_telemetry_dict()
            else:
                data = mav_bridge.telemetry
            
            # Log to Blackbox recorder
            blackbox.log_telemetry(data)
            
            await websocket.send_json(data)
            await asyncio.sleep(0.05)  # 20 Hz telemetry push
    except WebSocketDisconnect:
        pass


# Serve Static UI files
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")
app.mount("/", StaticFiles(directory=UI_DIR, html=True), name="ui")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=18080, log_level="warning")
