param(
  [string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [string]$MacBuildKit = "",
  [string]$OutputDir = "",
  [string]$Version = "1.1.0"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
if (-not $MacBuildKit) { $MacBuildKit = Join-Path $ProjectRoot "handoff\YDL-S4-Offline-macOS-arm64-v1.0.0-build-kit" }
if (-not $OutputDir) { $OutputDir = Join-Path $ProjectRoot "handoff" }
$MacBuildKit = (Resolve-Path -LiteralPath $MacBuildKit).Path
$OutputDir = (Resolve-Path -LiteralPath $OutputDir).Path

$packageName = "YDL-S4-Offline-Windows-x64-v$Version"
$stageRoot = Join-Path $OutputDir ".$packageName-build"
$packageRoot = Join-Path $stageRoot $packageName
$zipPath = Join-Path $OutputDir "$packageName.zip"
$zipHashPath = "$zipPath.sha256"
$macResources = Join-Path $MacBuildKit "payload\YDL S4 Offline.app\Contents\Resources"
$seedData = Join-Path $macResources "seed-data"
$seedProfiles = Join-Path $macResources "seed-player-profiles"
$nodeSource = (Get-Command node.exe -ErrorAction Stop).Source
$cscPath = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"

function Assert-ChildPath([string]$Parent, [string]$Child) {
  $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  $childFull = [IO.Path]::GetFullPath($Child)
  if (-not $childFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝操作输出目录之外的路径：$childFull"
  }
}

function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return -join ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") })
  } finally {
    $sha.Dispose()
    $stream.Dispose()
  }
}

Assert-ChildPath $OutputDir $stageRoot
Assert-ChildPath $OutputDir $zipPath
foreach ($required in @(
  (Join-Path $ProjectRoot "devtool\public-server.js"),
  (Join-Path $ProjectRoot "node_modules\sharp"),
  (Join-Path $ProjectRoot "node_modules\@img\sharp-win32-x64"),
  (Join-Path $ProjectRoot "offline\windows\YdlOfflineLauncher.cs"),
  $seedData,
  $seedProfiles,
  $nodeSource,
  $cscPath
)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "缺少构建输入：$required" }
}

$runtimeInfo = & $nodeSource -p 'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})' | ConvertFrom-Json
if ($runtimeInfo.platform -ne "win32" -or $runtimeInfo.arch -ne "x64") { throw "构建机 Node 不是 Windows x64。" }
& $nodeSource --test (Join-Path $ProjectRoot "test\offline-attribute-settings.test.js")
if ($LASTEXITCODE -ne 0) { throw "离线属性上限三档验证失败。" }
& $nodeSource --input-type=module -e "const sharp=(await import('sharp')).default; await import('exceljs'); await sharp({create:{width:1,height:1,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).webp().toBuffer();"
if ($LASTEXITCODE -ne 0) { throw "本机 Windows 原生依赖自检失败。" }

if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $packageRoot | Out-Null
$appRoot = Join-Path $packageRoot "app"
New-Item -ItemType Directory -Path $appRoot,(Join-Path $packageRoot "runtime") | Out-Null

$sourceDirs = @("A_profile", "admin", "devtool", "game", "legendary_profile", "offline", "src", "versus", "x_profile")
foreach ($name in $sourceDirs) {
  $source = Join-Path $ProjectRoot $name
  if (-not (Test-Path -LiteralPath $source)) { throw "缺少源码目录：$source" }
  Copy-Item -LiteralPath $source -Destination (Join-Path $appRoot $name) -Recurse
}
foreach ($name in @("package.json", "package-lock.json")) {
  Copy-Item -LiteralPath (Join-Path $ProjectRoot $name) -Destination (Join-Path $appRoot $name)
}
Copy-Item -LiteralPath (Join-Path $ProjectRoot "node_modules") -Destination (Join-Path $appRoot "node_modules") -Recurse
Copy-Item -LiteralPath $seedData -Destination (Join-Path $packageRoot "seed-data") -Recurse
Copy-Item -LiteralPath $seedProfiles -Destination (Join-Path $packageRoot "seed-player-profiles") -Recurse
Copy-Item -LiteralPath $nodeSource -Destination (Join-Path $packageRoot "runtime\node.exe")

$windowsSource = Join-Path $ProjectRoot "offline\windows"
$launcherExe = Join-Path $packageRoot "YDL S4 Offline.exe"
$launcherSource = Join-Path $windowsSource "YdlOfflineLauncher.cs"
& $cscPath /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/out:$launcherExe" $launcherSource
if ($LASTEXITCODE -ne 0) { throw "Windows GUI 启动器编译失败。" }
Copy-Item -LiteralPath (Join-Path $windowsSource "launcher.ps1") -Destination (Join-Path $packageRoot "launcher.ps1")
Copy-Item -LiteralPath (Join-Path $windowsSource "start.cmd") -Destination (Join-Path $packageRoot "启动 YDL S4 Offline.cmd")
Copy-Item -LiteralPath (Join-Path $windowsSource "stop.cmd") -Destination (Join-Path $packageRoot "停止 YDL S4 Offline.cmd")
Copy-Item -LiteralPath (Join-Path $windowsSource "open-data.cmd") -Destination (Join-Path $packageRoot "打开存档目录.cmd")
Copy-Item -LiteralPath (Join-Path $windowsSource "self-test.mjs") -Destination (Join-Path $packageRoot "self-test.mjs")
Copy-Item -LiteralPath (Join-Path $windowsSource "self-test.cmd") -Destination (Join-Path $packageRoot "检测离线版.cmd")
Copy-Item -LiteralPath (Join-Path $ProjectRoot "offline\README-Windows离线版.md") -Destination (Join-Path $packageRoot "使用说明.md")

$macReport = Get-Content -LiteralPath (Join-Path $MacBuildKit "BUILD_REPORT.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$migration = Get-Content -LiteralPath (Join-Path $packageRoot "seed-data\OFFLINE_MIGRATION_REPORT.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$gitCommit = (& git -C $ProjectRoot rev-parse HEAD).Trim()
$gitDirty = [bool](& git -C $ProjectRoot status --porcelain)
$buildReport = [ordered]@{
  product = "YDL S4 Offline"
  version = $Version
  target = "Windows 10/11 x64"
  generatedAt = (Get-Date).ToString("o")
  source = [ordered]@{
    gitCommit = $gitCommit
    worktreeDirty = $gitDirty
    backupName = $macReport.sourceBackup.name
    backupSha256 = $macReport.sourceBackup.sha256
    seedGeneratedAt = $migration.generatedAt
  }
  preserved = $macReport.preserved
  removed = $macReport.removed
  runtime = [ordered]@{
    node = $runtimeInfo.version
    platform = "win32-x64"
    exceljs = "4.4.0"
    sharp = "0.35.3"
    offlineAttributeCap = [ordered]@{ default = "99 locked"; unlockedRates = @(1.0, 0.5, 0.3) }
  }
  verification = [ordered]@{
    buildDependencySmoke = $true
    packageSelfTest = $false
    offlineHealth = $false
    testedTeamSwitches = 0
    lineupPersistenceAfterRestart = $false
    friendBattleApiStatus = $null
    computeWorkerApiStatus = $null
    onlineRoomApiStatus = $null
    attributeCapModes = @("locked", "100%", "50%", "30%")
  }
}
$integrationJson = & (Join-Path $windowsSource "verify-built-package.ps1") -PackageRoot $packageRoot
$integration = ($integrationJson | Select-Object -Last 1) | ConvertFrom-Json
if (-not $integration.ok) { throw "Windows 成品集成验证失败。" }
$buildReport.verification.offlineHealth = [bool]$integration.offlineHealth
$buildReport.verification.testedTeamSwitches = [int]$integration.testedTeamSwitches
$buildReport.verification.lineupPersistenceAfterRestart = [bool]$integration.lineupPersistenceAfterRestart
$buildReport.verification.friendBattleApiStatus = [int]$integration.friendBattleApiStatus
$buildReport.verification.computeWorkerApiStatus = [int]$integration.computeWorkerApiStatus
$buildReport.verification.onlineRoomApiStatus = [int]$integration.onlineRoomApiStatus
$buildReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $packageRoot "BUILD_REPORT.json") -Encoding UTF8

Push-Location $packageRoot
try {
  & (Join-Path $packageRoot "runtime\node.exe") (Join-Path $packageRoot "self-test.mjs")
  if ($LASTEXITCODE -ne 0) { throw "成品目录自检失败。" }
} finally {
  Pop-Location
}
$buildReport.verification.packageSelfTest = $true
$buildReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $packageRoot "BUILD_REPORT.json") -Encoding UTF8

$hashLines = Get-ChildItem -LiteralPath $packageRoot -Recurse -File |
  Where-Object { $_.Name -ne "SHA256SUMS.txt" } |
  Sort-Object FullName |
  ForEach-Object {
    $relative = $_.FullName.Substring($packageRoot.Length + 1).Replace('\', '/')
    $hash = Get-Sha256 $_.FullName
    "$hash  $relative"
  }
$hashLines | Set-Content -LiteralPath (Join-Path $packageRoot "SHA256SUMS.txt") -Encoding UTF8

if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
if (Test-Path -LiteralPath $zipHashPath) { Remove-Item -LiteralPath $zipHashPath -Force }
Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal
$zipHash = Get-Sha256 $zipPath
"$zipHash  $([IO.Path]::GetFileName($zipPath))" | Set-Content -LiteralPath $zipHashPath -Encoding ASCII

Write-Host "已生成：$zipPath" -ForegroundColor Green
Write-Host "SHA-256：$zipHash" -ForegroundColor Green
Write-Host "构建目录：$packageRoot"
