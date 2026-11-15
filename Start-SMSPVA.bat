@echo off
if /I "%~1"=="-CheckOnly" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-SMSPVA.ps1" %*
  exit /b %errorlevel%
)
start "" wscript.exe //B //Nologo "%~dp0Start-SMSPVA.vbs"
exit /b 0
