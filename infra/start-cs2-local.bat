@echo off
rem CS2 dedicated server from the Steam install on Windows, for `make up CS2=local` (GG-Core in WSL / Docker).
rem The RCON password and the logs token come from .env (created by the first `make`): nothing to edit.
rem Another Steam folder: set CS2_DIR=<...\game\bin\win64> before launching.
setlocal EnableDelayedExpansion
title CS2 dedicated server (GG-Core, CS2=local)

if not defined CS2_DIR set "CS2_DIR=C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive\game\bin\win64"
if not exist "%CS2_DIR%\cs2.exe" (
    echo [ERREUR] cs2.exe introuvable dans %CS2_DIR% ^(set CS2_DIR=...^)
    pause
    exit /b 1
)

set "ENV_FILE=%~dp0..\.env"
if not exist "%ENV_FILE%" (
    echo [ERREUR] %ENV_FILE% introuvable : lancer d'abord "make up CS2=local" dans WSL ^(il cree les secrets^)
    pause
    exit /b 1
)
for /f "usebackq tokens=1,* delims==" %%a in ("%ENV_FILE%") do (
    if "%%a"=="GG_RCON_PASSWORD" set "RCON=%%b"
    if "%%a"=="GG_LOGS_TOKEN" set "TOKEN=%%b"
)
if not defined RCON (echo [ERREUR] GG_RCON_PASSWORD absent de .env & pause & exit /b 1)
if not defined TOKEN (echo [ERREUR] GG_LOGS_TOKEN absent de .env & pause & exit /b 1)

echo ========================================================
echo   GG-Core - serveur CS2 local
echo ========================================================
echo Jeu / RCON : port 27015 ^(l'agent le joint depuis WSL^)
echo Logs       : http://127.0.0.1:8082/logs ^(agent srv-a^)
echo Rejoindre  : connect 127.0.0.1:27015
echo ========================================================

cd /d "%CS2_DIR%"
rem No -ip 127.0.0.1: the agent runs in WSL (Docker) and reaches this machine through the WSL gateway, not localhost
cs2.exe -dedicated -console -usercon -port 27015 -allow_round_backup_files +sv_lan 1 +game_type 0 +game_mode 1 +mapgroup mg_active +map de_inferno +rcon_password "!RCON!" +log on +mp_logdetail 3 +logaddress_add_http "http://127.0.0.1:8082/logs?token=!TOKEN!"
