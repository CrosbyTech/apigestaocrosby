@echo off
:: Roda uma execucao agora, com a janela do Chrome visivel (bom para testar)
cd /d "%~dp0"
node bot.mjs --agora --visivel %*
pause
