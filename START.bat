@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM Duplo clique fecha a janela rapido demais: abrimos um CMD novo que permanece aberto (/k)
if /i not "%~1"=="_RUN" (
  cd /d "%~dp0"
  start "Webapp - Central de conversoes" cmd /k call "%~f0" _RUN
  exit /b 0
)

title Webapp - Central de conversoes

REM .env: NAO precisamos mais carregar aqui no shell. API, workers e docker-compose
REM leem direto do .env da raiz (loadDotenvFromUpwards no Node, env_file no compose).
REM So mostramos uma dica se o arquivo nao existe.
if not exist "%~dp0.env" (
  if exist "%~dp0.env.example" (
    echo.
    echo [Dica] Crie o arquivo  .env  copiando  .env.example  e preencha GEMINI_API_KEY
    echo        para que o Comparador NFS-e processe PDFs escaneados via OCR.
    echo.
  )
)

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
echo npm install ^(links @webapp/* e dependencias; uteis apos mover pastas^)...
call npm install
if errorlevel 1 (
  echo Falha no npm install.
  pause
  exit /b 1
)

REM Detecta Python (py launcher tem prioridade no Windows)
set "PYEXE="
where py >nul 2>&1 && set "PYEXE=py"
if not defined PYEXE (
  where python >nul 2>&1 && set "PYEXE=python"
)

if not defined PYEXE (
  echo.
  echo [Aviso] Python nao encontrado no PATH.
  echo         SPED, XLSX-^>SPED, SCI e Comparador NFS-e precisam de py/python + pip ^(engines/^).
  echo.
  goto :after_python
)

echo.
echo Instalando dependencias Python dos modulos ^(requirements.txt^)...
for %%D in (engines\sped engines\sped-merge engines\sci-consolidado engines\comparacao-planilhas engines\comparacao-nfse) do (
  if exist "..\%%D\requirements.txt" (
    echo   %%D ...
    pushd "..\%%D"
    %PYEXE% -m pip install -q -r requirements.txt
    popd
  )
)

:after_python

echo.
echo === Subindo stack ===
echo   Frontend: http://localhost:5176   API proxy /api -^> porta 8000
echo   Ferramentas: NFe, SPED, XLSX-^>SPED, SCI, Comparador Planilhas, Comparador NFS-e
echo.

docker info >nul 2>&1
if errorlevel 1 (
  echo Docker indisponivel - usando npm run dev. Redis em 127.0.0.1:6381
  echo Com Docker: instale Docker Desktop e rode este script de novo.
  echo.
  call npm run dev
) else (
  echo Redis via Docker + API + workers NFe/SPED/merge + Vite...
  call npm run dev:stack
)

if errorlevel 1 (
  echo.
  echo Encerrado com erro. Dicas:
  echo   - Sem Docker: Redis na porta 6381 e na pasta webapp-01: npm run dev
  echo   - Erro de build: npm run build
  pause
)
exit /b %ERRORLEVEL%
