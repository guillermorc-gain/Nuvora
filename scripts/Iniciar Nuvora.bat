@echo off
chcp 65001 >nul
title Nuvora
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Nuvora necesita Node.js 22 o superior. Se abre la pagina de descarga...
  start "" "https://nodejs.org/es/download"
  pause
  exit /b 1
)
echo Abriendo Nuvora... Deja esta ventana abierta mientras lo uses.
start "" "http://localhost:3000"
node --disable-warning=ExperimentalWarning server\index.js
pause
