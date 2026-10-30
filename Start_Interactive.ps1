param(
    [string]$Workbook = (Join-Path $env:USERPROFILE 'Downloads\Copy of 100 CITATION _ Cheer Athletics-St. Louis (1).xlsx'),
    [string]$StartWith = '',
    [int]$Target = 100,
    [string]$Pool = (Join-Path $PSScriptRoot 'websites\Website_Pool.xlsx')
)

Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath $Workbook -PathType Leaf)) {
    throw 'Workbook not found. Pass its path using -Workbook.'
}
Write-Host 'Interactive backlink session' -ForegroundColor Cyan
Write-Host 'Work in the browser; return to this window when a prompt appears.'
Write-Host 'At a CAPTCHA: Enter continues; refill restores cleared forms; manual opens the guided completion prompt.'
Write-Host 'At manual completion: browser opens your regular browser; paste a public URL, or type pending, skip, or stop.'
Write-Host 'Only independently verified public URLs are counted. Sites may require approval, payment, or working access.'
$publisherArguments = @((Join-Path $PSScriptRoot 'backlinks.py'), $Workbook, '--publish', '--interactive', '--pool', $Pool, '--target', "$Target")
if ($StartWith) { $publisherArguments += @('--start-with', $StartWith) }
& python -u @publisherArguments
Write-Host 'Session finished. Results are saved in the output folder.'
Read-Host 'Press Enter to close this window'
