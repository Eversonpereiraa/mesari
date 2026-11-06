@echo off
rem Cria um atalho do agente na pasta Inicializar do Windows (abre minimizado).
set "ALVO=%~dp0iniciar-agente.bat"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup') + '\Mesari Print Agent.lnk'); $s.TargetPath = $env:ALVO; $s.WorkingDirectory = (Split-Path $env:ALVO); $s.WindowStyle = 7; $s.Save()"
if errorlevel 1 (
  echo Nao foi possivel criar o atalho.
) else (
  echo Pronto: o agente vai abrir sozinho quando o Windows iniciar.
)
pause
