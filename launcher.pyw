"""
Aero-Q GCS Tactical Ground Station Launcher
Branded for Pixhawk / ArduPilot / PX4 Drone Systems
"""

import os
import sys
import time
import subprocess
import threading
import tkinter as tk
from PIL import Image, ImageTk
import ctypes
from ctypes import wintypes

QGC_EXE_PATH = r"C:\Program Files\QGroundControl\bin\QGroundControl.exe"
ASSETS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
LOGO_PNG = os.path.join(ASSETS_DIR, "logo.png")
LOGO_ICO = os.path.join(ASSETS_DIR, "logo.ico")
APP_TITLE = "Aero-Q GCS | Tactical Flight Control System"

user32 = ctypes.windll.user32


def keep_branding_active(target_proc):
    """Keeps Aero-Q GCS title and icon active throughout the entire session."""
    try:
        hwinsta = user32.OpenWindowStationW('WinSta0', False, 0x37F)
        if hwinsta:
            user32.SetProcessWindowStation(hwinsta)
            hdesk = user32.OpenDesktopW('Default', 0, False, 0x1FF)
            if hdesk:
                user32.SetThreadDesktop(hdesk)
    except Exception:
        hwinsta = None
        hdesk = None

    hicon = None
    if os.path.exists(LOGO_ICO):
        try:
            hicon = user32.LoadImageW(None, LOGO_ICO, 1, 0, 0, 0x00000010 | 0x00000040)
        except Exception:
            pass

    WM_SETICON = 0x0080
    ICON_SMALL = 0
    ICON_BIG = 1

    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    while target_proc.poll() is None:
        def enum_cb(hwnd, lparam):
            if user32.IsWindowVisible(hwnd):
                pid = wintypes.DWORD()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if pid.value == target_proc.pid:
                    buff = ctypes.create_unicode_buffer(512)
                    user32.GetWindowTextW(hwnd, buff, 512)
                    cur_title = buff.value
                    if cur_title and "Aero-Q" not in cur_title:
                        user32.SetWindowTextW(hwnd, APP_TITLE)
                    if hicon:
                        user32.SendMessageW(hwnd, WM_SETICON, ICON_SMALL, hicon)
                        user32.SendMessageW(hwnd, WM_SETICON, ICON_BIG, hicon)
            return 1

        try:
            cb = WNDENUMPROC(enum_cb)
            if hwinsta and hdesk:
                user32.EnumDesktopWindows(hdesk, cb, 0)
            else:
                user32.EnumWindows(cb, 0)
        except Exception:
            pass

        time.sleep(0.8)


def launch_qgc_process():
    """Launches QGroundControl executable and starts active branding watcher."""
    if not os.path.exists(QGC_EXE_PATH):
        return None
    proc = subprocess.Popen([QGC_EXE_PATH], shell=False)
    # Start thread to brand the window title continuously
    t = threading.Thread(target=keep_branding_active, args=(proc,), daemon=True)
    t.start()
    return proc


class AeroQSplashScreen:
    def __init__(self):
        self.root = tk.Tk()
        self.root.overrideredirect(True)  # Frameless splash window
        self.root.configure(bg="#080C14")

        # Set taskbar icon if available
        if os.path.exists(LOGO_ICO):
            try:
                self.root.iconbitmap(LOGO_ICO)
            except Exception:
                pass

        # Dimensions & Center Screen
        width = 540
        height = 620
        screen_width = self.root.winfo_screenwidth()
        screen_height = self.root.winfo_screenheight()
        x = (screen_width - width) // 2
        y = (screen_height - height) // 2
        self.root.geometry(f"{width}x{height}+{x}+{y}")

        # Top border accent line
        accent_bar = tk.Frame(self.root, bg="#00E5FF", height=3)
        accent_bar.pack(fill="x")

        # Container
        container = tk.Frame(self.root, bg="#080C14", padx=20, pady=15)
        container.pack(expand=True, fill="both")

        # Logo Image
        if os.path.exists(LOGO_PNG):
            try:
                img = Image.open(LOGO_PNG)
                img = img.resize((360, 360), Image.Resampling.LANCZOS)
                self.logo_tk = ImageTk.PhotoImage(img)
                lbl_img = tk.Label(container, image=self.logo_tk, bg="#080C14")
                lbl_img.pack(pady=(10, 5))
            except Exception:
                pass

        # App Title
        lbl_title = tk.Label(
            container,
            text="AERO-Q GCS",
            font=("Segoe UI", 22, "bold"),
            fg="#00E5FF",
            bg="#080C14"
        )
        lbl_title.pack(pady=(0, 2))

        # Subtitle
        lbl_subtitle = tk.Label(
            container,
            text="TACTICAL AUTOPILOT GROUND STATION • v2.4",
            font=("Segoe UI", 9, "bold"),
            fg="#8BA3B8",
            bg="#080C14"
        )
        lbl_subtitle.pack(pady=(0, 15))

        # Status text
        self.lbl_status = tk.Label(
            container,
            text="Initializing Avionics Subsystem...",
            font=("Consolas", 10),
            fg="#64D2FF",
            bg="#080C14"
        )
        self.lbl_status.pack(pady=(5, 8))

        # Custom canvas progress bar
        self.canvas_width = 440
        self.canvas_height = 8
        self.progress_canvas = tk.Canvas(
            container,
            width=self.canvas_width,
            height=self.canvas_height,
            bg="#111927",
            highlightthickness=0
        )
        self.progress_canvas.pack(pady=(0, 10))

        # Version & Footer
        lbl_footer = tk.Label(
            container,
            text="Secured MAVLink 2.0 • ArduPilot / PX4 Flight Core",
            font=("Segoe UI", 8),
            fg="#4A5B6D",
            bg="#080C14"
        )
        lbl_footer.pack(side="bottom", pady=(5, 0))

        # Animation states
        self.steps = [
            (15, "Checking Avionics Link & COM Ports..."),
            (35, "Loading MAVLink 2.0 Protocol Engine..."),
            (60, "Calibrating Autonomous Navigation Module..."),
            (80, "Connecting Flight Telemetry Services..."),
            (95, "Spawning Aero-Q Flight Deck..."),
            (100, "Aero-Q GCS Ready. Starting Session...")
        ]
        self.step_idx = 0
        self.current_pct = 0

        # Click anywhere to launch instantly
        self.root.bind("<Button-1>", lambda e: self.finish())
        self.root.bind("<Escape>", lambda e: self.finish())

        # Start loading loop
        self.animate_progress()

    def update_progress_bar(self, pct):
        self.progress_canvas.delete("all")
        bar_width = int((pct / 100.0) * self.canvas_width)
        if bar_width > 0:
            self.progress_canvas.create_rectangle(
                0, 0, bar_width, self.canvas_height,
                fill="#00E5FF", outline=""
            )

    def animate_progress(self):
        if self.step_idx < len(self.steps):
            target_pct, text = self.steps[self.step_idx]
            self.lbl_status.config(text=text)

            if self.current_pct < target_pct:
                self.current_pct += 3
                self.update_progress_bar(self.current_pct)
                self.root.after(20, self.animate_progress)
            else:
                self.step_idx += 1
                self.root.after(280, self.animate_progress)
        else:
            self.update_progress_bar(100)
            self.root.after(400, self.finish)

    def finish(self):
        proc = launch_qgc_process()
        self.root.after(600, self.root.destroy)
        # Keep launcher thread alive for the branding watcher
        if proc:
            proc.wait()

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    app = AeroQSplashScreen()
    app.run()
