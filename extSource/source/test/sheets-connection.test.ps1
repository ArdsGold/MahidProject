# Isolated Windows fixture: no real connection configuration, network or services.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$fixture = Join-Path $repo ('extension/test/.tmp/sheets-connection-' + [guid]::NewGuid().ToString('N'))
$fixtureScripts = Join-Path $fixture 'scripts'
New-Item -ItemType Directory -Path $fixtureScripts -Force | Out-Null
$helper = Join-Path $fixtureScripts 'prepare-sheets-connection.ps1'
Copy-Item -LiteralPath (Join-Path $repo 'scripts/prepare-sheets-connection.ps1') -Destination $helper
$names = @('BA2_SHEETS_EXTENSION_ID', 'BA2_SHEETS_WRITEBACK_KEY', 'BA2_SHEETS_WRITE_APPROVED')
$saved = @{}
foreach ($name in $names) {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
}
function Check([bool]$condition, [string]$message) { if (-not $condition) { throw $message } }
try {
    $id = 'a' * 32
    & $helper -ExtensionId $id
    $path = Join-Path $fixture '.local-sheets/connection.json'
    $config = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    Check ($config.extensionId -ceq $id -and $config.key -cmatch '^[a-f0-9]{64}$') 'Invalid generated configuration.'
    Check ($env:BA2_SHEETS_WRITEBACK_KEY -ceq $config.key) 'Environment key mismatch.'
    Check ($env:BA2_SHEETS_WRITE_APPROVED -ceq 'false') 'Writes must remain disabled.'
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $dirAcl = Get-Acl -LiteralPath (Split-Path $path -Parent)
    Check $dirAcl.AreAccessRulesProtected 'Private directory inherits permissions.'
    foreach ($entry in (Get-Acl -LiteralPath $path).Access) {
        Check ($entry.AccessControlType -ne 'Allow' -or $entry.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq $sid) 'Private file readable by another principal.'
    }
    $hash = (Get-FileHash -LiteralPath $path).Hash
    & $helper -ExtensionId $id
    Check ((Get-FileHash -LiteralPath $path).Hash -ceq $hash) 'Repeated setup rotated key.'
    $rejected = $false
    try { & $helper -ExtensionId ('b' * 32) } catch { $rejected = $true }
    Check $rejected 'Different extension ID accepted.'
    Check ((Get-FileHash -LiteralPath $path).Hash -ceq $hash) 'Rejected setup changed private file.'
    $env:BA2_SHEETS_WRITEBACK_KEY = 'fixture-conflicting-key'
    $rejected = $false
    try { & $helper -ExtensionId $id } catch { $rejected = $true }
    Check $rejected 'Conflicting environment accepted.'
    Check ((Get-FileHash -LiteralPath $path).Hash -ceq $hash) 'Conflicting setup rotated key.'
    Write-Host 'PASS: private ACL, matching key, disabled writes, reuse, and mismatch rejection; no services or network.'
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    # Clear fixture key without recursive filesystem operations; leave ignored test artifacts.
    $path = Join-Path $fixture '.local-sheets/connection.json'
    if (Test-Path -LiteralPath $path) { [IO.File]::WriteAllText($path, '{}') }
    $config = $null
}
