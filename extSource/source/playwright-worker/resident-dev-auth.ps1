param(
  [switch]$ApproveReplacement,
  [ValidateSet("Prepare", "Start", "Resume", "Status", "Reset", "Exit")]
  [string]$InitialOperation = ""
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
$workerStarted = $false
$worker = $null
$token = $null

function Get-WorkerProcess([int]$ProcessId) { Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" }

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

function AssertProductionIdentity {
  $production = Get-WorkerProcess $productionPid
  if (-not $production -or $production.Name -ne "node.exe" -or $production.CommandLine -notmatch "playwright-worker[\\/]server\.mjs") {
    throw "Production worker identity is not verified; no process was changed."
  }
}

function GetVerifiedDevelopmentOwner {
  $listener = Get-NetTCPConnection -LocalPort 3211 -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) { return $null }
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
  return $development
}

function StopOwnedDevelopmentWorker {
  if ($workerStarted -and $worker) {
    taskkill /PID $worker.Id /T /F | Out-Null
    $script:workerStarted = $false
  }
}

function Invoke-DevJson([string]$Path, [hashtable]$Body) {
  return Invoke-RestMethod -Uri "http://127.0.0.1:3211$Path" -Method Post -Headers @{ "x-ba2-playwright-token" = $token } -ContentType "application/json" -Body ($Body | ConvertTo-Json -Compress)
}

function Show-SafeRun([object]$Result) {
  [pscustomobject]@{
    status = $Result.status
    runId = $Result.run.runId
    phase = $Result.run.phase
    pageState = $Result.run.pageState
    outcome = $Result.run.outcome
    credentialsProvided = $Result.run.credentialsProvided
  } | ConvertTo-Json -Compress
}

function Prepare-Auth {
  $result = Invoke-DevJson "/ampblogs/dev/auth/prepare" @{ profile = @{ profileId = "isolated-a3-profile"; businessName = "Hot Mess Cleanup & Junk Removal" } }
  Show-SafeRun $result
}

function Start-Auth {
  $prepared = Invoke-DevJson "/ampblogs/dev/auth/prepare" @{ profile = @{ profileId = "isolated-a3-profile"; businessName = "Hot Mess Cleanup & Junk Removal" } }
  if (-not $prepared.run -or $prepared.run.phase -ne "ACCOUNT_DECISION_REQUIRED") { throw "The current run is not waiting for an account decision; no credentials were requested." }
  $accountStatus = (Read-Host "Account status (existing/new)").Trim().ToLowerInvariant()
  if ($accountStatus -notin @("existing", "new")) { throw "Account status must be existing or new." }
  $username = $null; $email = $null; $password = $null; $securePassword = $null
  try {
    $username = Read-Host "Disposable AmpBlogs username"
    if ($accountStatus -eq "new") { $email = Read-Host "Disposable AmpBlogs email" }
    $securePassword = Read-Host "Disposable AmpBlogs password (hidden)" -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $credentialBody = @{ username = $username; password = $password }
    if ($accountStatus -eq "new") { $credentialBody.email = $email }
    $result = Invoke-DevJson "/ampblogs/dev/auth/start" @{ runId = $prepared.run.runId; accountStatus = $accountStatus; credentials = $credentialBody }
    Show-SafeRun $result
  }
  finally {
    $username = $null; $email = $null; $password = $null; $securePassword = $null
  }
}

function Resume-Auth {
  $latest = Get-ChildItem (Join-Path $devState "dev-auth-*.json") -ErrorAction Stop | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $run = Get-Content $latest.FullName -Raw | ConvertFrom-Json
  $result = Invoke-DevJson "/ampblogs/dev/auth/resume" @{ runId = $run.runId }
  Show-SafeRun $result
}

function Reset-Auth {
  $latest = Get-ChildItem (Join-Path $devState "dev-auth-*.json") -ErrorAction Stop | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $run = Get-Content $latest.FullName -Raw | ConvertFrom-Json
  $result = Invoke-DevJson "/ampblogs/dev/auth/reset" @{ runId = $run.runId; force = $true }
  Show-SafeRun $result
}

function Status-Auth {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:3211/health" -Method Get -Headers @{ "x-ba2-playwright-token" = $token }
  $latest = Get-ChildItem (Join-Path $devState "dev-auth-*.json") -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $run = if ($latest) { Get-Content $latest.FullName -Raw | ConvertFrom-Json } else { $null }
  [pscustomobject]@{ health = $health.ok; workerPort = 3211; runId = $run.runId; phase = $run.phase; pageState = $run.pageState; outcome = $run.outcome; credentialsProvided = $run.credentialsProvided } | ConvertTo-Json -Compress
}

function Show-SafeError([object]$ErrorRecord) {
  $message = [string]$ErrorRecord.Exception.Message
  if ($message -match "token|password|secret|credential|authorization|x-ba2") {
    Write-Output "Operation failed safely without exposing sensitive values."
  }
  else {
    Write-Output "Operation failed safely: $message"
  }
}

try {
  AssertProductionIdentity
  $existing = GetVerifiedDevelopmentOwner
  if ($existing -and -not $ApproveReplacement) {
    Write-Output "Existing verified development worker detected: PID $($existing.ProcessId) on port 3211. No replacement was started. Re-run with -ApproveReplacement only after explicit development-only approval."
    return
  }
  if ($existing) {
    taskkill /PID $existing.ProcessId /T /F | Out-Null
    Start-Sleep -Seconds 2
  }
  if (Get-NetTCPConnection -LocalPort 3211 -ErrorAction SilentlyContinue) { throw "Port 3211 did not become free; no worker was started." }

  $token = New-DevelopmentToken
  $env:BA2_PLAYWRIGHT_PORT = "3211"
  $env:BA2_PLAYWRIGHT_TOKEN = $token
  $env:BA2_PLAYWRIGHT_PROFILE_DIR = $devProfile
  $env:BA2_AMP_BLOGS_PROFILE_DIR = $devAmpBlogsProfile
  $env:BA2_PLAYWRIGHT_DIAGNOSTICS_DIR = $devDiagnostics
  $env:BA2_AMP_BLOGS_STATE_DIR = $devState
  $env:BA2_PLAYWRIGHT_LOAD_EXTENSION = "false"
  $worker = Start-Process -FilePath "C:\Program Files\nodejs\node.exe" -ArgumentList "playwright-worker/server.mjs" -WorkingDirectory $root -WindowStyle Hidden -PassThru
  $workerStarted = $true
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try { if ((Invoke-RestMethod -Uri "http://127.0.0.1:3211/health" -Headers @{ "x-ba2-playwright-token" = $token }).ok) { break } } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not (Get-NetTCPConnection -LocalPort 3211 -ErrorAction SilentlyContinue)) { throw "Development worker did not become healthy." }

  if ($InitialOperation -eq "Reset") {
    Reset-Auth
    Prepare-Auth
  }
  elseif ($InitialOperation -and $InitialOperation -ne "Exit") {
    & "$InitialOperation-Auth"
  }
  if ($InitialOperation -eq "Exit") { return }

  while ($true) {
    $operation = (Read-Host "Operation: Prepare, Start, Resume, Status, Reset, Exit").Trim().ToLowerInvariant()
    try {
      switch ($operation) {
        "prepare" { Prepare-Auth }
        "start" { Start-Auth }
        "resume" { Resume-Auth }
        "status" { Status-Auth }
        "reset" { Reset-Auth }
        "exit" { break }
        default { Write-Output "Unknown operation. Choose Prepare, Start, Resume, Reset, Status, or Exit." }
      }
    }
    catch {
      Show-SafeError $_
    }
    if ($operation -eq "exit") { break }
  }
}
catch {
  Show-SafeError $_
}
finally {
  StopOwnedDevelopmentWorker
  $token = $null
  $env:BA2_PLAYWRIGHT_TOKEN = $null
}
