# ==============================================================================
# NEXUS QUANT SUITE v2.0 - 24/7 WINDOWS SUPERVISOR SERVICE
# ==============================================================================

$ErrorActionPreference = "Continue"
$projectRoot = "C:\Users\gamer\Projects\nexus-quant-suite"
Set-Location -Path $projectRoot

# 1. Configuración de Directorio de Logs
$logDir = Join-Path $projectRoot "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$serviceLog = Join-Path $logDir "nexus_service.log"
$maxLogSize = 20MB

function Log-Message([string]$msg) {
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $line = "[$timestamp] $msg"
    Add-Content -Path $serviceLog -Value $line
}

# Rotar log de servicio si supera 20MB
if (Test-Path $serviceLog) {
    $item = Get-Item $serviceLog
    if ($item.Length -gt $maxLogSize) {
        $backupLog = Join-Path $logDir "nexus_service_old.log"
        Move-Item -Path $serviceLog -Destination $backupLog -Force
    }
}

Log-Message "=========================================================="
Log-Message "🛡️ INICIANDO SERVICIO RESILIENTE 24/7: NEXUS QUANT SUITE"
Log-Message "=========================================================="

# 2. Compilar bundle de la interfaz UI
Log-Message "Compilando Dashboard UI bundle en public/dashboard.js..."
& npm run build:ui 2>&1 | Out-Null

$nodeExe = (Get-Command node).Source
$tsxCli = Join-Path $projectRoot "node_modules\tsx\dist\cli.mjs"
$entryPoint = Join-Path $projectRoot "src\index.ts"

$env:PORT = "8080"
$env:DATA_SOURCE = "SIMULATED"
$env:NODE_ENV = "production"

# Archivo PID para control y parada limpia
$pidFile = Join-Path $projectRoot "nexus_service.pid"

# 3. Bucle Infinito de Supervisión con Recuperación Automática (Self-Healing)
while ($true) {
    Log-Message "Iniciando motor cuantitativo Nexus Quant (Node $nodeExe)..."
    
    $proc = Start-Process -FilePath $nodeExe -ArgumentList "`"$tsxCli`" `"$entryPoint`"" `
                          -WorkingDirectory $projectRoot `
                          -RedirectStandardOutput (Join-Path $logDir "nexus_out.log") `
                          -RedirectStandardError (Join-Path $logDir "nexus_error.log") `
                          -NoNewWindow -PassThru

    Set-Content -Path $pidFile -Value $proc.Id -Force
    Log-Message "✅ Motor en ejecución bajo PID: $($proc.Id)"

    # Monitorear proceso con Watchdog Activo de Salud en puerto 8080
    $failedChecks = 0
    Start-Sleep -Seconds 4 # Gracia inicial de arranque
    while (-not $proc.WaitForExit(5000)) {
        try {
            $tcp = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
            if (-not $tcp) {
                $failedChecks++
                if ($failedChecks -ge 4) {
                    Log-Message "🚨 WATCHDOG: El motor (PID $($proc.Id)) no escucha en puerto 8080. Reiniciando proceso..."
                    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                    break
                }
            } else {
                $failedChecks = 0
            }
        } catch {
            # Ignorar errores transitorios de consulta TCP
        }
    }
    $exitCode = $proc.ExitCode

    Log-Message "⚠️ El motor finalizó con código de salida: $exitCode"
    if (Test-Path $pidFile) {
        Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
    }

    Log-Message "Reiniciando automáticamente en 3 segundos..."
    Start-Sleep -Seconds 3
}
