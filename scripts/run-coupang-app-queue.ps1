param(
  [Parameter(Mandatory = $true)]
  [string]$Queue,

  [Parameter(Mandatory = $true)]
  [string]$HostName,

  [string]$User = 'mobile',
  [int]$Port = 22,
  [int]$Start = 0,
  [int]$Limit = 20,
  [int]$DelaySeconds = 5,
  [switch]$All,
  [switch]$WhatIf
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Start -lt 0) { throw 'Start must be >= 0.' }
if ($Limit -lt 1) { throw 'Limit must be >= 1.' }
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Port must be between 1 and 65535.' }
if ($DelaySeconds -lt 3) { throw 'DelaySeconds must be at least 3.' }
if ($All -and $DelaySeconds -lt 5) { throw 'Full-queue runs require DelaySeconds >= 5.' }
if (-not (Test-Path -LiteralPath $Queue)) { throw "Queue file not found: $Queue" }

$ssh = Get-Command ssh.exe -ErrorAction Stop
$payload = Get-Content -Raw -LiteralPath $Queue | ConvertFrom-Json
$items = @($payload.items)
if ($items.Count -eq 0) { throw 'Queue contains no items.' }
if ($Start -ge $items.Count) { throw "Start $Start is outside queue length $($items.Count)." }

$remaining = @($items | Select-Object -Skip $Start)
if ($All) {
  $selected = $remaining
} else {
  $selected = @($remaining | Select-Object -First $Limit)
}

$target = "$User@$HostName"

Write-Host "Checking jailbroken iPhone opener over SSH..."
if (-not $WhatIf) {
  & $ssh.Source -p $Port $target 'command -v uiopen >/dev/null 2>&1'
  if ($LASTEXITCODE -ne 0) {
    throw 'uiopen was not found on the iPhone. Install/provide uiopen first, then retry.'
  }
}

Write-Host "Queue: $Queue"
Write-Host "Targets: $($selected.Count) / $($items.Count), start=$Start, delay=${DelaySeconds}s"
if ($WhatIf) { Write-Host 'WhatIf mode: URLs will only be printed.' }

for ($i = 0; $i -lt $selected.Count; $i += 1) {
  $item = $selected[$i]
  $url = [string]$item.url
  $vendorItemId = [string]$item.vendorItemId
  $name = [string]$item.name

  if ($url -notmatch '^https://www\.coupang\.com/vp/products/\d+\?') {
    throw "Unexpected URL in queue item $($Start + $i): $url"
  }
  if ($url.Contains("'")) {
    throw "Queue URL contains an unsupported quote character: $url"
  }

  $position = $Start + $i + 1
  Write-Host "[$position/$($items.Count)] vendor=$vendorItemId $name"
  Write-Host "  $url"

  if (-not $WhatIf) {
    # uiopen asks SpringBoard to open the HTTPS URL. The real Coupang app then
    # creates its own signed/authenticated request; this script never receives
    # or stores app cookies, authorization headers, signatures, or device IDs.
    $remoteCommand = "uiopen --url '$url'"
    & $ssh.Source -p $Port $target $remoteCommand
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to open queue item $position (vendorItemId=$vendorItemId)."
    }
  }

  if ($i -lt ($selected.Count - 1)) {
    Start-Sleep -Seconds $DelaySeconds
  }
}

Write-Host 'Queue batch finished.'
Write-Host 'Stop/save the mitmproxy capture, then parse it with stock:parse-flow and the same queue file.'
