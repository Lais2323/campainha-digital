@echo off
title Enviar Campainha Digital para o GitHub
chcp 65001 > nul
set "PATH=C:\Program Files\Git\bin;%PATH%"
cd /d "%~dp0"

echo ================================================================
echo   🔔 ENVIAR CAMPAINHA DIGITAL PARA O SEU GITHUB
echo ================================================================
echo.
echo [1/3] Abrindo a página de criação de repositório no seu navegador...
start https://github.com/new
echo.
echo ----------------------------------------------------------------
echo   NA PÁGINA QUE SE ABRIU NO SEU NAVEGADOR:
echo   1. Em "Repository name", digite: campainha-digital
echo   2. Marque a opção "Public"
echo   3. Clique no botão verde "Create repository" no final da página
echo ----------------------------------------------------------------
echo.
echo [2/3] Após criar o repositório, o GitHub vai mostrar um link HTTPS
echo       (Exemplo: https://github.com/SEU_USUARIO/campainha-digital.git)
echo.
set /p REPO_URL="Cole o link do seu repositório aqui e aperte ENTER: "

if "%REPO_URL%"=="" (
    echo.
    echo ❌ Nenhum link foi inserido. Tente executar o arquivo novamente.
    pause
    exit /b
)

echo.
echo [3/3] Enviando os arquivos para o seu GitHub...
git remote remove origin > nul 2>&1
git remote add origin %REPO_URL%
git branch -M main
git push -u origin main

if %ERRORLEVEL% equ 0 (
    echo.
    echo ================================================================
    echo   ✅ SUCESSO! SEU PROJETO JÁ ESTÁ NO GITHUB!
    echo ================================================================
    echo.
    echo Abrindo o Render.com no seu navegador para conectar o projeto...
    start https://dashboard.render.com/select-repo?type=web
    echo.
    echo No Render, basta clicar em "Connect" ao lado de 'campainha-digital'!
) else (
    echo.
    echo ⚠️ Se o Git pediu login na tela, faça a autorização no navegador e tente novamente.
)

echo ================================================================
pause
