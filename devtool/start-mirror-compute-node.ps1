param(
  [string]$ServerUrl = $env:YDL_MIRROR_WORKER_URL,
  [Parameter(Mandatory = $true)][string]$WorkerId,
  [ValidateRange(1, 5)][int]$Concurrency = 1,
  [ValidateSet("true", "false")][string]$AcceptJobs = "true"
)

$ErrorActionPreference = "Stop"
if (-not $ServerUrl) { $ServerUrl = Read-Host "请输入服务器地址，例如 https://example.com" }
if (-not $env:YDL_MIRROR_WORKER_TOKEN) {
  $secureToken = Read-Host "请输入节点密钥" -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  try { $env:YDL_MIRROR_WORKER_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

$env:YDL_MIRROR_WORKER_URL = $ServerUrl.TrimEnd("/")
$env:YDL_MIRROR_WORKER_ID = $WorkerId
$env:YDL_MIRROR_WORKER_CONCURRENCY = [string]$Concurrency
$env:YDL_MIRROR_WORKER_ACCEPT_JOBS = $AcceptJobs

$worker = Join-Path $PSScriptRoot "mirror-batch-worker.js"
if (-not (Test-Path -LiteralPath $worker)) { throw "找不到Worker：$worker" }
& node $worker
exit $LASTEXITCODE
