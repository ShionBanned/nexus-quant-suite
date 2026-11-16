# ==============================================================================
# INSTALADOR DE SERVICIO 24/7 EN WINDOWS TASK SCHEDULER
# ==============================================================================

$taskName = "NexusQuantSuite247"
$projectRoot = "C:\Users\gamer\Projects\nexus-quant-suite"
$scriptPath = Join-Path $projectRoot "scripts\nexus_service.ps1"

Write-Host "Configurando Servicio 24/7 para Nexus Quant Suite..." -ForegroundColor Cyan

# 1. Definir Acción 100% Invisible (wscript.exe sin consola de terminal)
$vbsPath = Join-Path $projectRoot "scripts\launch_silent.vbs"
$action = New-ScheduledTaskAction `
    -Execute "wscript.exe" `
    -Argument "`"$vbsPath`"" `
    -WorkingDirectory $projectRoot

# 2. Definir Disparador: Al iniciar sesión el usuario
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# 3. Definir Configuración de Resiliencia 24/7
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([System.TimeSpan]::Zero) `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew `
    -Priority 4

# 4. Definir Principal (Usuario actual interactivo, sin requerir elevación especial de admin)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

# 5. Registrar Tarea
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal | Out-Null

Write-Host "✅ Tarea Programada '$taskName' registrada exitosamente." -ForegroundColor Green
Write-Host "   - Ejecución: 24/7 sin límite de tiempo (ExecutionTimeLimit = 0)"
Write-Host "   - Inicio Automático: Al iniciar Windows"
Write-Host "   - Ventana: Totalmente silenciosa e invisible en segundo plano"
