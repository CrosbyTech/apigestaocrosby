@echo off
:: Abre a Agencia Virtual da Neoenergia num Chrome so do bot. Voce faz o login
:: (documento, senha e captcha) e navega ate as faturas; o bot grava em mapa\
:: as chamadas que o portal faz. Feche o Chrome quando terminar.
cd /d "%~dp0"
node mapear.mjs
pause
