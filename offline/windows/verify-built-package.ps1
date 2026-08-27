param(
  [Parameter(Mandatory = $true)][string]$PackageRoot,
  [int]$Port = 44318
)

$ErrorActionPreference = "Stop"
$PackageRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
$node = Join-Path $PackageRoot "runtime\node.exe"
$appDir = Join-Path $PackageRoot "app"
$stateRoot = Join-Path (Split-Path -Parent $PackageRoot) ".windows-integration-state"
$dataDir = Join-Path $stateRoot "data"
$profileDir = Join-Path $stateRoot "player_profiles"
$logDir = Join-Path $stateRoot "logs"
$stdoutLog = Join-Path $logDir "server.stdout.log"
$stderrLog = Join-Path $logDir "server.stderr.log"
$baseUrl = "http://127.0.0.1:$Port"
$process = $null

function Invoke-JsonPost([string]$Path, [hashtable]$Body) {
  return Invoke-RestMethod -Uri "$baseUrl$Path" -Method Post -ContentType "application/json; charset=utf-8" -Body ($Body | ConvertTo-Json -Depth 30 -Compress) -TimeoutSec 30 -UseBasicParsing
}

function Get-StatusCode([string]$Path, [hashtable]$Body) {
  try {
    [void](Invoke-JsonPost $Path $Body)
    return 200
  } catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      return [int]$_.Exception.Response.StatusCode
    }
    throw
  }
}

function Start-TestServer {
  $script:process = Start-Process -FilePath $node -ArgumentList "devtool/public-server.js" -WorkingDirectory $appDir -NoNewWindow -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    try {
      $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 2 -UseBasicParsing
      if ($health.offlineYdl -eq $true) { return $health }
    } catch {}
    if ($script:process.HasExited) { break }
    Start-Sleep -Milliseconds 500
  }
  $tail = if (Test-Path -LiteralPath $stderrLog) { (Get-Content -LiteralPath $stderrLog -Tail 40) -join [Environment]::NewLine } else { "" }
  throw "离线服务启动失败。$tail"
}

function Stop-TestServer {
  if ($script:process -and -not $script:process.HasExited) {
    Stop-Process -Id $script:process.Id -Force -ErrorAction SilentlyContinue
    $script:process.WaitForExit()
  }
  $script:process = $null
  Start-Sleep -Milliseconds 500
}

$stateParent = Split-Path -Parent $stateRoot
$expectedPrefix = [IO.Path]::GetFullPath($stateParent).TrimEnd('\') + '\'
if (-not [IO.Path]::GetFullPath($stateRoot).StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "验证目录不在预期位置。"
}
if (Test-Path -LiteralPath $stateRoot) { Remove-Item -LiteralPath $stateRoot -Recurse -Force }
New-Item -ItemType Directory -Path $stateRoot,$logDir | Out-Null
Copy-Item -LiteralPath (Join-Path $PackageRoot "seed-data") -Destination $dataDir -Recurse
Copy-Item -LiteralPath (Join-Path $PackageRoot "seed-player-profiles") -Destination $profileDir -Recurse

$env:YDL_OFFLINE_MODE = "1"
$env:APP_ENV = "production"
$env:APP_LABEL = "YDL S4 Offline Verification"
$env:VERSUS_HOST = "127.0.0.1"
$env:DEVTOOL_PORT = [string]$Port
$env:VERSUS_ADMIN_PASSWORD = "ydl-offline"
$env:YDL_MATCH_ENGINE = "v2"
$env:YDL_LEAGUE_MATCH_ENGINE = "v2"
$env:YDL_CUP_MATCH_ENGINE = "v2"
$env:YDL_OFFLINE_ATTRIBUTE_UNCAP = "0"
$env:YDL_OFFLINE_OVERCAP_RATE = "1.0"
$env:YELLOWDOGS_LEAGUE_PATH = Join-Path $dataDir "yellowdogs-league-shards"
$env:VERSUS_ACCOUNTS_PATH = Join-Path $dataDir "versus-accounts.json"
$env:YDL_CONTENT_OVERRIDES_PATH = Join-Path $dataDir "ydl-content-overrides.json"
$env:YDL_PLAYER_CARD_STUDIO_PATH = Join-Path $dataDir "ydl-player-card-studio.json"
$env:YDL_PLAYER_PROFILE_ROOT = $profileDir

try {
  $health = Start-TestServer
  if ($health.offlineAttributeSettings.unlocked -ne $false -or [double]$health.offlineAttributeSettings.overflowRate -ne 0) { throw "默认属性上限配置不正确。" }
  $catalog = Invoke-RestMethod -Uri "$baseUrl/api/offline/teams" -TimeoutSec 30 -UseBasicParsing
  if (-not $catalog.ok -or $catalog.teams.Count -ne 10) { throw "离线球队目录校验失败。" }

  $switches = @()
  foreach ($team in @($catalog.teams | Select-Object -First 3)) {
    $selected = Invoke-JsonPost "/api/offline/select-team" @{ teamId = $team.id }
    if (-not $selected.ok -or $selected.team.id -ne $team.id) { throw "球队切换失败：$($team.id)" }
    $switches += $selected
  }

  $identity = $switches[0]
  $league = Invoke-JsonPost "/api/versus/league" @{
    playerId = $identity.profile.id
    accountToken = $identity.accountToken
  }
  $scheme = @($league.league.ownTeam.lineupSchemes | Where-Object { $_.id -eq $league.league.ownTeam.activeLineupSchemeId })[0]
  if (-not $scheme) { throw "未找到当前阵容方案。" }
  $marker = "Windows离线验证-" + (Get-Date -Format "HHmmss")
  [void](Invoke-JsonPost "/api/versus/league/team/lineup-scheme" @{
    playerId = $identity.profile.id
    accountToken = $identity.accountToken
    action = "rename"
    lineupSchemeId = $scheme.id
    name = $marker
  })

  $friendStatus = Get-StatusCode "/api/versus/league/friendlies/invite" @{}
  $computeStatus = Get-StatusCode "/api/versus/league/mirror-marketplace/batch-simulate" @{}
  $roomStatus = Get-StatusCode "/api/versus/rooms" @{}
  if ($friendStatus -ne 404 -or $computeStatus -ne 404 -or $roomStatus -ne 404) {
    throw "停服功能未正确禁用：friend=$friendStatus compute=$computeStatus room=$roomStatus"
  }

  Stop-TestServer
  [void](Start-TestServer)
  $selectedAgain = Invoke-JsonPost "/api/offline/select-team" @{ teamId = $identity.team.id }
  $leagueAgain = Invoke-JsonPost "/api/versus/league" @{
    playerId = $selectedAgain.profile.id
    accountToken = $selectedAgain.accountToken
  }
  $schemeAgain = @($leagueAgain.league.ownTeam.lineupSchemes | Where-Object { $_.id -eq $scheme.id })[0]
  if ($schemeAgain.name -ne $marker) { throw "重启后阵容方案修改未持久化。" }

  [ordered]@{
    ok = $true
    offlineHealth = $health.offlineYdl
    matchEngine = $health.matchEngine
    teamCatalogCount = $catalog.teams.Count
    testedTeamSwitches = $switches.Count
    lineupPersistenceAfterRestart = $true
    friendBattleApiStatus = $friendStatus
    computeWorkerApiStatus = $computeStatus
    onlineRoomApiStatus = $roomStatus
  } | ConvertTo-Json -Compress
} finally {
  Stop-TestServer
}
