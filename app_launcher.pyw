"""
Aero-Q Tactical Ground Control Station - Native Window Desktop Launcher
Single-process daemon launcher: serves backend MAVLink engine on port 18080
and opens standalone native application window in Edge / Chrome.
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
        except Exception:
            pass

    import webbrowser
    webbrowser.open(APP_URL)


if __name__ == "__main__":
    # If server is already running, just bring up the window
    if is_port_in_use(PORT):
        launch_window()
        sys.exit(0)

    # Launch browser window in background after server binds
    t = threading.Thread(target=launch_window, daemon=True)
    t.start()

    # Import and run server in main thread
    import uvicorn
    from server import app
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
