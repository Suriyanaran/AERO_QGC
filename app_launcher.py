"""
Aero-Q Tactical Ground Control Station - Native Window Desktop Launcher
Single-process daemon launcher: serves backend MAVLink engine on port 18080
and opens standalone native application window in Edge / Chrome.
"""

import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(BASE_DIR, "logs")
os.makedirs(LOG_DIR, exist_ok=True)
LAUNCHER_LOG = os.path.join(LOG_DIR, "launcher.log")

# Safely redirect standard streams to file to prevent WinError 6 (invalid console handle)
try:
    log_fp = open(LAUNCHER_LOG, "a", buffering=1, encoding="utf-8")
    sys.stdout = log_fp
    sys.stderr = log_fp
except Exception:
    pass

import time
import socket
import threading
import subprocess

PORT = 18080
APP_URL = f"http://127.0.0.1:{PORT}"


def is_port_in_use(port):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.3)
            return s.connect_ex(('127.0.0.1', port)) == 0
    except Exception:
        return False


def launch_window():
    time.sleep(1.2)
    browser_candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    
    browser_exe = None
    for cand in browser_candidates:
        if os.path.exists(cand):
            browser_exe = cand
            break

    if browser_exe:
        cmd = [
            browser_exe,
            f"--app={APP_URL}",
            "--window-size=1600,950",
            "--window-position=50,30"
        ]
        try:
            subprocess.Popen(cmd)
            return
        except Exception as e:
            print("Browser popen error:", e)

    import webbrowser
    webbrowser.open(APP_URL)


if __name__ == "__main__":
    print(f"--- Aero-Q Launcher started at {time.ctime()} ---")
    if is_port_in_use(PORT):
        print(f"Port {PORT} already in use. Opening window only.")
        launch_window()
        sys.exit(0)

    t = threading.Thread(target=launch_window, daemon=True)
    t.start()

    try:
        import uvicorn
        from server import app
        uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
    except Exception as e:
        import traceback
        traceback.print_exc()
