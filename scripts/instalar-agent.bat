@echo off
:: Instala o agente de inventário como tarefa agendada do Windows.
:: REQUER execucao como Administrador.
:: Copia o script para C:\ProgramData\InventarioBitrix\ e agenda execucao
:: ao iniciar o PC + a cada 6 horas.

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERRO: Execute este arquivo como Administrador.
    echo Clique com o botao direito > "Executar como administrador"
    pause
    exit /b 1
)

powershell.exe -ExecutionPolicy Bypass -File "%~dp0inventory-agent.ps1" -Install
echo.
if %errorLevel% equ 0 (
    echo Instalacao concluida com sucesso.
) else (
    echo Houve um erro durante a instalacao. Veja a mensagem acima.
)
echo.
pause
