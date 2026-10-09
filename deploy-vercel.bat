@echo off
title VetCare - Deploy to Vercel
cd /d "%~dp0"
echo.
echo  VetCare Vercel e upload hocche...
echo  Prothom bar: browser e Vercel login korte bolbe, login kore ei window e fire ashun.
echo  Prosno korle shudhu Enter chapun (default ans).
echo.
for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do set "%%a=%%~b"
call npx --yes vercel@latest deploy --prod -e SUPABASE_URL=%SUPABASE_URL% -e SUPABASE_PUBLISHABLE_KEY=%SUPABASE_PUBLISHABLE_KEY%
echo.
echo  Shesh. Upore "Production:" er pashe je link ache, oita apnar site.
pause
