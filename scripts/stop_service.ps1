# ==============================================================================
# DETENCIÓN DEL SERVICIO 24/7: NEXUS QUANT SUITE
# ==============================================================================

$taskName = "NexusQuantSuite247"
$projectRoot = "C:\Users\gamer\Projects\nexus-quant-suite"
$pidFile = Join-Path $projectRoot "nexus_service.pid"

Write-Host "Deteniendo servicio 24/7..." -ForegroundColor Yellow

# 1. Detener Tarea Programada
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

# 2. Terminar proceso de Node asociado y su árbol completo de procesos (/T)
if (Test-Path $pidFile) {
    $procId = (Get-Content -Path $pidFile -Raw).Trim()
    if ($procId) {
        Write-Host "Terminando árbol de procesos de Node (PID: $procId)..."
        & taskkill /PID $procId /T /F 2>&1 | Out-Null
    }
    Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
}

# 3. Terminar cualquier proceso residual escuchando en el puerto 8080
$conns = @(Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue)
foreach ($c in $conns) {
    if ($c.OwningProcess -and $c.OwningProcess -gt 0) {
        Write-Host "Liberando puerto 8080 (PID: $($c.OwningProcess))..."
        & taskkill /PID $c.OwningProcess /T /F 2>&1 | Out-Null
    }
}

# 4. Terminar cualquier PowerShell supervisor huérfano de nexus_service
Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like "*nexus_service.ps1*" } | ForEach-Object {
    & taskkill /PID $_.ProcessId /T /F 2>&1 | Out-Null
}

Write-Host "✅ Servicio Nexus Quant Suite detenido limpiamente." -ForegroundColor Green
