# Test Python service startup
Write-Host "Testing Python service startup..." -ForegroundColor Cyan

# Change to workers/python directory
Set-Location "D:\Asset-Detection\workers\python"

# Start Python service in background
$job = Start-Job -ScriptBlock {
    Set-Location "D:\Asset-Detection\workers\python"
    python api_service.py 2>&1
}

Write-Host "Waiting for service to start (10 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# Check job output
$output = Receive-Job -Job $job
Write-Host "`nService Output:" -ForegroundColor Green
$output | Select-Object -First 20

# Test health endpoint
Write-Host "`nTesting health endpoint..." -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -Method Get -TimeoutSec 5
    Write-Host "✅ Service is healthy!" -ForegroundColor Green
    Write-Host ($response | ConvertTo-Json) -ForegroundColor White
} catch {
    Write-Host "❌ Health check failed: $_" -ForegroundColor Red
}

# Keep job running or stop?
Write-Host "`nJob Status:" -ForegroundColor Cyan
Get-Job

Write-Host "`nTo stop: Stop-Job -Id $($job.Id); Remove-Job -Id $($job.Id)" -ForegroundColor Yellow
