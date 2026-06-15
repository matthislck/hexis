# Start hexis in development mode
# Run both the Python backend and the Tauri dev server

$ErrorActionPreference = "Stop"

Write-Host "Starting Hexis (dev mode)..." -ForegroundColor Cyan

# Start Python backend in background
$backendJob = Start-Job -ScriptBlock {
    Set-Location "$using:PSScriptRoot\backend"
    python -m uvicorn main:app --host 127.0.0.1 --port 7799 --reload
}

Write-Host "Backend started (job id $($backendJob.Id))" -ForegroundColor Green
Write-Host "Waiting 2s for backend to be ready..." -ForegroundColor DarkGray
Start-Sleep -Seconds 2

# Start Tauri dev (foreground)
Set-Location $PSScriptRoot
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
npm run tauri dev

# Cleanup on exit
Stop-Job $backendJob | Out-Null
Remove-Job $backendJob | Out-Null
