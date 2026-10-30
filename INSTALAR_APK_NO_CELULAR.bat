@echo off
title Instalar APK no Celular via ADB
chcp 65001 > nul
cd /d "%~dp0"
echo ===================================================
echo   📱 INSTALADOR DO APK DA CAMPAINHA DIGITAL
echo ===================================================
echo.
echo Verificando celular conectado via USB com Depuração USB ativada...
"C:\Android\sdk\platform-tools\adb.exe" devices
echo.
echo Instalando dist-apk\CampainhaDigital.apk no aparelho...
"C:\Android\sdk\platform-tools\adb.exe" install -r "dist-apk\CampainhaDigital.apk"
if %ERRORLEVEL% equ 0 (
    echo.
    echo ✅ APK instalado com sucesso no seu celular!
) else (
    echo.
    echo ℹ️ Se o celular nao estiver conectado via USB, basta enviar o arquivo
    echo    "dist-apk\CampainhaDigital.apk" para o seu celular via WhatsApp,
    echo    Telegram, Google Drive ou cabo USB e tocar para instalar!
)
pause
