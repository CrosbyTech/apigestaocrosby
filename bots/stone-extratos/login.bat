@echo off
:: Abre o Chrome do bot para voce logar na Stone (usuario, senha e token).
:: A sessao fica guardada em perfil-chrome\ e o agente reaproveita.
cd /d "%~dp0"
node bot.mjs --login
pause
