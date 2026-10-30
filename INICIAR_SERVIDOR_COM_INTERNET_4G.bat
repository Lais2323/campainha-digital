@echo off
title Campainha Digital (Servidor + Tunnel 4G/5G)
chcp 65001 > nul
cd /d "%~dp0server"
echo ===================================================
echo   🔔 INICIANDO SERVIDOR COM TÚNEL PÚBLICO HTTPS
echo ===================================================
echo Iniciando servidor local na porta 3000...
start /b node server.js
timeout /t 2 > nul
echo Criando conexao segura HTTPS na nuvem...
node tunnel.js
pause
