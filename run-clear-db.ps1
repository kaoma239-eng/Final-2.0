# Run clear-database.sql against MySQL/MariaDB if `mysql` CLI is available.
# Usage: Right-click and Run in PowerShell or run: .\run-clear-db.ps1 -Server localhost -User root -Database mkca_platform
param(
  [string]$Server = 'localhost',
  [string]$User = 'root',
  [string]$Password = '',
  [string]$Database = 'mkca_platform',
  [string]$SqlFile = 'clear-database.sql'
)

if (-not (Test-Path $SqlFile)) {
  Write-Error "SQL file '$SqlFile' not found in current folder."
  exit 1
}

$mysql = Get-Command mysql -ErrorAction SilentlyContinue
if (-not $mysql) {
  Write-Host "mysql client not found. Install MySQL client or run the SQL manually from your DB tool." -ForegroundColor Yellow
  Write-Host "File is: $(Get-Item $SqlFile).FullName"
  exit 1
}

# Prompt for password if not provided
if (-not $Password) {
  $Password = Read-Host -AsSecureString "Enter DB password (input hidden)"
  $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
  $PlainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
  [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)
} else {
  $PlainPassword = $Password
}

$cmd = "mysql -h $Server -u $User -p$PlainPassword < `"$SqlFile`""
Write-Host "Executing: $cmd"
Invoke-Expression $cmd

if ($LASTEXITCODE -eq 0) { Write-Host "Database cleared successfully." -ForegroundColor Green } else { Write-Host "Database clear command exited with code $LASTEXITCODE" -ForegroundColor Red }
