@echo off
:: Instala o Bot Stone Extratos neste PC (Node.js LTS obrigatorio: https://nodejs.org)
cd /d "%~dp0"
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo ERRO: Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e rode de novo.
  pause
  exit /b 1
)

if not exist config.json (
  copy config.example.json config.json >nul
  echo Criei o config.json. ABRA ele no Bloco de Notas e cole o STONE_BOT_TOKEN (mesmo valor do Render) no campo "token".
)

echo Instalando dependencias (puppeteer baixa um Chrome proprio, ~150 MB)...
call npm install --no-audit --no-fund
if %errorlevel% neq 0 (
  echo ERRO no npm install. Veja a mensagem acima.
  pause
  exit /b 1
)

:: Inicializacao automatica: atalho na pasta Startup do usuario (sem admin)
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%STARTUP%\CrosbyBotStone.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%~dp0iniciar-oculto.vbs\"'; $s.WorkingDirectory='%~dp0'; $s.Save()"
if exist "%STARTUP%\CrosbyBotStone.lnk" (
  echo Atalho criado na pasta Startup: o agente inicia junto com o Windows.
) else (
  echo AVISO: nao consegui criar o atalho de inicializacao. Rode iniciar.bat manualmente.
)

echo.
echo PROXIMOS PASSOS:
echo   1. Confira o "token" no config.json
echo   2. Rode login.bat e faca o login na Stone (uma vez; a sessao fica guardada)
echo   3. Rode iniciar.bat (ou reinicie o PC) para deixar o agente ligado
echo   4. No HeadCoach: Financeiro ^> Extrato Bancario ^> aba "Bot Stone" ^> Baixar extratos agora
echo.
pause
