@echo off
set "PATH=C:\Program Files\Git\bin;C:\Program Files\Git\cmd;%PATH%"
cd /d "C:\Users\Administrator\Desktop\CAMPANHIA DIGITAL QR CODE\campainha-digital"

echo ================================================================
echo   PREPARANDO ARQUIVOS E APK DA CAMPAINHA...
echo ================================================================
git add .
git commit -m "Atualizacao da Campainha Digital e correcoes de seguranca"

echo ================================================================
echo   ENVIANDO ATUALIZACOES DA CAMPAINHA PARA O GITHUB...
echo ================================================================
echo.

git push origin main

echo.
echo ================================================================
echo   CONCLUIDO! O RENDER VAI ATUALIZAR EM 1 MINUTO!
echo ================================================================
echo.
pause
