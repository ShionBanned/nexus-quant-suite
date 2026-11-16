@echo off
echo ========================================================
echo Mostrando transmision de registros en tiempo real...
echo (Presiona Ctrl+C para salir)
echo ========================================================
powershell -Command "Get-Content 'C:\Users\gamer\Projects\nexus-quant-suite\logs\nexus_out.log' -Tail 40 -Wait"
