param(
    [string]$Workbook = (Join-Path $PSScriptRoot '.local\workbooks\Cheer_Athletics_St_Louis.xlsx'),
    [string[]]$Only = @(),
    [int]$Target = 100,
    [string]$Pool = (Join-Path $PSScriptRoot 'websites\Website_Pool.xlsx'),
    [switch]$StopAtTarget
)

Set-Location -LiteralPath $PSScriptRoot
Write-Host 'Ui.Vision automation: keep its panel open and its MCP bridge enabled.' -ForegroundColor Cyan
Write-Host 'The app fills mapped forms, submits, captures URLs and verifies them.'
Write-Host 'Complete CAPTCHA in Chrome when prompted here. Type skip or stop at a prompt.'
$automationArguments = @((Join-Path $PSScriptRoot 'uivision_publish.py'), $Workbook, '--publish', '--pool', $Pool, '--target', "$Target")
if (-not $StopAtTarget) { $automationArguments += '--all-sites' }
if ($Only.Count) { $automationArguments += @('--only') + $Only }
& python -u @automationArguments
Read-Host 'Session ended. Press Enter to close'
