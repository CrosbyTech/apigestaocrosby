@echo off
:: Instala o Agente do Portal RFID para iniciar junto com o Windows
:: Requisito: Node.js instalado (https://nodejs.org - versao LTS)
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo ERRO: Node.js nao encontrado. Instale em https://nodejs.org e rode de novo.
  pause
  exit /b 1
)

set /p PORTALIP="IP do portal desta maquina (ex: 192.168.0.203): "
if "%PORTALIP%"=="" (
  echo IP nao informado — mantendo o config.json atual.
) else (
  > "%~dp0config.json" echo { "portalHost": "%PORTALIP%", "portalPort": 8888, "listenPort": 7070 }
  echo config.json atualizado para %PORTALIP%
)

:: Tarefa agendada: roda o agente no logon do usuario (janela oculta)
schtasks /Create /F /TN "CrosbyPortalRFID" /SC ONLOGON /RL LIMITED ^
  /TR "wscript.exe \"%~dp0iniciar-oculto.vbs\"" >nul
if %errorlevel% neq 0 (
  echo AVISO: nao consegui criar a tarefa agendada. Rode iniciar.bat manualmente.
) else (
  echo Tarefa "CrosbyPortalRFID" criada — o agente inicia junto com o Windows.
)

:: Inicia agora
start "" wscript.exe "%~dp0iniciar-oculto.vbs"
echo.
echo Agente iniciado! Teste: http://127.0.0.1:7070/health
echo Agora abra o HeadCoach ^> Orcamento RFID e clique LIGAR PORTAL.
pause
