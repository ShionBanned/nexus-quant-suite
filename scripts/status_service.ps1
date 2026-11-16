# ==============================================================================
# MONITOR DE ESTADO EN TIEMPO REAL: NEXUS QUANT SUITE
# ==============================================================================

$projectRoot = "C:\Users\gamer\Projects\nexus-quant-suite"
$pidFile = Join-Path $projectRoot "nexus_service.pid"
$logDir = Join-Path $projectRoot "logs"

Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "🛡️  ESTADO DEL SERVICIO 24/7 - NEXUS QUANT SUITE v2.0" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# 1. Estado de Tarea Programada de Windows
$task = Get-ScheduledTask -TaskName "NexusQuantSuite247" -ErrorAction SilentlyContinue
if ($task) {
    Write-Host "Tarea en Windows Scheduler : $($task.State)" -ForegroundColor Yellow
} else {
    Write-Host "Tarea en Windows Scheduler : NO INSTALADA" -ForegroundColor Red
}

# 2. Estado del Proceso Node
$isRunning = $false
if (Test-Path $pidFile) {
    $procId = (Get-Content -Path $pidFile -Raw).Trim()
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($proc) {
        $isRunning = $true
        $memMB = [math]::Round($proc.WorkingSet64 / 1MB, 1)
        Write-Host "Motor Cuantitativo (Node)  : EN EJECUCION (PID: $($proc.Id), Memoria: $memMB MB)" -ForegroundColor Green
    }
}

if (-not $isRunning) {
    Write-Host "Motor Cuantitativo (Node)  : DETENIDO" -ForegroundColor Red
}

# 3. Estado de Puerto 8080 (Dashboard & WebSocket)
$conn = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    Write-Host "Dashboard HTTP / WebSocket : ACTIVO en http://localhost:8080" -ForegroundColor Green
} else {
    Write-Host "Dashboard HTTP / WebSocket : INACTIVO" -ForegroundColor Red
}

# 4. Estado de Backups en la Nube
$cloudDir = "C:\Users\gamer\OneDrive\NexusQuant_Backups"
if (Test-Path $cloudDir) {
    $latestBackup = Get-ChildItem -Path $cloudDir -Filter "*.db" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestBackup) {
        $bkSize = [math]::Round($latestBackup.Length / 1KB, 1)
        $bkDate = $latestBackup.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
        Write-Host "Ultimo Snapshot en la Nube : $($latestBackup.Name) ($bkSize KB, $bkDate)" -ForegroundColor Green
    } else {
        Write-Host "Snapshots en la Nube       : Carpeta lista, esperando primer ciclo" -ForegroundColor Gray
    }
} else {
    Write-Host "Snapshots en la Nube       : OneDrive no configurado" -ForegroundColor Gray
}

# 5. Últimas líneas de la actividad
Write-Host ""
Write-Host "--- ULTIMAS LINEAS DE LOG (logs/nexus_out.log) ---" -ForegroundColor DarkGray
$outLog = Join-Path $logDir "nexus_out.log"
if (Test-Path $outLog) {
    Get-Content -Path $outLog -Tail 8
} else {
    Write-Host "(Sin registros de salida aun)" -ForegroundColor DarkGray
}

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""
