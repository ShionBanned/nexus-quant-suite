# ==============================================================================
# INICIO DEL SERVICIO 24/7: NEXUS QUANT SUITE
# ==============================================================================

$taskName = "NexusQuantSuite247"
Write-Host "Iniciando servicio 24/7 de Nexus Quant Suite..." -ForegroundColor Cyan

# Asegurarse de que no haya residuos anteriores
$stopScript = "C:\Users\gamer\Projects\nexus-quant-suite\scripts\stop_service.ps1"
& powershell -ExecutionPolicy Bypass -File $stopScript | Out-Null

Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2

# Mostrar estado resultante
$statusScript = "C:\Users\gamer\Projects\nexus-quant-suite\scripts\status_service.ps1"
& powershell -ExecutionPolicy Bypass -File $statusScript
