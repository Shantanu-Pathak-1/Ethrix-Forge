# Ethrix PowerShell Launcher
# Use this instead of .\ethrix.bat to avoid "Terminate batch job (Y/N)?" prompt
$ErrorActionPreference = "SilentlyContinue"
& python "$PSScriptRoot\cli\ethrix.py" @args
exit $LASTEXITCODE
