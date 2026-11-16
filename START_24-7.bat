@echo off
title Nexus Quant Suite - Iniciando Servicio 24/7
powershell -ExecutionPolicy Bypass -File "C:\Users\gamer\Projects\nexus-quant-suite\scripts\start_service.ps1"
echo ========================================================
echo ✅ Servicio 24/7 activo en segundo plano (0 ventanas permanentes).
echo Esta ventana se cerrara automaticamente en 4 segundos...
echo ========================================================
timeout /t 4 >nul
exit
