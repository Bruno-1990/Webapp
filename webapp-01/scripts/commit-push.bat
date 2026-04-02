@echo off
setlocal
cd /d "%~dp0.."

if "%~1"=="" (
  echo Uso: commit-push.bat "mensagem do commit"
  exit /b 1
)

git add -A
git commit -m "%~1"
git push origin HEAD

endlocal
