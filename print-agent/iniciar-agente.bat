@echo off
title Mesari Print Agent
cd /d "%~dp0"
if exist "%~dp0mesari-print-agent.exe" (
  "%~dp0mesari-print-agent.exe"
) else if exist "%~dp0dist\mesari-print-agent.exe" (
  "%~dp0dist\mesari-print-agent.exe"
) else (
  node "%~dp0agent.js"
)
pause
