@echo off
setlocal
title Obsidian Slim Bar Launcher
cd /d "%~dp0"

set "RUNTIME_DIR=%~dp0runtime"
set "ELECTRON_EXE=%RUNTIME_DIR%\electron.exe"
set "ELECTRON_VERSION=v33.2.0"
set "ELECTRON_URL=https://github.com/electron/electron/releases/download/%ELECTRON_VERSION%/electron-%ELECTRON_VERSION%-win32-x64.zip"
set "ZIP_FILE=%~dp0electron-win32.zip"

if not exist "%ELECTRON_EXE%" (
    echo ============================================================
    echo [Obsidian Slim Bar] First-Time Setup (No Node.js Required!)
    echo Downloading lightweight Windows runtime (%ELECTRON_VERSION%)...
    echo ============================================================
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
      "Invoke-WebRequest -Uri '%ELECTRON_URL%' -OutFile '%ZIP_FILE%'; " ^
      "if (Test-Path '%RUNTIME_DIR%') { Remove-Item -Recurse -Force '%RUNTIME_DIR%' }; " ^
      "Expand-Archive -Path '%ZIP_FILE%' -DestinationPath '%RUNTIME_DIR%' -Force; " ^
      "Remove-Item -Force '%ZIP_FILE%'"
)

if not exist "%ELECTRON_EXE%" (
    echo [ERROR] Failed to download runtime. Please check your internet connection.
    pause
    exit /b 1
)

start "" "%ELECTRON_EXE%" "%~dp0."
exit
