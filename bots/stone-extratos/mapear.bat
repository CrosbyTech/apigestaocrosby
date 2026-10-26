@echo off
:: Abre o portal logado e grava em mapa\ o que ele chama (API) e os botoes da tela.
:: Use quando o roteiro de PDF (config.json > pdf.passos) parar de funcionar.
cd /d "%~dp0"
node bot.mjs --mapear
pause
