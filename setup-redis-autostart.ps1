# Run this script once as Administrator
# Right-click → Run with PowerShell (as Administrator)

Write-Host "Setting up Redis autostart..." -ForegroundColor Cyan

# Step 1: Remove broken Redis service if exists
$svc = Get-Service -Name "Redis" -ErrorAction SilentlyContinue
if ($svc) {
    Write-Host "Removing broken Redis service..."
    Stop-Service -Name "Redis" -Force -ErrorAction SilentlyContinue
    sc.exe delete Redis | Out-Null
    Start-Sleep -Seconds 1
    Write-Host "  Done." -ForegroundColor Green
}

# Step 2: Create scheduled task to run Redis at startup as SYSTEM
Write-Host "Creating scheduled task for Redis..."

$action   = New-ScheduledTaskAction -Execute "D:\redis-portable\redis-server.exe" -Argument "D:\redis-portable\redis.conf"
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable $true
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName "Redis" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
Write-Host "  Task created." -ForegroundColor Green

# Step 3: Kill any existing Redis process on 6379 and start fresh via task
Write-Host "Starting Redis via scheduled task..."
Start-ScheduledTask -TaskName "Redis"
Start-Sleep -Seconds 2

# Step 4: Verify
try {
    $result = & "D:\redis-portable\redis-cli.exe" ping 2>$null
    if ($result -eq "PONG") {
        Write-Host "Redis is running (PONG)" -ForegroundColor Green
    } else {
        Write-Host "Redis ping: $result"
    }
} catch {
    Write-Host "redis-cli not found, checking port..." -ForegroundColor Yellow
    $conn = Test-NetConnection -ComputerName 127.0.0.1 -Port 6379 -WarningAction SilentlyContinue
    if ($conn.TcpTestSucceeded) {
        Write-Host "Port 6379 is open - Redis running OK" -ForegroundColor Green
    } else {
        Write-Host "Port 6379 not responding - Redis may have failed" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Done. Redis will now auto-start on every Windows boot." -ForegroundColor Cyan
Write-Host "Task name: 'Redis' (visible in Task Scheduler)"
