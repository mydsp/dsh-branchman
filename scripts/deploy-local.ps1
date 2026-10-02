# deploy-local.ps1 —— 把仓库里这份源码打包校验后部署到本机 DSH profile。
#
# 用法（在仓库任意位置执行）：
#   pwsh -File scripts\deploy-local.ps1
#   pwsh -File scripts\deploy-local.ps1 -ProfileDir 'E:\tools\dsh-home\profiles\desktop'
#
# 2026-10-02 起不再自己 Copy-Item 再校验（S10）：统一转发给 dsh-tools 的发布工具。
# 旧流程「先覆盖 index.js/client.js/package.json，再 node --check」有故障窗口——
# 覆盖与校验之间、校验失败之后都留下半套文件。现在由 release.py 做 npm pack 真实产物
# 校验（files/exports/locale/CSP）并以「快照 → staging → rename → 失败整组回滚」事务落盘。
param(
  # 注意：不能叫 $Profile —— 那是 PowerShell 的保留自动变量（PS 5.1 会串值）
  [Alias('Profile')]
  [string]$ProfileDir = 'E:\tools\dsh-home\profiles\desktop',
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$python = (Get-Command python -ErrorAction Stop).Source
$release = 'E:\tools\dsh-tools\release.py'

if (-not (Test-Path (Join-Path $ProfileDir 'package.json'))) {
  throw "not a DSH profile: $ProfileDir"
}

# 1. 打包成 npm 产物（真实 tar，含 files/exports/locale/patch）
Push-Location $repo
$tarball = $null
try {
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
  $packed = (& npm pack --ignore-scripts --json --pack-destination $repo) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw 'npm pack failed' }
  $result = @($packed | ConvertFrom-Json)
  if ($result.Count -ne 1) { throw 'Expected one artifact' }
  $tarball = Join-Path $repo $result[0].filename
  # 2. 校验产物（先不落盘，CSP 禁令 / locale 缺失 / 客户端入口缺失都会在这里拦下）
  & $python $release validate --artifact $tarball
  if ($LASTEXITCODE -ne 0) { throw '产物校验失败，未落盘' }

  if ($ValidateOnly) { return }
  # 3. 事务化部署（校验通过才替换，失败自动整组回滚）
  & $python $release deploy --artifact $tarball --profile-dir $ProfileDir
  if ($LASTEXITCODE -ne 0) { throw '部署失败（已整组回滚）' }

  Write-Host 'Release is pending validation. Start DSH and complete desktop acceptance before finalizing.' -ForegroundColor Cyan
} finally {
  Pop-Location
  if ($tarball -and (Test-Path -LiteralPath $tarball)) { Remove-Item -LiteralPath $tarball -Force }
}
