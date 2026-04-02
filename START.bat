@echo off
setlocal EnableExtensions

REM Duplo clique fecha a janela rapido demais: abrimos um CMD novo que permanece aberto (/k)
if /i not "%~1"=="_RUN" (
  cd /d "%~dp0"
  start "Webapp - Central de conversoes" cmd /k call "%~f0" _RUN
  exit /b 0
)

title Webapp - Central de conversoes
cd /d "%~dp0webapp-01"

if not exist "package.json" (
  echo Pasta webapp-01 nao encontrada ou sem package.json.
  echo Coloque START.bat na pasta webapp - ela deve ser a pasta pai de webapp-01.
  pause
  exit /b 1
)

REM Explorer nao herda o PATH do terminal onde o Node foi instalado
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js nao encontrado no PATH.
  echo Instale Node LTS e reinicie o PC, ou abra o CMD pelo menu Iniciar e execute START.bat nesta pasta.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm nao encontrado no PATH.
  pause
  exit /b 1
)

if not exist "temp_jobs\" mkdir "temp_jobs" 2>nul

echo.
echo npm install (links @webapp/* e dependencias; uteis apos mover pastas^)...
call npm install
if errorlevel 1 (
  echo Falha no npm install.
  pause
  exit /b 1
)

where py >nul 2>&1
if not errorlevel 1 goto after_pywarn
where python >nul 2>&1
if not errorlevel 1 goto after_pywarn
echo.
echo [Aviso] Python nao encontrado no PATH. SPED, XLSX-^>SPED e SCI precisam de py/python + pip (webapp-02, webapp-03, webapp-04).
echo.
:after_pywarn

echo.
echo === Subindo stack ===
echo   Frontend: http://localhost:5176   API proxy /api -^> porta 8000
echo.

docker info >nul 2>&1
if errorlevel 1 (
  echo Docker indisponivel - usando npm run dev. Redis em 127.0.0.1:6379
  echo Com Docker: instale Docker Desktop e rode este script de novo.
  echo/
  call npm run dev
) else (
  echo Redis via Docker + API + workers NFe/SPED/merge + Vite...
  call npm run dev:stack
)

if errorlevel 1 (
  echo/
  echo Encerrado com erro. Dicas:
  echo   - Sem Docker: Redis na porta 6379 e na pasta webapp-01: npm run dev
  echo   - Erro de build: npm run build
  pause
)
exit /b %ERRORLEVEL%
