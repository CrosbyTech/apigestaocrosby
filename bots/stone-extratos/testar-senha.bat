@echo off
:: Aplica a alteracao da senha (se ela tiver sido removida por git stash/checkout),
:: instala o node-jose se faltar e sobe o AGENTE, que processa a fila de inclusoes.
cd /d "%~dp0"

findstr /C:"resolverDesafio" stone.mjs >nul 2>&1
if errorlevel 1 (
  echo Aplicando a alteracao da senha...
  git apply senha-desafio.patch
  if errorlevel 1 (
    echo ERRO: nao consegui aplicar senha-desafio.patch.
    echo Rode: git checkout -- bots/stone-extratos
    echo e depois este arquivo de novo.
    pause
    exit /b 1
  )
)

if not exist "node_modules\node-jose" (
  echo Instalando dependencias ^(node-jose^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo ERRO no npm install.
    pause
    exit /b 1
  )
)

echo.
echo Agente iniciando. Deixe esta janela aberta.
echo No HeadCoach, clique em "tentar de novo" no titulo de teste para enfileirar a inclusao.
echo.
node bot.mjs
pause
