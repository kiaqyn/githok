@echo off
cd /d "%~dp0"
if "%PORT%"=="" set "PORT=4317"
powershell -NoProfile -Command "try{$p=$env:PORT;$r=Invoke-RestMethod \"http://127.0.0.1:$p/api/health\" -TimeoutSec 1;if($r.app -eq 'githok'){Start-Process \"http://127.0.0.1:$p\";exit 0}}catch{};exit 1"
if %errorlevel%==0 exit /b 0
node server.mjs --open
pause
