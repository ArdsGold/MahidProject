param([Parameter(Mandatory=$true)][string]$MessageFile)

$ErrorActionPreference = 'Stop'
$notificationIcon = $null
try {
    $notificationData = Get-Content -LiteralPath $MessageFile -Raw | ConvertFrom-Json
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $notificationIcon = New-Object System.Windows.Forms.NotifyIcon
    $notificationIcon.Icon = [System.Drawing.SystemIcons]::Information
    $notificationIcon.Text = 'Backlink tool'
    $notificationIcon.Visible = $true
    $notificationIcon.ShowBalloonTip(10000, [string]$notificationData.title, [string]$notificationData.message,
        [System.Windows.Forms.ToolTipIcon]::Info)
    [System.Media.SystemSounds]::Exclamation.Play()
    # Keep the notification's tray icon alive briefly; the tool itself keeps waiting for input.
    $notificationDeadline = [DateTime]::UtcNow.AddSeconds(10)
    while ([DateTime]::UtcNow -lt $notificationDeadline) {
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 100
    }
}
finally {
    if ($null -ne $notificationIcon) { $notificationIcon.Dispose() }
    Remove-Item -LiteralPath $MessageFile -ErrorAction SilentlyContinue
}
