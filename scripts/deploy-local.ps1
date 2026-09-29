# deploy-local.ps1 —— 把仓库里这份源码同步到你本机的 DSH profile。
#
# 用法（在仓库任意位置执行）：
#   pwsh -File scripts\deploy-local.ps1
#   pwsh -File scripts\deploy-local.ps1 -Profile desktop -WithPatch
#
# 说明：
#   - 默认只同步代码（index.js / client.js / package.json），**不动 cordis.patch.yml**，
#     因为那份是你的本机配置（defaultRoot / gitPath 等）。
#   - 同步前会备份到 $DSH_HOME\backups\dsh-branchman-<时间戳>\。
#   - 改插件**不会热重载**：同步完必须完全退出 DSH（含托盘）再启动。
param(
  [string]$Profile = 'desktop',
  # 连 cordis.patch.yml 一起覆盖（只有当你的本机配置与仓库版一致时才该这么做）
  [switch]$WithPatch
)
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
if (-not $env:DSH_HOME) { throw 'DSH_HOME 未设置（DSH 用户级环境变量）' }
$target = Join-Path $env:DSH_HOME "profiles\$Profile\node_modules\dsh-branchman"
if (-not (Test-Path $target)) {
  throw "目标不存在: $target`n先把插件装进该 profile（见 docs/INSTALL.md），再用本脚本同步。"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $env:DSH_HOME "backups\dsh-branchman-$stamp"
New-Item -ItemType Directory -Path $backup -Force | Out-Null

$files = @('index.js', 'client.js', 'package.json')
if ($WithPatch) { $files += 'cordis.patch.yml' }

Write-Host "仓库   : $repo"
Write-Host "目标   : $target"
Write-Host "备份   : $backup"
foreach ($f in $files) {
  $src = Join-Path $repo $f
  if (-not (Test-Path $src)) { throw "仓库里缺少 $f" }
  $dst = Join-Path $target $f
  if (Test-Path $dst) { Copy-Item $dst (Join-Path $backup $f) -Force }
  Copy-Item $src $dst -Force
  Write-Host ("  ✓ {0}" -f $f) -ForegroundColor Green
}
if (-not $WithPatch) {
  Write-Host "  - cordis.patch.yml 保持你本机那份（-WithPatch 可覆盖）" -ForegroundColor DarkGray
}

# 语法自检：同步坏文件比不同步更糟
foreach ($f in @('index.js', 'client.js')) {
  & node --check (Join-Path $target $f)
  if ($LASTEXITCODE -ne 0) { throw "$f 语法检查失败，已同步的文件不可用（备份在 $backup）" }
}
Write-Host "`n同步完成。现在**完全退出 DSH（含托盘图标）再启动**——插件代码不热重载。" -ForegroundColor Cyan
Write-Host "回滚：把 $backup 里的文件拷回 $target" -ForegroundColor DarkGray
