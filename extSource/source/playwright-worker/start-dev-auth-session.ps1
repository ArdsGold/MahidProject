param(
  [switch]$CollectCredentials
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$devRuntime = Join-Path $root "playwright-worker\.dev-runtime"
$devProfile = Join-Path $devRuntime "playwright-profile"
$devAmpBlogsProfile = Join-Path $devRuntime "ampblogs-profile"
$devDiagnostics = Join-Path $devRuntime "diagnostics"
$devState = Join-Path $devRuntime "state"
$productionProfile = Join-Path $root ".playwright-profile"
$productionAmpBlogsProfile = Join-Path $root ".ampblogs-playwright-profile"
$productionPid = 29172

function New-DevelopmentToken {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
    return ([BitConverter]::ToString($bytes).Replace("-", "")).ToLowerInvariant()
  }
  finally {
    [Array]::Clear($bytes, 0, $bytes.Length)
    $generator.Dispose()
  }
}

function Get-WorkerProcess([int]$ProcessId) {
  return Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
}

$production = Get-WorkerProcess $productionPid
if (-not $production -or $production.Name -ne "node.exe" -or $production.CommandLine -notmatch "playwright-worker[\\/]server\.mjs") {
  throw "Production worker identity is not verified; no process was changed."
}

$listener = Get-NetTCPConnection -LocalPort 3211 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  if ($listener.OwningProcess -eq $productionPid) { throw "Port 3211 is owned by production; no process was changed." }
  $development = Get-WorkerProcess ([int]$listener.OwningProcess)
  if (-not $development -or $development.Name -ne "node.exe" -or $development.CommandLine -notmatch "playwright-worker[\\/]server\.mjs") {
    throw "Port 3211 is owned by an unverified process; no process was changed."
  }
  $devBrowsers = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match [regex]::Escape($devRuntime) }
  if (-not $devBrowsers) { throw "Development browser profile ownership could not be verified; no process was changed." }
  if (($devBrowsers | Where-Object { $_.CommandLine -match [regex]::Escape($productionProfile) -or $_.CommandLine -match [regex]::Escape($productionAmpBlogsProfile) })) {
    throw "Development browser profile overlaps production; no process was changed."
  }
  taskkill /PID $development.ProcessId /T /F | Out-Null
  Start-Sleep -Seconds 2
}

if (Get-NetTCPConnection -LocalPort 3211 -ErrorAction SilentlyContinue) {
  throw "Port 3211 did not become free after the verified development shutdown."
}

$env:BA2_PLAYWRIGHT_PORT = "3211"
$env:BA2_PLAYWRIGHT_TOKEN = New-DevelopmentToken
$env:BA2_PLAYWRIGHT_PROFILE_DIR = $devProfile
$env:BA2_AMP_BLOGS_PROFILE_DIR = $devAmpBlogsProfile
$env:BA2_PLAYWRIGHT_DIAGNOSTICS_DIR = $devDiagnostics
$env:BA2_AMP_BLOGS_STATE_DIR = $devState
$env:BA2_PLAYWRIGHT_LOAD_EXTENSION = "false"

$worker = Start-Process -FilePath "C:\Program Files\nodejs\node.exe" -ArgumentList "playwright-worker/server.mjs" -WorkingDirectory $root -WindowStyle Hidden -PassThru
try {
  $health = $null
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:3211/health" -Method Get -Headers @{ "x-ba2-playwright-token" = $env:BA2_PLAYWRIGHT_TOKEN } -TimeoutSec 3
      if ($health.ok -eq $true) { break }
    }
    catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $health -or $health.ok -ne $true) { throw "Development worker did not become healthy." }

  $helperArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "dev-auth-start.ps1"))
  if (-not $CollectCredentials) { $helperArgs += "-PrepareOnly" }
  & powershell.exe @helperArgs
}
catch {
  if ($worker -and -not $worker.HasExited) { taskkill /PID $worker.Id /T /F | Out-Null }
  throw
}
finally {
  $env:BA2_PLAYWRIGHT_TOKEN = $null
}
