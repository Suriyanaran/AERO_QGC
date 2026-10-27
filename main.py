"""
Aero-Q Tactical Ground Control Station - Unified Executable Entrypoint
Bundles backend MAVLink server and native window UI into a single standalone process.
"""

import os
import sys

# Prevent crash when running headless
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

import time
import threading
import subprocess
import uvicorn
from server import app


def launch_window():
    time.sleep(1.5)
    url = "http://127.0.0.1:18080"
    EDGE_EXE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    CHROME_EXE = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    
    browser_exe = None
    if os.path.exists(EDGE_EXE):
        browser_exe = EDGE_EXE
    elif os.path.exists(CHROME_EXE):
        browser_exe = CHROME_EXE
        
    if browser_exe:
        subprocess.Popen([browser_exe, f"--app={url}", "--window-size=1600,950", "--window-position=60,30"])
    else:
        import webbrowser
        webbrowser.open(url)


if __name__ == "__main__":
    t = threading.Thread(target=launch_window, daemon=True)
    t.start()
    uvicorn.run(app, host="127.0.0.1", port=18080, log_level="warning")
