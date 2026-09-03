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

:: Inicializacao automatica: atalho na pasta Startup do usuario (sem admin)
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%STARTUP%\CrosbyPortalRFID.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%~dp0iniciar-oculto.vbs\"'; $s.WorkingDirectory='%~dp0'; $s.Save()"
if exist "%STARTUP%\CrosbyPortalRFID.lnk" (
  echo Atalho criado na pasta Startup — o agente inicia junto com o Windows.
) else (
  echo AVISO: nao consegui criar o atalho de inicializacao. Rode iniciar.bat manualmente.
)

:: Inicia agora e CONFERE se subiu de verdade
start "" wscript.exe "%~dp0iniciar-oculto.vbs"
echo Aguardando o agente subir...
powershell -NoProfile -Command "Start-Sleep 3; try { $r = Invoke-RestMethod 'http://127.0.0.1:7070/health' -TimeoutSec 5; Write-Host ''; Write-Host ('AGENTE FUNCIONANDO! Portal configurado: ' + $r.data.portalHost) -ForegroundColor Green; Write-Host 'Abra o HeadCoach > Orcamento RFID e clique LIGAR PORTAL.' } catch { Write-Host ''; Write-Host 'ERRO: o agente NAO subiu.' -ForegroundColor Red; Write-Host 'Rode iniciar.bat (nesta pasta) para ver a mensagem de erro.'; Write-Host 'Causas comuns: Node.js muito antigo (instale o LTS de nodejs.org)' }"
echo.
pause
