# Starts the API (with reload) and the Vite dev server together. Ctrl+C stops both.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File webapp\run_dev.ps1
$root = Split-Path -Parent $PSScriptRoot
$web = Join-Path $PSScriptRoot "web"

if (-not (Test-Path (Join-Path $web "node_modules"))) {
    Push-Location $web; npm install; Pop-Location
}

$api = Start-Process python -ArgumentList "-m", "uvicorn", "webapp.api.main:app", "--reload", "--port", "8000" `
    -WorkingDirectory $root -NoNewWindow -PassThru
try {
    Write-Host "API on http://localhost:8000, app on http://localhost:5173"
    Push-Location $web
    npx vite --port 5173 --open
}
finally {
    Pop-Location
    if (-not $api.HasExited) { Stop-Process -Id $api.Id -Force -Confirm:$false }
}
