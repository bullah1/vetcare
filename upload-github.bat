@echo off
title VetCare - Upload to GitHub
cd /d "%~dp0"
where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Git install kora nai. https://git-scm.com/download/win theke install kore abar chalan.
  start https://git-scm.com/download/win
  pause
  exit /b
)
echo.
echo  1. github.com/new e giye ekta NOTUN KHALI repo banan (README add korben na).
echo  2. Repo r link ta ekhane paste korun, jemon: https://github.com/username/vetcare-app.git
echo.
set /p REPO=Repo link: 
if "%REPO%"=="" ( echo Link deya hoy nai. & pause & exit /b )
if not exist ".git" git init
git config user.name >nul 2>nul || git config user.name "VetCare"
git config user.email >nul 2>nul || git config user.email "vetcare@example.com"
git add -A
git commit -m "VetCare Connect Pro - upload" >nul 2>nul
git branch -M main
git remote remove origin >nul 2>nul
git remote add origin %REPO%
echo.
echo  Upload hocche... GitHub login chaile browser e login korun.
git push -u origin main
echo.
if errorlevel 1 ( echo  Upload hoy nai - upore error dekhun. ) else ( echo  Upload shesh! Ekhon Vercel e ei repo Import korte paren. )
pause
