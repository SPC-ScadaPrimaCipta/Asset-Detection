# PowerShell script to test Python service
Write-Host "=" -ForegroundColor Cyan -NoNewline
Write-Host ("=" * 59) -ForegroundColor Cyan
Write-Host " Testing Python Service with ONNX Model" -ForegroundColor Yellow
Write-Host "=" -ForegroundColor Cyan -NoNewline
Write-Host ("=" * 59) -ForegroundColor Cyan
Write-Host ""

# Start service in background
Write-Host "[1/3] Starting Python service..." -ForegroundColor Cyan
$job = Start-Job -ScriptBlock {
    Set-Location "D:\Asset-Detection\workers\python"
    python api_service.py
}

# Wait for service to start
Write-Host "[2/3] Waiting for service startup (5 seconds)..." -ForegroundColor Cyan
Start-Sleep -Seconds 5

# Test health endpoint
Write-Host "[3/3] Testing health endpoint..." -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8765/health" -UseBasicParsing -TimeoutSec 5
    Write-Host ""
    Write-Host "✅ Service is running!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Response:" -ForegroundColor Yellow
    Write-Host $response.Content
    Write-Host ""
} catch {
    Write-Host ""
    Write-Host "❌ Service not responding" -ForegroundColor Red
    Write-Host $_.Exception.Message
    Write-Host ""
}

# Show job status
Write-Host "Service job status:" -ForegroundColor Cyan
Get-Job

Write-Host ""
Write-Host "To stop service: Stop-Job -Id $($job.Id)" -ForegroundColor Yellow
Write-Host ""
