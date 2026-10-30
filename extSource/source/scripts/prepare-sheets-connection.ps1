# Run in the PowerShell session used for the NEXT planned Next.js launch.
# Never starts/stops services, contacts Google, or enables Sheets writes.
[CmdletBinding()]
param([Parameter(Mandatory = $true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId)

$ErrorActionPreference = 'Stop'
$privateDir = Join-Path (Split-Path $PSScriptRoot -Parent) '.local-sheets'
$connectionPath = Join-Path $privateDir 'connection.json'
$step = 'existing environment check'
try {
    # Refuse existing configuration overrides rather than rotating a live key.
    if ($env:BA2_SHEETS_WRITEBACK_KEY -or $env:BA2_SHEETS_EXTENSION_ID) {
        if (-not (Test-Path -LiteralPath $connectionPath)) { throw 'Existing configuration requires review.' }
    }
    $step = 'private directory permissions'
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    if (-not (Test-Path -LiteralPath $privateDir)) {
        New-Item -ItemType Directory -Path $privateDir | Out-Null
        $acl = New-Object Security.AccessControl.DirectorySecurity
        $acl.SetOwner($sid)
        $acl.SetAccessRuleProtection($true, $false)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
        Set-Acl -LiteralPath $privateDir -AclObject $acl
    }
    if ((Get-Item -LiteralPath $privateDir).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unsafe directory.' }
    $acl = Get-Acl -LiteralPath $privateDir
    if (-not $acl.AreAccessRulesProtected) { throw 'Inherited directory permissions.' }
    foreach ($entry in $acl.Access) {
        if ($entry.AccessControlType -eq 'Allow' -and $entry.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Unsafe directory permissions.' }
    }

    if (Test-Path -LiteralPath $connectionPath) {
        $step = 'private configuration validation'
        if ((Get-Item -LiteralPath $connectionPath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unsafe file.' }
        $fileAcl = Get-Acl -LiteralPath $connectionPath
        foreach ($entry in $fileAcl.Access) {
            if ($entry.AccessControlType -eq 'Allow' -and $entry.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Unsafe file permissions.' }
        }
        $connection = Get-Content -LiteralPath $connectionPath -Raw | ConvertFrom-Json
        if ($connection.extensionId -cne $ExtensionId -or $connection.key -cnotmatch '^[a-f0-9]{64}$') { throw 'Existing connection mismatch.' }
    } else {
        $step = 'private configuration creation'
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $connection = @{ extensionId = $ExtensionId; key = ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant() }
        $stream = [IO.File]::Open($connectionPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
            $content = [Text.Encoding]::UTF8.GetBytes(($connection | ConvertTo-Json -Compress))
            $stream.Write($content, 0, $content.Length)
        } finally { $stream.Dispose() }
    }
    $step = 'matching process environment'
    if (($env:BA2_SHEETS_WRITEBACK_KEY -and $env:BA2_SHEETS_WRITEBACK_KEY -cne $connection.key) -or
        ($env:BA2_SHEETS_EXTENSION_ID -and $env:BA2_SHEETS_EXTENSION_ID -cne $ExtensionId)) { throw 'Existing environment mismatch.' }
    $env:BA2_SHEETS_EXTENSION_ID = $ExtensionId
    $env:BA2_SHEETS_WRITEBACK_KEY = $connection.key
    $env:BA2_SHEETS_WRITE_APPROVED = 'false'
    Write-Host 'Private connection prepared for this shell only. Sheets writes disabled. No service started or restarted.'
} catch {
    throw "Sheets setup stopped at $step. Review locally; no secret details displayed."
} finally {
    $connection = $null
    $content = $null
    $bytes = $null
}
