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
            t.get("flight_time") or 0.0,
            t.get("mode") or "",
            bool(t.get("armed", False)),
            t.get("pitch") if t.get("pitch") is not None else 0.0,
            t.get("roll") if t.get("roll") is not None else 0.0,
            t.get("yaw") if t.get("yaw") is not None else 0.0,
            t.get("lat") if t.get("lat") is not None else 0.0,
            t.get("lon") if t.get("lon") is not None else 0.0,
            t.get("alt") if t.get("alt") is not None else 0.0,
            t.get("target_alt") if t.get("target_alt") is not None else 0.0,
            t.get("groundspeed") if t.get("groundspeed") is not None else 0.0,
            t.get("airspeed") if t.get("airspeed") is not None else 0.0,
            t.get("climb") if t.get("climb") is not None else 0.0,
            t.get("voltage") if t.get("voltage") is not None else 0.0,
            t.get("current") if t.get("current") is not None else 0.0,
            t.get("battery_pct") if t.get("battery_pct") is not None else 0.0,
            t.get("satellites") or 0,
            t.get("fix_type") or 0,
            t.get("hdop") if t.get("hdop") is not None else 0.0,
            t.get("rssi") or 0
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
            "connected": True,
            "link_status": "CONNECTED",
            "link_active": True,
            "heartbeat_count": 999,
            "device": "BUILT-IN 6-DOF SIMULATOR",
            "baud": 0,
            "autopilot": "AERO-Q TACTICAL SIM",
            "vehicle_type": "Quadcopter",
            "armed": self.armed,
            "mode": self.mode,
            "pitch": round(self.pitch, 2),
            "roll": round(self.roll, 2),
            "yaw": round(self.yaw, 1),
            "lat": round(self.lat, 7),
            "lon": round(self.lon, 7),
            "alt": round(self.alt, 2),
            "alt_msl": round(self.alt, 2),
            "target_alt": round(self.target_alt, 1),
            "groundspeed": round(self.groundspeed, 2),
            "airspeed": round(self.airspeed, 2),
            "climb": round(self.vz, 2),
            "voltage": round(self.voltage, 2),
            "current": round(self.current, 2),
            "battery_pct": round(self.battery_pct, 1),
            "battery_state": "OK" if self.battery_pct > 20 else "LOW",
            "battery_cells": self.battery_cells,
            "satellites": self.satellites,
            "fix_type": self.fix_type,
            "hdop": round(self.hdop, 2),
            "rssi": self.rssi,
            "flight_time": round(self.flight_time, 1),
            "wp_idx": self.current_wp_idx,
            "total_wps": len(self.waypoints),
            "sensors": {
                "imu": "CALIBRATED",
                "compass": "LOCKED",
                "barometer": "ONLINE",
                "gps": "3D FIX"
            },
            "logs": self.logs[-15:]
        }


def estimate_lipo_pct(voltage: float) -> tuple:
    """Estimates remaining battery percentage and cell count for standard LiPo batteries."""
    if voltage < 5.5:
        return None, 0

    # Common battery packs: 2S (7.4V), 3S (11.1V), 4S (14.8V), 6S (22.2V)
    for cells in [1, 2, 3, 4, 5, 6, 8, 12]:
        min_v = cells * 3.3
        max_v = cells * 4.25
        if min_v <= voltage <= max_v:
            cell_v = voltage / cells
            pct = (cell_v - 3.45) / (4.20 - 3.45) * 100.0
            return round(max(0.0, min(100.0, pct)), 1), cells

    cells = max(1, round(voltage / 3.85))
    cell_v = voltage / cells
    pct = (cell_v - 3.45) / (4.20 - 3.45) * 100.0
    return round(max(0.0, min(100.0, pct)), 1), cells


class RealMavlinkBridge:
    """Manages physical serial / UDP connection to Pixhawk / PX4 / ArduPilot with active stream negotiation."""
    def __init__(self):
        self.conn = None
        self.device = ""
        self.baud = 57600
        self.connected = False          # Serial / UDP port open
        self.link_active = False        # Received heartbeat within last 3.5s
        self.link_status = "DISCONNECTED"  # DISCONNECTED | SEARCHING | CONNECTED | LOST
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self.last_error = ""
        
        self.last_heartbeat_time = 0.0
        self.last_stream_request_time = 0.0
        self.last_heartbeat_sent = 0.0
        self.heartbeat_count = 0
        
        self.target_system = 1
        self.target_component = 1
        self.autopilot_name = "Pixhawk / Autopilot"
        self.vehicle_type = "Drone"
        
        self.telemetry = self._get_initial_telemetry()

    def _get_initial_telemetry(self) -> Dict[str, Any]:
        return {
            "source": "PIXHAWK_MAVLINK",
            "connected": False,
            "link_status": "DISCONNECTED",
            "link_active": False,
            "heartbeat_count": 0,
            "device": "",
            "baud": 0,
            "autopilot": "DISCONNECTED",
            "vehicle_type": "Drone",
            "armed": False,
            "mode": "DISCONNECTED",
            "pitch": 0.0,
            "roll": 0.0,
            "yaw": 0.0,
            "lat": 0.0,
            "lon": 0.0,
            "alt": 0.0,
            "alt_msl": 0.0,
            "target_alt": 0.0,
            "groundspeed": 0.0,
            "airspeed": 0.0,
            "climb": 0.0,
            "throttle": 0.0,
            "voltage": None,
            "current": 0.0,
            "battery_pct": None,
            "battery_state": "NO_BATTERY",
            "battery_cells": 0,
            "satellites": 0,
            "fix_type": 0,
            "hdop": 99.0,
            "rssi": 0,
            "flight_time": 0.0,
            "wp_idx": 0,
            "total_wps": 0,
            "sensors": {
                "imu": "--",
                "compass": "--",
                "barometer": "--",
                "gps": "--"
            },
            "last_statustext": "",
            "last_cmd_ack": "",
            "logs": []
        }

    def add_log(self, text: str):
        timestamp = time.strftime("%H:%M:%S")
        entry = f"[{timestamp}] {text}"
        self.telemetry["logs"].append(entry)
        if len(self.telemetry["logs"]) > 35:
            self.telemetry["logs"].pop(0)

    def connect(self, device: str, baud: int = 57600) -> tuple:
        if not mavutil:
            self.last_error = "PyMAVLink library is not installed."
            return False, self.last_error
        self.disconnect()
        try:
            self.device = device
            self.baud = baud
            self.conn = mavutil.mavlink_connection(device, baud=baud)
            self.connected = True
            self.link_active = False
            self.link_status = "SEARCHING"
            self.running = True
            self.heartbeat_count = 0
            self.last_heartbeat_time = 0.0
            self.last_stream_request_time = 0.0
            self.last_heartbeat_sent = 0.0
            
            self.telemetry = self._get_initial_telemetry()
            self.telemetry["device"] = device
            self.telemetry["baud"] = baud
            self.telemetry["link_status"] = "SEARCHING"
            self.telemetry["mode"] = "CONNECTING..."
            self.add_log(f"Opened {device} at {baud} baud. Waiting for flight controller heartbeat...")
            
            self.thread = threading.Thread(target=self._read_loop, daemon=True)
            self.thread.start()
            return True, ""
        except Exception as e:
            self.connected = False
            self.link_status = "DISCONNECTED"
            self.last_error = str(e)
            return False, str(e)

    def disconnect(self):
        self.running = False
        if self.conn:
            try:
                self.conn.close()
            except Exception:
                pass
            self.conn = None
        self.connected = False
        self.link_active = False
        self.link_status = "DISCONNECTED"
        self.heartbeat_count = 0
        self.telemetry = self._get_initial_telemetry()

    def request_telemetry_streams(self):
        """Sends data stream requests across both legacy MAVLink 1 and modern MAVLink 2 intervals."""
        if not self.conn:
            return
        sys_id = self.target_system
        comp_id = self.target_component
        try:
            # 1. Standard ArduPilot stream requests
            streams = [
                (mavutil.mavlink.MAV_DATA_STREAM_ALL, 10),
                (mavutil.mavlink.MAV_DATA_STREAM_EXTENDED_STATUS, 2),  # SYS_STATUS, battery
                (mavutil.mavlink.MAV_DATA_STREAM_EXTRA1, 20),           # ATTITUDE
                (mavutil.mavlink.MAV_DATA_STREAM_EXTRA2, 10),           # VFR_HUD
                (mavutil.mavlink.MAV_DATA_STREAM_EXTRA3, 2),            # AHRS / sensors
                (mavutil.mavlink.MAV_DATA_STREAM_POSITION, 10),         # GLOBAL_POSITION_INT
                (mavutil.mavlink.MAV_DATA_STREAM_RAW_SENSORS, 5),       # GPS_RAW_INT, IMU
                (mavutil.mavlink.MAV_DATA_STREAM_RC_CHANNELS, 2),       # RC inputs / RSSI
            ]
            for stream_id, rate in streams:
                try:
                    self.conn.mav.request_data_stream_send(sys_id, comp_id, stream_id, rate, 1)
                except Exception:
                    pass

            # 2. Modern MAVLink 2 SET_MESSAGE_INTERVAL (ArduPilot 4+ and PX4 Pro)
            intervals = [
                (mavutil.mavlink.MAVLINK_MSG_ID_ATTITUDE, 50000),             # 20 Hz
                (mavutil.mavlink.MAVLINK_MSG_ID_GLOBAL_POSITION_INT, 100000), # 10 Hz
                (mavutil.mavlink.MAVLINK_MSG_ID_VFR_HUD, 100000),             # 10 Hz
                (mavutil.mavlink.MAVLINK_MSG_ID_SYS_STATUS, 500000),          # 2 Hz
                (mavutil.mavlink.MAVLINK_MSG_ID_BATTERY_STATUS, 500000),      # 2 Hz
                (mavutil.mavlink.MAVLINK_MSG_ID_GPS_RAW_INT, 200000),         # 5 Hz
                (mavutil.mavlink.MAVLINK_MSG_ID_RADIO_STATUS, 500000),        # 2 Hz
                (mavutil.mavlink.MAVLINK_MSG_ID_RC_CHANNELS, 500000),         # 2 Hz
            ]
            for msg_id, interval_us in intervals:
                try:
                    self.conn.mav.command_long_send(
                        sys_id, comp_id,
                        mavutil.mavlink.MAV_CMD_SET_MESSAGE_INTERVAL,
                        0,
                        msg_id,
                        interval_us,
                        0, 0, 0, 0, 0
                    )
                except Exception:
                    pass
        except Exception as e:
            pass

    def _update_battery(self, voltage: float, current_raw: Any, pct_raw: Any):
        if voltage is None or voltage <= 0.5:
            return
        self.telemetry["voltage"] = round(voltage, 2)
        
        if current_raw is not None and current_raw >= 0:
            self.telemetry["current"] = round(current_raw / 100.0, 2)
        else:
            self.telemetry["current"] = 0.0

        if voltage <= 5.4:
            # Powered via 5V USB on workbench (no LiPo flight battery plugged in)
            self.telemetry["battery_pct"] = None
            self.telemetry["battery_state"] = "USB_POWER"
            self.telemetry["battery_cells"] = 0
        else:
            # Flight LiPo connected
            if pct_raw is not None and 0 <= pct_raw <= 100:
                self.telemetry["battery_pct"] = float(pct_raw)
                _, cells = estimate_lipo_pct(voltage)
                self.telemetry["battery_cells"] = cells
            else:
                est_pct, cells = estimate_lipo_pct(voltage)
                self.telemetry["battery_pct"] = est_pct
                self.telemetry["battery_cells"] = cells

            pct = self.telemetry["battery_pct"] or 50.0
            if pct <= 15.0:
                self.telemetry["battery_state"] = "CRITICAL"
            elif pct <= 25.0:
                self.telemetry["battery_state"] = "LOW"
            else:
                self.telemetry["battery_state"] = "OK"

    def _update_sensors_health(self, present: int, enabled: int, health: int):
        sensors = self.telemetry["sensors"]
        # IMU (Gyro: bit 1, Accel: bit 2)
        if present & 3:
            sensors["imu"] = "CALIBRATED" if (health & 3) == 3 else "UNHEALTHY"
        else:
            sensors["imu"] = "CALIBRATED"
            
        # Compass (Mag: bit 4)
        if present & 4:
            sensors["compass"] = "LOCKED" if (health & 4) else "CALIB_REQ"
        else:
            sensors["compass"] = "LOCKED"
            
        # Barometer (Abs pressure: bit 8)
        if present & 8:
            sensors["barometer"] = f"{self.telemetry['alt']:.1f}m AGL" if (health & 8) else "ERROR"
        else:
            sensors["barometer"] = f"{self.telemetry['alt']:.1f}m AGL"
            
        # GPS (bit 32)
        if present & 32:
            sensors["gps"] = "OK" if (health & 32) else "NO_LOCK"
        else:
            sensors["gps"] = "OK" if self.telemetry["fix_type"] >= 3 else "SEARCHING"

    def _read_loop(self):
        last_flight_calc = time.time()
        while self.running and self.conn:
            try:
                now = time.time()
                # 1. Send periodic GCS heartbeat at 1 Hz so autopilot recognizes the Ground Station
                if now - self.last_heartbeat_sent >= 1.0:
                    try:
                        self.conn.mav.heartbeat_send(
                            mavutil.mavlink.MAV_TYPE_GCS,
                            mavutil.mavlink.MAV_AUTOPILOT_INVALID,
                            0, 0, 0
                        )
                        self.last_heartbeat_sent = now
                    except Exception:
                        pass

                # 2. Check heartbeat watchdog timeout (3.5 seconds)
                if self.last_heartbeat_time > 0 and (now - self.last_heartbeat_time > 3.5):
                    if self.link_active:
                        self.link_active = False
                        self.link_status = "LOST"
                        self.telemetry["mode"] = "LOST LINK"
                        self.add_log("WARNING: Vehicle MAVLink heartbeat lost!")

                # 3. Non-blocking packet receive
                msg = self.conn.recv_match(blocking=True, timeout=0.3)
                if not msg:
                    continue

                mtype = msg.get_type()
                
                if mtype == "HEARTBEAT":
                    # Ignore packets sent by other GCS instances
                    if msg.type == mavutil.mavlink.MAV_TYPE_GCS or getattr(msg, 'target_component', 0) == 190:
                        continue
                        
                    # Latch vehicle target IDs
                    src_sys = msg.get_srcSystem()
                    src_comp = msg.get_srcComponent()
                    if src_sys > 0:
                        self.target_system = src_sys
                        self.target_component = src_comp
                        self.conn.target_system = src_sys
                        self.conn.target_component = src_comp

                    # Decode vehicle type
                    type_map = {
                        mavutil.mavlink.MAV_TYPE_QUADROTOR: "Quadcopter",
                        mavutil.mavlink.MAV_TYPE_HEXAROTOR: "Hexacopter",
                        mavutil.mavlink.MAV_TYPE_OCTOROTOR: "Octocopter",
                        mavutil.mavlink.MAV_TYPE_FIXED_WING: "Fixed Wing",
                        mavutil.mavlink.MAV_TYPE_GROUND_ROVER: "Rover",
                        mavutil.mavlink.MAV_TYPE_SUBMARINE: "Submarine",
                        mavutil.mavlink.MAV_TYPE_VTOL_TILTROTOR: "VTOL",
                    }
                    self.vehicle_type = type_map.get(msg.type, "Multirotor")
                    self.telemetry["vehicle_type"] = self.vehicle_type

                    # Decode autopilot firmware
                    ap_map = {
                        mavutil.mavlink.MAV_AUTOPILOT_ARDUPILOTMEGA: "ArduPilot",
                        mavutil.mavlink.MAV_AUTOPILOT_PX4: "PX4 Pro",
                        mavutil.mavlink.MAV_AUTOPILOT_GENERIC: "Generic Autopilot",
                    }
                    self.autopilot_name = ap_map.get(msg.autopilot, "ArduPilot/Pixhawk")
                    self.telemetry["autopilot"] = self.autopilot_name

                    # Armed status
                    self.telemetry["armed"] = bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)

                    # Flight mode extraction
                    mode_name = None
                    try:
                        mode_name = mavutil.mode_string_v10(msg)
                    except Exception:
                        pass
                    if not mode_name and hasattr(self.conn, 'flightmode'):
                        mode_name = self.conn.flightmode
                    if not mode_name:
                        inv_map = {v: k for k, v in ARDUCOPTER_MODES.items()}
                        mode_name = inv_map.get(msg.custom_mode, str(msg.custom_mode))
                    if mode_name:
                        self.telemetry["mode"] = mode_name.upper()

                    # Connection transition
                    first_link = (self.heartbeat_count == 0 or not self.link_active)
                    self.last_heartbeat_time = now
                    self.heartbeat_count += 1
                    self.link_active = True
                    self.link_status = "CONNECTED"

                    if first_link:
                        self.add_log(f"Linked to {self.autopilot_name} ({self.vehicle_type}), Sys ID {self.target_system}. Streams active.")
                        self.request_telemetry_streams()
                        self.last_stream_request_time = now
                    elif now - self.last_stream_request_time > 7.0:
                        # Periodically refresh streams to ensure uninterrupted flow
                        self.request_telemetry_streams()
                        self.last_stream_request_time = now

                elif mtype == "ATTITUDE":
                    self.telemetry["pitch"] = round(math.degrees(msg.pitch), 2)
                    self.telemetry["roll"] = round(math.degrees(msg.roll), 2)
                    self.telemetry["yaw"] = round((math.degrees(msg.yaw) + 360) % 360, 1)

                elif mtype == "GLOBAL_POSITION_INT":
                    lat = msg.lat / 1e7
                    lon = msg.lon / 1e7
                    alt = round(msg.relative_alt / 1000.0, 2)
                    alt_msl = round(msg.alt / 1000.0, 2)
                    if abs(lat) > 0.0001 or abs(lon) > 0.0001:
                        self.telemetry["lat"] = round(lat, 7)
                        self.telemetry["lon"] = round(lon, 7)
                    self.telemetry["alt"] = alt
                    self.telemetry["alt_msl"] = alt_msl

                elif mtype == "VFR_HUD":
                    self.telemetry["groundspeed"] = round(msg.groundspeed, 2)
                    self.telemetry["airspeed"] = round(msg.airspeed, 2)
                    self.telemetry["climb"] = round(msg.climb, 2)
                    self.telemetry["throttle"] = round(msg.throttle, 1)
                    if abs(msg.alt) > 0.05 and self.telemetry["alt"] == 0.0:
                        self.telemetry["alt"] = round(msg.alt, 2)

                elif mtype == "GPS_RAW_INT":
                    self.telemetry["fix_type"] = msg.fix_type
                    self.telemetry["satellites"] = msg.satellites_visible
                    self.telemetry["hdop"] = round(msg.eph / 100.0, 2) if msg.eph < 65535 else 99.0
                    if (self.telemetry["lat"] == 0 or self.telemetry["lon"] == 0) and msg.fix_type >= 2:
                        lat = msg.lat / 1e7
                        lon = msg.lon / 1e7
                        if abs(lat) > 0.0001 or abs(lon) > 0.0001:
                            self.telemetry["lat"] = round(lat, 7)
                            self.telemetry["lon"] = round(lon, 7)

                elif mtype == "SYS_STATUS":
                    raw_v = msg.voltage_battery
                    if 0 < raw_v < 65000:
                        v = round(raw_v / 1000.0, 2)
                        self._update_battery(v, msg.current_battery, msg.battery_remaining)
                    self._update_sensors_health(
                        msg.onboard_control_sensors_present,
                        msg.onboard_control_sensors_enabled,
                        msg.onboard_control_sensors_health
                    )

                elif mtype == "BATTERY_STATUS":
                    valid_cells = [v for v in getattr(msg, 'voltages', []) if 0 < v < 65535]
                    if valid_cells:
                        tot_v = round(sum(valid_cells) / 1000.0, 2)
                        self._update_battery(
                            tot_v,
                            getattr(msg, 'current_battery', -1),
                            getattr(msg, 'battery_remaining', -1)
                        )

                elif mtype in ["RADIO_STATUS", "RADIO"]:
                    self.telemetry["rssi"] = min(100, max(0, int((msg.rssi / 255.0) * 100)))

                elif mtype in ["RC_CHANNELS", "RC_CHANNELS_RAW"]:
                    if hasattr(msg, 'rssi') and msg.rssi > 0 and self.telemetry["rssi"] == 0:
                        self.telemetry["rssi"] = min(100, max(0, int((msg.rssi / 255.0) * 100)))

                elif mtype == "STATUSTEXT":
                    txt = getattr(msg, 'text', '')
                    if isinstance(txt, bytes):
                        txt = txt.decode("utf-8", errors="ignore")
                    txt = txt.strip("\x00 ").strip()
                    sev = getattr(msg, 'severity', 6)
                    sev_tag = {0: "EMERGENCY", 1: "ALERT", 2: "CRITICAL", 3: "ERROR", 4: "WARNING", 5: "NOTICE", 6: "INFO"}.get(sev, "INFO")
                    if txt:
                        self.add_log(f"[{sev_tag}] {txt}")
                        self.telemetry["last_statustext"] = f"{sev_tag}: {txt}"

                elif mtype == "COMMAND_ACK":
                    cmd = getattr(msg, 'command', 0)
                    res = getattr(msg, 'result', 0)
                    res_str = {0: "ACCEPTED", 1: "TEMPORARILY_REJECTED", 2: "DENIED", 3: "UNSUPPORTED", 4: "FAILED", 5: "IN_PROGRESS"}.get(res, str(res))
                    cmd_name = {400: "ARM/DISARM", 176: "SET_MODE", 22: "TAKEOFF", 511: "SET_INTERVAL"}.get(cmd, f"CMD_{cmd}")
                    if cmd in [400, 176, 22]:
                        self.add_log(f"[CMD ACK] {cmd_name} -> {res_str}")
                        self.telemetry["last_cmd_ack"] = f"{cmd_name}: {res_str}"

                elif mtype == "NAV_CONTROLLER_OUTPUT":
                    self.telemetry["target_alt"] = round(getattr(msg, 'nav_altitude', 0.0), 1)

                elif mtype == "MISSION_CURRENT":
                    self.telemetry["wp_idx"] = getattr(msg, 'seq', 0)

                # Flight time accumulator
                if self.telemetry["armed"] and self.link_active:
                    dt = now - last_flight_calc
                    self.telemetry["flight_time"] = round(self.telemetry["flight_time"] + dt, 1)
                last_flight_calc = now

            except Exception:
                time.sleep(0.05)

    def get_telemetry_dict(self) -> Dict[str, Any]:
        d = dict(self.telemetry)
        d["connected"] = self.connected
        d["link_active"] = self.link_active
        d["link_status"] = self.link_status
        d["heartbeat_count"] = self.heartbeat_count
        d["device"] = self.device
        d["baud"] = self.baud
        d["autopilot"] = self.autopilot_name
        d["vehicle_type"] = self.vehicle_type
        d["logs"] = self.telemetry["logs"][-20:]
        return d


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


# QGroundControl Backend Helpers
QGC_EXE_CANDIDATES = [
    r"C:\Program Files\QGroundControl\bin\QGroundControl.exe",
    r"C:\Program Files\QGroundControl\QGroundControl.exe",
    r"C:\Program Files (x86)\QGroundControl\QGroundControl.exe",
]

ARDUCOPTER_MODES = {
    "STABILIZE": 0, "ACRO": 1, "ALT_HOLD": 2, "AUTO": 3,
    "GUIDED": 4, "LOITER": 5, "RTL": 6, "CIRCLE": 7,
    "LAND": 9, "DRIFT": 11, "SPORT": 13, "FLIP": 14,
    "AUTOTUNE": 15, "POSHOLD": 16, "BRAKE": 17, "THROW": 18
}

def find_qgc_exe() -> Optional[str]:
    for cand in QGC_EXE_CANDIDATES:
        if os.path.exists(cand):
            return cand
    return None

def is_qgc_running() -> bool:
    try:
        flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        out = subprocess.check_output(
            ['tasklist', '/FI', 'IMAGENAME eq QGroundControl.exe'],
            creationflags=flags
        ).decode('utf-8', errors='ignore')
        return 'QGroundControl.exe' in out
    except Exception:
        return False

def launch_qgc_backend(minimized: bool = False) -> tuple:
    exe = find_qgc_exe()
    if not exe:
        return False, "QGroundControl executable not found on system."
    if is_qgc_running():
        return True, "QGroundControl is already running in background."
    try:
        startupinfo = subprocess.STARTUPINFO()
        if minimized:
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = 6  # SW_MINIMIZE
        subprocess.Popen([exe], startupinfo=startupinfo, shell=False)
        return True, "QGroundControl backend started successfully."
    except Exception as e:
        return False, str(e)


# API Models
class ConnectRequest(BaseModel):
    mode: str               # 'simulation', 'serial', 'autoconnect', 'qgc', 'udp'
    port: Optional[str] = "COM3"
    baud: Optional[int] = 115200

class CommandRequest(BaseModel):
    action: str             # 'arm', 'disarm', 'set_mode', 'takeoff', 'waypoints', 'reset_home'
    payload: Optional[Dict[str, Any]] = None


@app.get("/api/qgc/status")
def get_qgc_status():
    running = is_qgc_running()
    exe = find_qgc_exe()
    return {
        "installed": bool(exe),
        "path": exe,
        "running": running,
        "connected": (active_mode == "MAVLINK" and mav_bridge.connected),
        "active_mode": active_mode,
        "forwarding_port": 14550
    }

@app.post("/api/qgc/launch")
def api_launch_qgc():
    ok, msg = launch_qgc_backend(minimized=False)
    if ok:
        return {"status": "ok", "message": msg}
    return JSONResponse(status_code=500, content={"status": "error", "message": msg})


@app.get("/api/ports")
def get_serial_ports():
    ports = []
    if serial:
        try:
            for p in serial.tools.list_ports.comports():
                desc = p.description or p.device
                hwid = getattr(p, "hwid", "") or ""
                desc_lower = desc.lower()
                hwid_lower = hwid.lower()
                
                # Check if known flight controller VID/PID or name
                is_fc = any(k in hwid_lower or k in desc_lower for k in [
                    "26ac", "1209", "2dae", "3162", "pixhawk", "ardupilot", "px4", "cube", "radiolink", "holybro"
                ])
                is_radio = any(k in hwid_lower or k in desc_lower for k in [
                    "10c4", "cp210", "ftdi", "0403", "sik", "telemetry", "3dr"
                ])
                
                recommended_baud = 57600 if is_radio else 115200

                ports.append({
                    "device": p.device,
                    "description": desc,
                    "hwid": hwid,
                    "is_fc": is_fc,
                    "is_radio": is_radio,
                    "recommended_baud": recommended_baud
                })
        except Exception as e:
            print("Port listing error:", e)
    return {"ports": ports, "active_mode": active_mode}


@app.post("/api/autoconnect")
def autoconnect_drone():
    """Scans all available COM ports across standard baud rates to detect Pixhawk/ArduPilot/PX4."""
    global active_mode
    if not serial or not mavutil:
        return JSONResponse(status_code=500, content={"status": "error", "message": "Serial or PyMAVLink not installed."})

    ports = list(serial.tools.list_ports.comports())
    if not ports:
        return {
            "status": "not_found",
            "message": "No COM ports detected on Windows. Connect your drone via USB or Telemetry radio."
        }

    # Filter out Bluetooth ports which hang
    valid_ports = [p for p in ports if "bluetooth" not in (p.description or "").lower()]
    if not valid_ports:
        return {
            "status": "not_found",
            "message": "Only Bluetooth ports detected. Connect your drone via physical USB or Telemetry Radio."
        }

    # Sort ports: prioritize known flight controller HWIDs / descriptions
    def port_priority(p):
        desc = (p.description or "").lower()
        hwid = (p.hwid or "").lower()
        if any(k in hwid or k in desc for k in ["26ac", "1209", "2dae", "3162", "pixhawk", "ardupilot", "px4"]):
            return 0
        if any(k in hwid or k in desc for k in ["0483", "stm32", "cube", "radiolink", "holybro"]):
            return 1
        if any(k in hwid or k in desc for k in ["10c4", "cp210", "ftdi", "0403", "sik", "telemetry", "ch340", "1a86"]):
            return 2
        return 5

    sorted_ports = sorted(valid_ports, key=port_priority)
    baud_rates = [115200, 57600, 921600]

    tested_ports = []
    for p in sorted_ports:
        port_dev = p.device
        tested_ports.append(port_dev)
        for baud in baud_rates:
            try:
                # Test connection briefly
                test_conn = mavutil.mavlink_connection(port_dev, baud=baud)
                test_conn.mav.heartbeat_send(mavutil.mavlink.MAV_TYPE_GCS, mavutil.mavlink.MAV_AUTOPILOT_INVALID, 0, 0, 0)
                hb = test_conn.wait_heartbeat(timeout=1.0)
                test_conn.close()
                if hb and hb.type != mavutil.mavlink.MAV_TYPE_GCS:
                    # Found!
                    mav_bridge.disconnect()
                    ok, err = mav_bridge.connect(port_dev, baud=baud)
                    if ok:
                        active_mode = "MAVLINK"
                        return {
                            "status": "ok",
                            "port": port_dev,
                            "baud": baud,
                            "autopilot": mav_bridge.autopilot_name,
                            "type": mav_bridge.vehicle_type,
                            "message": f"Successfully connected to {mav_bridge.autopilot_name} ({mav_bridge.vehicle_type}) on {port_dev} @ {baud} baud!"
                        }
            except Exception:
                continue

    return {
        "status": "not_found",
        "tested_ports": tested_ports,
        "message": f"Scanned {len(tested_ports)} COM port(s) at 115200 & 57600 baud, but no MAVLink heartbeat was detected. Verify drone power and data cable."
    }


@app.post("/api/connect")
def connect_drone(req: ConnectRequest):
    global active_mode
    mode = req.mode.lower()
    
    if mode == "simulation":
        active_mode = "SIMULATOR"
        mav_bridge.disconnect()
        simulator.add_log("Switched to Aero-Q Flight Simulator mode.")
        return {"status": "ok", "mode": "SIMULATOR"}
        
    elif mode == "autoconnect":
        return autoconnect_drone()
        
    elif mode == "qgc":
        exe = find_qgc_exe()
        if not exe and not is_qgc_running():
            return JSONResponse(status_code=400, content={
                "status": "error",
                "message": "QGroundControl is not installed on this system. Please use 'Direct Hardware Serial' (USB/Telemetry Radio) or 'Built-in Tactical Simulator'."
            })
            
        if not is_qgc_running():
            launch_qgc_backend(minimized=False)
            time.sleep(1.0)
            
        dev = "udpin:0.0.0.0:14550"
        ok, err = mav_bridge.connect(dev, baud=57600)
        if ok:
            active_mode = "MAVLINK"
            mav_bridge.telemetry["source"] = "QGROUNDCONTROL_BACKEND"
            mav_bridge.add_log("Aero-Q linked to QGroundControl backend on UDP:14550.")
            return {"status": "ok", "mode": "MAVLINK", "backend": "QGC", "device": dev}
        else:
            return JSONResponse(status_code=400, content={"status": "error", "message": f"Could not bind to QGC UDP port: {err}"})
            
    elif mode in ["serial", "udp"]:
        dev = req.port if mode == "serial" else "udpin:0.0.0.0:14550"
        baud = req.baud or 115200
        ok, err = mav_bridge.connect(dev, baud=baud)
        if ok:
            active_mode = "MAVLINK"
            return {"status": "ok", "mode": "MAVLINK", "device": dev, "baud": baud}
        else:
            err_detail = err if err else f"Could not open {dev}."
            if "FileNotFoundError" in err_detail or "cannot find the file" in err_detail.lower():
                user_msg = f"{dev} was not found on this computer. Verify your USB cable or telemetry radio is connected."
            elif "PermissionError" in err_detail or "access is denied" in err_detail.lower():
                user_msg = f"{dev} is locked by another program. Close any other software using {dev} and retry."
            else:
                user_msg = f"Failed to connect to {dev}: {err_detail}"
            return JSONResponse(status_code=400, content={"status": "error", "message": user_msg})
            
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
        # Hardware MAVLink
        if not mav_bridge.conn or not mav_bridge.link_active:
            return JSONResponse(status_code=400, content={
                "status": "error",
                "message": "Flight controller is not actively linked. Check USB/radio connection."
            })

        target_sys = mav_bridge.target_system
        target_comp = mav_bridge.target_component
        
        try:
            if action == "arm":
                force = 21196 if payload.get("force", False) else 0
                mav_bridge.conn.mav.command_long_send(
                    target_sys, target_comp,
                    mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
                    0, 1, force, 0, 0, 0, 0, 0
                )
                mav_bridge.add_log("Sent ARM command to vehicle.")
            elif action == "disarm":
                force = 21196 if payload.get("force", False) else 0
                mav_bridge.conn.mav.command_long_send(
                    target_sys, target_comp,
                    mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
                    0, 0, force, 0, 0, 0, 0, 0
                )
                mav_bridge.add_log("Sent DISARM command to vehicle.")
            elif action == "takeoff":
                alt = float(payload.get("alt", 10.0))
                mav_bridge.conn.mav.command_long_send(
                    target_sys, target_comp,
                    mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
                    0, 0, 0, 0, 0, 0, 0, alt
                )
                mav_bridge.add_log(f"Sent TAKEOFF command to {alt}m.")
            elif action == "set_mode":
                mode_str = payload.get("mode", "LOITER").upper()
                if hasattr(mav_bridge.conn, 'mode_mapping'):
                    mapping = mav_bridge.conn.mode_mapping()
                    if mapping and mode_str in mapping:
                        mav_bridge.conn.set_mode(mapping[mode_str])
                    elif mode_str in ARDUCOPTER_MODES:
                        mav_bridge.conn.set_mode(ARDUCOPTER_MODES[mode_str])
                elif mode_str in ARDUCOPTER_MODES:
                    mav_bridge.conn.set_mode(ARDUCOPTER_MODES[mode_str])
                # MAVLink DO_SET_MODE fallback
                if mode_str in ARDUCOPTER_MODES:
                    mav_bridge.conn.mav.command_long_send(
                        target_sys, target_comp,
                        mavutil.mavlink.MAV_CMD_DO_SET_MODE,
                        0,
                        mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
                        ARDUCOPTER_MODES[mode_str],
                        0, 0, 0, 0, 0
                    )
                mav_bridge.add_log(f"Sent flight mode request: {mode_str}.")
        except Exception as e:
            mav_bridge.add_log(f"Command dispatch error: {e}")
            return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})

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
                data = mav_bridge.get_telemetry_dict()
            
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
