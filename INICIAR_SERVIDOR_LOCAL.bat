@echo off
title Servidor Campainha Digital
chcp 65001 > nul
cd /d "%~dp0server"
echo ===================================================
echo   🔔 INICIANDO SERVIDOR DA CAMPAINHA DIGITAL
echo ===================================================
echo.
node server.js
pause
