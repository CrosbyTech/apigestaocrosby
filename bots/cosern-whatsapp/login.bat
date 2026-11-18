@echo off
:: Abre o WhatsApp Web do bot para ler o QR code com o celular da CONTAS A PAGAR.
cd /d "%~dp0"
node bot.mjs --login
pause
