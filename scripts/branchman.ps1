# Calls the running plugin's versioned API. Never maintains a separate Git tree.
param(
  [Parameter(Mandatory = $true)][ValidateSet('tree','status','fork','merge','sync','remove','recover','unarchive','check')][string]$Action,
  [Parameter(Mandatory = $true)][string]$BaseUrl,
  [string]$BodyFile
)
$ErrorActionPreference = 'Stop'
$base = [Uri]$BaseUrl
if ($base.Scheme -ne 'http' -or $base.Host -notin @('localhost','127.0.0.1','[::1]')) { throw 'Use the local DSH web URL' }
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
# The DSH URL establishes the official authentication cookie.
Invoke-WebRequest -Uri $BaseUrl -WebSession $session | Out-Null
$uri = $base.GetLeftPart([UriPartial]::Authority) + '/branchman/api/' + $Action
if ($Action -eq 'tree') {
  $response = Invoke-RestMethod -Uri $uri -WebSession $session
} else {
  if (-not $BodyFile) { throw 'An explicit JSON BodyFile is required' }
  $body = Get-Content -LiteralPath $BodyFile -Raw -Encoding UTF8
  $parsed = $body | ConvertFrom-Json
  if ($Action -eq 'status') {
    $response = Invoke-RestMethod -Uri ($uri + '?directionId=' + [Uri]::EscapeDataString($parsed.directionId)) -WebSession $session
  } else {
    $response = Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -WebSession $session
  }
}
if ($response.protocolVersion -ne 2 -or $response.schemaVersion -ne 2) { throw 'Plugin protocol mismatch' }
$response | ConvertTo-Json -Depth 30
if (-not $response.ok -or $response.data.state -in @('failed','recovery-required','running')) { exit 1 }
