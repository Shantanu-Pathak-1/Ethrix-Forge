# Ethrix-Forge Local Windows Installer (PowerShell)
# Installs the local cloned repository globally by adding it directly to PATH.

$ErrorActionPreference = "Stop"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "       Ethrix-Forge Local Installer          " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# 1. Verify Python
Write-Host "[*] Verifying Python installation..." -ForegroundColor Yellow
$pythonInstalled = $false
try {
    $pythonVersion = & python --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        $pythonInstalled = $true
        Write-Host "[+] Found Python: $pythonVersion" -ForegroundColor Green
    }
} catch {}

if (-not $pythonInstalled) {
    Write-Error "Python 3 is not found in your PATH."
    exit 1
}

# 2. Configure PATH pointing directly to the local folder
$currentDir = $PSScriptRoot
Write-Host "[*] Registering local directory to system PATH..." -ForegroundColor Yellow
$userPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::User)
if ($userPath -split ';' -notcontains $currentDir) {
    $newUserPath = "$userPath;$currentDir"
    [Environment]::SetEnvironmentVariable("Path", $newUserPath, [EnvironmentVariableTarget]::User)
    Write-Host "[+] Successfully added $currentDir to your User PATH!" -ForegroundColor Green
} else {
    Write-Host "[*] $currentDir is already present in PATH." -ForegroundColor Gray
}

# 3. Install Dependencies
Write-Host "[*] Installing Python dependencies..." -ForegroundColor Yellow
try {
    & python -m pip install -r "$currentDir\backend\requirements.txt" --quiet
    & python -m pip install rich requests fastapi uvicorn --quiet
    Write-Host "[+] Dependencies verified successfully." -ForegroundColor Green
} catch {
    Write-Warning "Some dependencies failed to verify."
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "    Ethrix-Forge Installed Locally!          " -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host "Please restart your terminal to load the new PATH."
Write-Host "To run the CLI: ethrix chat"
Write-Host "=============================================" -ForegroundColor Green
