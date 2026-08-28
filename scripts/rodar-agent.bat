@echo off
:: Executa o agente de inventário uma vez (modo de teste / execução manual).
:: Não instala nada. Feche a janela quando terminar.
powershell.exe -ExecutionPolicy Bypass -File "%~dp0inventory-agent.ps1"
echo.
echo Pressione qualquer tecla para fechar...
pause > nul
