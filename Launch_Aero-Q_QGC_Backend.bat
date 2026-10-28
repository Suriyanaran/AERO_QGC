@echo off
title Aero-Q Tactical GCS with QGroundControl Backend
echo =====================================================================
echo  Starting Aero-Q GCS with QGroundControl Backend
echo =====================================================================
echo.

:: 1. Launch QGroundControl if installed and not already running
tasklist /FI "IMAGENAME eq QGroundControl.exe" 2>NUL | find /I /N "QGroundControl.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo [OK] QGroundControl is already running in background.
) else (
    if exist "C:\Program Files\QGroundControl\bin\QGroundControl.exe" (
        echo [INFO] Launching QGroundControl backend engine...
        start "" /min "C:\Program Files\QGroundControl\bin\QGroundControl.exe"
    ) else if exist "C:\Program Files\QGroundControl\QGroundControl.exe" (
        echo [INFO] Launching QGroundControl backend engine...
        start "" /min "C:\Program Files\QGroundControl\QGroundControl.exe"
    ) else (
        echo [WARN] QGroundControl.exe not found at standard path. Continuing with Aero-Q...
    )
)

:: 2. Launch Aero-Q Tactical GCS UI & Core
echo [INFO] Starting Aero-Q UI & MAVLink Bridge...
cd /d "%~dp0"
start "" "C:\Windows\System32\wscript.exe" "%~dp0run_aero_q.vbs"

echo.
echo =====================================================================
echo  Ready! Aero-Q GCS UI is now linked to QGroundControl backend.
echo  Connect your drone via USB/Radio to QGC; telemetry flows to Aero-Q!
echo =====================================================================
timeout /t 3 >NUL
exit
