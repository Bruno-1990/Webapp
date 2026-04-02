@echo off
REM Abre janela CMD persistente e chama o START da raiz webapp
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
if not exist "%ROOT%\START.bat" (
  echo START.bat nao encontrado em: %ROOT%
  pause
  exit /b 1
)
start "Webapp - Central de conversoes" cmd /k call "%ROOT%\START.bat" _RUN
exit /b 0
