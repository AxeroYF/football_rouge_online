param([switch]$Stop, [switch]$NoBrowser)
if ($env:YDL_OFFLINE_NO_BROWSER -eq "1") { $NoBrowser = $true }

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$Host.UI.RawUI.WindowTitle = "YDL S4 Offline"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Join-Path $root "runtime\node.exe"
$appDir = Join-Path $root "app"
$seedData = Join-Path $root "seed-data"
$seedProfiles = Join-Path $root "seed-player-profiles"
$supportDir = Join-Path $env:LOCALAPPDATA "YDL S4 Offline"
$dataDir = Join-Path $supportDir "data"
$profileDir = Join-Path $supportDir "player_profiles"
$logDir = Join-Path $supportDir "logs"
$stdoutLog = Join-Path $logDir "server.stdout.log"
$stderrLog = Join-Path $logDir "server.stderr.log"
$pidFile = Join-Path $supportDir "server.pid"
$baseUrl = "http://127.0.0.1:4318"

function Get-OfflineHealth {
  try {
    $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 2 -UseBasicParsing
    return $health.offlineYdl -eq $true
  } catch {
    return $false
  }
}

function Stop-OfflineServer {
  if (-not (Test-Path -LiteralPath $pidFile)) { return $false }
  $serverPid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue
  if ($process -and $process.Name -eq "node.exe" -and $process.ExecutablePath -eq $node) {
    Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    return $true
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  return $false
}

if ($Stop) {
  if (Stop-OfflineServer) { Write-Host "YDL S4 Offline 已停止。" -ForegroundColor Green }
  else { Write-Host "没有发现正在运行的 YDL S4 Offline。" -ForegroundColor Yellow }
  exit 0
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "          YDL S4 Offline Windows x64" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath (Join-Path $appDir "devtool\public-server.js"))) {
  throw "离线版文件不完整，请重新解压整个 ZIP。"
}

if (Get-OfflineHealth) {
  Write-Host "离线服务已经运行，正在打开游戏……" -ForegroundColor Green
  Start-Process "$baseUrl/versus/"
  exit 0
}

New-Item -ItemType Directory -Path $supportDir,$logDir -Force | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $dataDir "OFFLINE_MIGRATION_REPORT.json"))) {
  if (Test-Path -LiteralPath $dataDir) {
    $recovery = Join-Path $supportDir ("data-incomplete-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
    Move-Item -LiteralPath $dataDir -Destination $recovery
  }
  Write-Host "正在初始化离线赛季存档……" -ForegroundColor Yellow
  Copy-Item -LiteralPath $seedData -Destination $dataDir -Recurse
}
if (-not (Test-Path -LiteralPath $profileDir)) {
  Write-Host "正在初始化球员图片……" -ForegroundColor Yellow
  Copy-Item -LiteralPath $seedProfiles -Destination $profileDir -Recurse
}

$env:YDL_OFFLINE_MODE = "1"
$env:APP_ENV = "production"
$env:APP_LABEL = "YDL S4 Offline"
$env:VERSUS_HOST = "127.0.0.1"
$env:DEVTOOL_PORT = "4318"
$env:VERSUS_ADMIN_PASSWORD = "ydl-offline"
$env:YDL_MATCH_ENGINE = "v2"
$env:YDL_LEAGUE_MATCH_ENGINE = "v2"
$env:YDL_CUP_MATCH_ENGINE = "v2"
$env:YELLOWDOGS_LEAGUE_PATH = Join-Path $dataDir "yellowdogs-league-shards"
$env:VERSUS_ACCOUNTS_PATH = Join-Path $dataDir "versus-accounts.json"
$env:YDL_CONTENT_OVERRIDES_PATH = Join-Path $dataDir "ydl-content-overrides.json"
$env:YDL_PLAYER_CARD_STUDIO_PATH = Join-Path $dataDir "ydl-player-card-studio.json"
$env:YDL_PLAYER_PROFILE_ROOT = $profileDir

Remove-Item -LiteralPath $stdoutLog,$stderrLog -Force -ErrorAction SilentlyContinue
Write-Host "正在启动本地服务：http://127.0.0.1:4318" -ForegroundColor Yellow
$process = Start-Process -FilePath $node -ArgumentList "devtool/public-server.js" -WorkingDirectory $appDir -NoNewWindow -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ASCII

try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    if (Get-OfflineHealth) { $ready = $true; break }
    if ($process.HasExited) { break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    Write-Host "离线版启动失败。日志目录：$logDir" -ForegroundColor Red
    if (Test-Path -LiteralPath $stderrLog) { Get-Content -LiteralPath $stderrLog -Tail 30 }
    throw "本地服务未能启动。"
  }
  Write-Host "游戏已启动。关闭本窗口将停止离线服务。" -ForegroundColor Green
  Write-Host "本地后台：http://127.0.0.1:4318/admin/  密码：ydl-offline"
  Start-Process "$baseUrl/versus/"
  $process.WaitForExit()
  exit $process.ExitCode
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}
