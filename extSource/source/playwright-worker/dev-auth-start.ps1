param(
  [string]$WorkerUrl = "http://127.0.0.1:3211",
  [string]$BusinessName = "Hot Mess Cleanup & Junk Removal",
  [string]$ProfileId = "isolated-a3-profile",
  [switch]$PrepareOnly
)

$ErrorActionPreference = "Stop"

function ConvertFrom-SecureStringValue([Security.SecureString]$SecureValue) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Invoke-WorkerJson([string]$Path, [hashtable]$Body, [string]$Token) {
  $headers = @{ "x-ba2-playwright-token" = $Token }
  try {
    return Invoke-RestMethod -Uri "$WorkerUrl$Path" -Method Post -Headers $headers -ContentType "application/json" -Body ($Body | ConvertTo-Json -Compress)
  }
  catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -eq 401) {
      throw "Development worker authentication failed for $Path. The hidden token did not match the current isolated worker; no credentials were sent."
    }
    throw
  }
}

$token = $env:BA2_PLAYWRIGHT_TOKEN
$secureToken = $null
$securePassword = $null
$password = $null
$startBody = $null

try {
  if (-not $token) {
    $secureToken = Read-Host "Development worker token (hidden)" -AsSecureString
    $token = ConvertFrom-SecureStringValue $secureToken
  }

  $prepared = Invoke-WorkerJson "/ampblogs/dev/auth/prepare" @{ profile = @{ profileId = $ProfileId; businessName = $BusinessName } } $token
  if (-not $prepared.run -or $prepared.run.phase -ne "ACCOUNT_DECISION_REQUIRED") {
    throw "The development worker is not waiting for the account decision; no credentials were requested."
  }

  $runId = $prepared.run.runId
  if ($PrepareOnly) {
    [pscustomobject]@{
      status = $prepared.status
      runId = $runId
      phase = $prepared.run.phase
      pageState = $prepared.run.pageState
      credentialsProvided = $prepared.run.credentialsProvided
      next = "Run this helper without -PrepareOnly when disposable credentials are approved."
    } | ConvertTo-Json -Compress
    return
  }

  $username = Read-Host "Disposable AmpBlogs username"
  $email = Read-Host "Disposable AmpBlogs email"
  $securePassword = Read-Host "Disposable AmpBlogs password (hidden)" -AsSecureString
  $password = ConvertFrom-SecureStringValue $securePassword
  if (-not $username -or -not $email -or -not $password) { throw "Username, email, and password are required." }

  $startBody = @{
    runId = $runId
    accountStatus = "new"
    credentials = @{ username = $username; email = $email; password = $password }
  }
  $started = Invoke-WorkerJson "/ampblogs/dev/auth/start" $startBody $token
  [pscustomobject]@{
    status = $started.status
    runId = $started.run.runId
    phase = $started.run.phase
    pageState = $started.run.pageState
    credentialsProvided = $started.run.credentialsProvided
    next = "Inspect the signup form. Solve CAPTCHA, review Terms, and submit only after separate approval."
  } | ConvertTo-Json -Compress
}
finally {
  $password = $null
  $startBody = $null
  $token = $null
  $securePassword = $null
  $secureToken = $null
}
