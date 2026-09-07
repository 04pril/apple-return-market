param(
  [int]$ProxyPort = 8082,
  [int]$WebPort = 8083,
  [string]$Output = 'coupang-live.flows'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($ProxyPort -lt 1 -or $ProxyPort -gt 65535) { throw 'ProxyPort must be between 1 and 65535.' }
if ($WebPort -lt 1 -or $WebPort -gt 65535) { throw 'WebPort must be between 1 and 65535.' }
if ($ProxyPort -eq $WebPort) { throw 'ProxyPort and WebPort must be different.' }

$mitmweb = Get-Command mitmweb.exe -ErrorAction SilentlyContinue
if (-not $mitmweb) {
  $mitmweb = Get-Command mitmweb -ErrorAction Stop
}

$outputPath = [System.IO.Path]::GetFullPath($Output)
Write-Host "Proxy: 0.0.0.0:$ProxyPort"
Write-Host "Web UI: http://127.0.0.1:$WebPort"
Write-Host "Flow file: $outputPath"
Write-Host 'The flow file can contain authenticated app traffic. Keep it local; do not commit or share it.'
Write-Host 'Press Ctrl+C when the batch is finished.'

& $mitmweb.Source `
  --listen-host 0.0.0.0 `
  --listen-port $ProxyPort `
  --set "web_port=$WebPort" `
  --set "save_stream_file=$outputPath"

exit $LASTEXITCODE
