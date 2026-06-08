# Ethrix PowerShell Launcher
# Use this instead of .\ethrix.bat to avoid "Terminate batch job (Y/N)?" prompt
$ErrorActionPreference = "SilentlyContinue"
& python "$PSScriptRoot\ethrix.py" @args
exit $LASTEXITCODE
