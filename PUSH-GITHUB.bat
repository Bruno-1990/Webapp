@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

title Git add commit push

if /i "%~1"=="--help" goto :help
if /i "%~1"=="-h" goto :help
if "%~1"=="/?" goto :help

set "SYNC_REMOTE=0"

:parse_flags
if /i "%~1"=="--sync" set "SYNC_REMOTE=1"& shift& goto parse_flags

set "MSG="
:build_msg
if "%~1"=="" goto msg_done
if defined MSG (set "MSG=!MSG! %~1") else set "MSG=%~1"
shift
goto build_msg
:msg_done

where git >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Git nao encontrado no PATH. Instale o Git for Windows.
  pause
  exit /b 1
)

if not exist ".git\" (
  echo [ERRO] Pasta .git nao encontrada nesta raiz.
  if exist "webapp-01\.git\" (
    echo Dica: use a pasta raiz onde esta o .git, nao so webapp-01.
  )
  pause
  exit /b 1
)

for /f %%i in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%i"
if not defined BRANCH set "BRANCH=main"

for /f "delims=" %%u in ('git remote get-url origin 2^>nul') do set "REMOTE_URL=%%u"
if not defined REMOTE_URL (
  echo [ERRO] Remote "origin" nao configurado. Ex.: git remote add origin https://github.com/usuario/repo.git
  pause
  exit /b 1
)

echo.
echo  Raiz:    %CD%
echo  Branch:  !BRANCH!
echo  Remote:  !REMOTE_URL!
echo.

git status --short 2>nul
echo.

git status 2>nul | findstr /i /c:"modified content" /c:"new commits" >nul
if not errorlevel 1 (
  echo [AVISO] Submodulo ou referencia desatualizada. Veja: git status
  echo.
)

echo == git add -A ==
git add -A
if errorlevel 1 (
  echo [ERRO] git add falhou.
  pause
  exit /b 1
)

git diff --cached --quiet
if not errorlevel 1 (
  echo [INFO] Nada novo para commitar. Segue para push dos commits ja locais.
  echo.
  goto before_push
)

echo.
git status --short
echo.

if not defined MSG (
  set /p "MSG=Mensagem do commit: "
)
if "!MSG!"=="" set "MSG=chore: atualizacao"

echo == git commit ==
git commit -m "!MSG!"
if errorlevel 1 (
  echo [ERRO] Commit cancelado ou falhou.
  pause
  exit /b 1
)

:before_push
if "!SYNC_REMOTE!"=="0" goto do_push

set "DID_STASH=0"
git status --porcelain 2>nul | findstr /r "." >nul
if errorlevel 1 goto after_stash
echo [INFO] Guardando alteracoes locais em stash antes do rebase...
git stash push -u -m "PUSH-GITHUB auto"
if errorlevel 1 (
  echo [ERRO] git stash falhou. Resolva com git status e tente de novo.
  pause
  exit /b 1
)
set "DID_STASH=1"
:after_stash

echo == git fetch origin ==
git fetch origin
if errorlevel 1 (
  echo [AVISO] fetch falhou. Tentando push mesmo assim...
  echo.
  goto do_push
)

git rev-parse --verify "origin/!BRANCH!" >nul 2>&1
if errorlevel 1 (
  echo [INFO] Sem origin/!BRANCH! no remoto - pulando rebase.
  echo.
) else (
  echo == git rebase origin/!BRANCH! ==
  git rebase "origin/!BRANCH!"
  if errorlevel 1 (
    echo.
    echo [ERRO] Rebase interrompido. Resolva conflitos ou: git rebase --abort
    if "!DID_STASH!"=="1" echo Stash: git stash list
    pause
    exit /b 1
  )
  echo.
)

:do_push
echo.
echo == git push -u origin !BRANCH! ==
git push -u origin "!BRANCH!"
if errorlevel 1 (
  echo [ERRO] Push falhou. Verifique rede e credenciais.
  if "!DID_STASH!"=="1" echo [INFO] Alteracoes podem estar em stash: git stash list
  pause
  exit /b 1
)

if "!DID_STASH!"=="1" (
  echo.
  echo == git stash pop ==
  git stash pop
  if errorlevel 1 echo [AVISO] Revise git status apos stash pop.
  echo.
)

echo.
echo [OK] Concluido: add, commit quando houve mudancas, push na branch !BRANCH!.
pause
exit /b 0

:help
echo.
echo  PUSH-GITHUB.bat - git add -A, commit com mensagem, push para origin
echo.
echo  Fluxo:
echo    1. git add -A
echo    2. Se houver algo no stage: pede mensagem (ou use argumentos na linha de comando^)
echo    3. git commit -m "..."
echo    4. git push -u origin BRANCH
echo.
echo  Opcional: --sync antes do passo 4 faz fetch + rebase em origin/BRANCH.
echo.
echo  Uso:
echo    PUSH-GITHUB.bat [opcoes] [mensagem do commit...]
echo.
echo  Exemplos:
echo    PUSH-GITHUB.bat
echo    PUSH-GITHUB.bat feat: ajuste no hub
echo    PUSH-GITHUB.bat --sync fix: correcao menor
echo.
echo  Sem mensagem na linha de comando, o script pergunta ao rodar.
echo.
pause
exit /b 0
