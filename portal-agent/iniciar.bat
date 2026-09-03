@echo off
:: Inicia o agente com janela visivel (para ver os logs)
cd /d "%~dp0"
node agent.mjs
pause
