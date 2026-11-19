@echo off
:: Pede a 2a via da Energisa de todas as contas (ou: rodar.bat --loja=2 --sala=101).
cd /d "%~dp0"
node bot.mjs %*
pause
