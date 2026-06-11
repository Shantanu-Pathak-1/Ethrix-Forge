# Ethrix-Forge Windows Installer (PowerShell)
# Installs Ethrix-Forge globally under $HOME\.ethrix-forge and adds it to PATH.

$ErrorActionPreference = "Stop"

# 1. Welcome Screen
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "       Ethrix-Forge CLI Installer            " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# 2. Prerequisites Verification
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
    Write-Error "Python 3 is not found in your PATH. Please install Python from https://python.org and ensure 'Add Python to PATH' is checked during installation."
    exit 1
}

# 3. Setup Target Directory
$installDir = "$HOME\.ethrix-forge"
if (Test-Path $installDir) {
    Write-Host "[*] Existing installation found at $installDir. Overwriting..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $installDir
}
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

# 4. Download Zip from GitHub
$zipUrl = "https://github.com/Shantanu-Pathak-1/Ethrix-Forge/archive/refs/heads/master.zip"
$zipPath = "$env:TEMP\ethrix-forge.zip"

Write-Host "[*] Downloading Ethrix-Forge codebase from GitHub..." -ForegroundColor Yellow
try {
    # Ensure TLS 1.2/1.3 is enabled
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 -bor [System.Net.SecurityProtocolType]::Tls13
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
} catch {
    Write-Error "Failed to download codebase from GitHub: $_"
    exit 1
}

# 5. Extract Files
Write-Host "[*] Extracting files..." -ForegroundColor Yellow
$extractTemp = "$env:TEMP\ethrix-temp"
if (Test-Path $extractTemp) {
    Remove-Item -Recurse -Force $extractTemp
}
New-Item -ItemType Directory -Force -Path $extractTemp | Out-Null

try {
    Expand-Archive -Path $zipPath -DestinationPath $extractTemp -Force
    $subFolder = Get-ChildItem -Path $extractTemp -Directory | Select-Object -First 1
    
    # Copy all items including hidden ones to the install directory
    Copy-Item -Path "$($subFolder.FullName)\*" -Destination $installDir -Recurse -Force
} catch {
    Write-Error "Failed to extract archive: $_"
    exit 1
} finally {
    # Cleanup temp files
    if (Test-Path $zipPath) { Remove-Item -Path $zipPath -Force }
    if (Test-Path $extractTemp) { Remove-Item -Recurse -Force $extractTemp }
}

# 6. Install Dependencies
Write-Host "[*] Installing Python dependencies..." -ForegroundColor Yellow
try {
    # Upgrade pip first
    & python -m pip install --upgrade pip --quiet
    # Install from requirements
    & python -m pip install -r "$installDir\backend\requirements.txt"
    # Ensure client packages are installed
    & python -m pip install rich requests fastapi uvicorn
    Write-Host "[+] Dependencies installed successfully." -ForegroundColor Green
} catch {
    Write-Warning "Some dependencies failed to install. You may need to run: pip install rich requests fastapi uvicorn"
}

# 7. Configure Environment PATH
Write-Host "[*] Registering system PATH environment variable..." -ForegroundColor Yellow
$userPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::User)
if ($userPath -split ';' -notcontains $installDir) {
    $newUserPath = "$userPath;$installDir"
    [Environment]::SetEnvironmentVariable("Path", $newUserPath, [EnvironmentVariableTarget]::User)
    Write-Host "[+] Successfully added $installDir to your User PATH!" -ForegroundColor Green
} else {
    Write-Host "[*] $installDir is already present in PATH." -ForegroundColor Gray
}

# 8. Success Output
Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "    Ethrix-Forge Installed Successfully!     " -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host "Please restart your terminal/IDE to load the new PATH."
Write-Host "To use the CLI, run: "
Write-Host "  ethrix chat" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Green
