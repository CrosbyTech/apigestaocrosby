@echo off
:: Pede a 2a via da CAERN de todas as lojas (ou: rodar.bat --loja=1).
cd /d "%~dp0"
node bot.mjs %*
pause
