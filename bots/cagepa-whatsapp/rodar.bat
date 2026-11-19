@echo off
:: Pede a conta de agua da Cagepa de todas as lojas (ou: rodar.bat --loja=2).
cd /d "%~dp0"
node bot.mjs %*
pause
