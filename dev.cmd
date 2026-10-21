@echo off
REM Atalho do dev.ps1 (duplo clique ou "dev.cmd"). Aceita os mesmos parametros: dev.cmd -SemPainel
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*
