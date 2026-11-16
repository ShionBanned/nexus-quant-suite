@echo off
title Nexus Quant Suite - Deteniendo Servicio 24/7
powershell -ExecutionPolicy Bypass -File "C:\Users\gamer\Projects\nexus-quant-suite\scripts\stop_service.ps1"
echo ========================================================
echo ✅ Servicio detenido.
echo Esta ventana se cerrara automaticamente en 3 segundos...
echo ========================================================
timeout /t 3 >nul
exit
