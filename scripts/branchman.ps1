# branchman.ps1 —— 工作区分支管理（方案：git worktree）
#
# 解决的问题：一个模糊工程要回到对话某节点试另一条走向时，
#   - 不同走向的 agent 会写同一工作区 → 打架
#   - 整目录克隆 → 繁琐且难同步主线
# git worktree：同一仓库多分支各自一个目录，merge/checkout 主线即同步。
#
# 用法（在任意目录执行，-Root 默认当前目录）：
#   branchman status                    查看主线与所有走向
#   branchman save  "说明"              把当前工作区改动提交到主线
#   branchman fork  <走向名> ["从哪分"]  从主线（或指定点）开新走向目录
#   branchman list  <走向名>            查看某走向的独立提交（相对主线）
#   branchman sync  <走向名>            把主线最新合入走向（走向不落伍）
#   branchman merge <走向名> ["说明"]    把走向成果合回主线（成功后可删）
#   branchman drop  <走向名>            删除走向（-KeepWork 保留其目录）
#
# 目录约定：<Root>\.branches\<走向名>\ 为该走向的 worktree 工作目录。

param(
  [Parameter(Position = 0, Mandatory = $true)]
  [ValidateSet('status', 'save', 'fork', 'list', 'sync', 'merge', 'drop')]
  [string]$Cmd,
  [Parameter(Position = 1)][string]$Name,
  [Parameter(Position = 2)][string]$Arg2,
  # Defaults to the current directory, so it works on any repository without
  # configuration. Pass -Root <path> to drive another checkout.
  [string]$Root = (Get-Location).Path,
  [switch]$KeepWork
)
$ErrorActionPreference = 'Stop'
# git is taken from PATH; override for portable installs that are not on PATH.
$Git = if ($env:GIT_PATH) { $env:GIT_PATH } else { 'git' }
$BR = Join-Path $Root '.branches'

function Fail($msg) { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }
function Ok($msg) { Write-Host "  ✓ $msg" -ForegroundColor Green }

Push-Location $Root
try {
  if (-not (Test-Path (Join-Path $Root '.git'))) { Fail "$Root 不是 git 仓。先在其目录执行: git init && git add -A && git commit" }
  $branchPrefix = 'branchman/'

  switch ($Cmd) {

    'status' {
      Write-Host "`n[主线 $Root]" -ForegroundColor Cyan
      & $Git -C $Root log --oneline -3
      $st = & $Git -C $Root status --porcelain
      if ($st) { Write-Host "  未提交改动 $($st.Count) 项 —— 建议 branchman save" -ForegroundColor Yellow }
      else { Ok '主线干净' }
      Write-Host "`n[走向 (.branches)]" -ForegroundColor Cyan
      $wts = & $Git -C $Root worktree list --porcelain
      # git 会输出正斜杠路径（/repo/.branches/xxx），先归一成反斜杠再比对
      # 注意：-like 是通配符不是正则，不能用 ^ 锚点（此处曾踩坑导致走向列表恒为空）
      $dirs = $wts | Where-Object { $_ -like 'worktree *' } |
        ForEach-Object { ($_ -replace '^worktree ', '') -replace '/', '\' } |
        Where-Object { $_ -like "$BR*" }
      if (-not $dirs) { Write-Host '  （无）' }
      foreach ($d in $dirs) {
        $n = Split-Path $d -Leaf
        $br = "$branchPrefix$n"
        $ahead = (& $Git -C $Root rev-list --count "main..$br" 2>$null)
        $behind = (& $Git -C $Root rev-list --count "$br..main" 2>$null)
        $dirty = (& $Git -C $d status --porcelain).Count
        Write-Host ("  {0,-18} 领先主线 {1} 提交 | 落后 {2} | 未提交 {3}" -f $n, $ahead, $behind, $dirty)
        Write-Host ("    目录: $d")
      }
    }

    'save' {
      if (-not $Name) { Fail '用法: branchman save "说明"' }
      $msg = if ($Arg2) { $Name + ' — ' + $Arg2 } else { $Name }
      & $Git -C $Root add -A
      $st = & $Git -C $Root status --porcelain
      if (-not $st) { Ok '没有需要提交的改动'; break }
      & $Git -C $Root -c user.name=mydsp -c user.email=2622868958@qq.com commit -m "save: $msg" | Select-Object -First 2
      Ok "主线已保存: $msg"
    }

    'fork' {
      if (-not $Name) { Fail '用法: branchman fork <走向名> ["从哪个提交/分支"]' }
      $branch = "$branchPrefix$Name"
      $wt = Join-Path $BR $Name
      if (Test-Path $wt) { Fail "走向目录已存在: $wt" }
      & $Git -C $Root status --porcelain | ForEach-Object { }
      $dirty = (& $Git -C $Root status --porcelain).Count
      if ($dirty -gt 0) { Fail "主线有 $dirty 项未提交改动。先 branchman save，再 fork（否则分叉点含糊）" }
      $base = if ($Arg2) { $Arg2 } else { 'main' }
      & $Git -C $Root worktree add -b $branch $wt $base 2>&1 | Select-Object -First 3
      if ($LASTEXITCODE -ne 0) { Fail "worktree 创建失败" }
      Write-Host "✓ 走向已建立" -ForegroundColor Green
      Write-Host "  分支:   $branch（基于 $base）"
      Write-Host "  目录:   $wt"
      Write-Host "  用法:   在 DSH 里为该走向新开会话时，把工作区指到上面目录;"
      Write-Host "          主会话留在 $Root 不动 —— 两边物理隔离，不会打架"
    }

    'list' {
      if (-not $Name) { Fail '用法: branchman list <走向名>' }
      $branch = "$branchPrefix$Name"
      Write-Host "`n[$Name 相对 main 的独立提交]" -ForegroundColor Cyan
      & $Git -C $Root log --oneline "main..$branch"
      if ($LASTEXITCODE -ne 0) { Fail "分支 $branch 不存在" }
      Write-Host "`n[main 相对该走向（走向落后部分）]"
      & $Git -C $Root log --oneline "$branch..main" | Select-Object -First 10
    }

    'sync' {
      if (-not $Name) { Fail '用法: branchman sync <走向名>' }
      $branch = "$branchPrefix$Name"
      $wt = Join-Path $BR $Name
      if (-not (Test-Path $wt)) { Fail "走向目录不存在: $wt" }
      $dirty = (& $Git -C $wt status --porcelain).Count
      if ($dirty -gt 0) { Fail "走向有 $dirty 项未提交改动，先在走向目录内提交再 sync" }
      & $Git -C $wt merge main --no-edit 2>&1 | Select-Object -First 6
      if ($LASTEXITCODE -ne 0) { Fail '合并冲突：在走向目录解决后 git add + git commit，再重跑本命令' }
      Ok "$Name 已吸收主线最新"
    }

    'merge' {
      if (-not $Name) { Fail '用法: branchman merge <走向名> ["说明"]' }
      $branch = "$branchPrefix$Name"
      $wt = Join-Path $BR $Name
      if (-not (Test-Path $wt)) { Fail "走向目录不存在: $wt" }
      $dirty = (& $Git -C $wt status --porcelain).Count
      if ($dirty -gt 0) { Fail "走向有 $dirty 项未提交改动，先在走向目录内提交" }
      $msg = if ($Arg2) { "merge: $Name — $Arg2" } else { "merge: 吸收走向 $Name 的成果" }
      & $Git -C $Root merge $branch --no-edit -m $msg 2>&1 | Select-Object -First 6
      if ($LASTEXITCODE -ne 0) { Fail '合并冲突：在主线解决后 git add + git commit' }
      Write-Host "✓ 已合回主线: $msg" -ForegroundColor Green
      Write-Host "  确认无误后可: branchman drop $Name"
    }

    'drop' {
      if (-not $Name) { Fail '用法: branchman drop <走向名> [-KeepWork]' }
      $branch = "$branchPrefix$Name"
      $wt = Join-Path $BR $Name
      $wtGit = $wt -replace '\\', '/'
      & $Git -C $Root worktree remove $wtGit --force 2>&1 | Out-Null
      # 目录已不存在时 remove 会失败，必须 prune 清注册记录（否则 status 幽灵列表）
      & $Git -C $Root worktree prune
      $stillThere = (& $Git -C $Root worktree list --porcelain) -match [regex]::Escape($wtGit)
      if (-not $stillThere) { Ok "worktree 注册已清除" } else { Fail "worktree 注册清除失败: $wtGit" }
      if ($KeepWork) { Ok "目录按需保留: $wt" }
      else {
        if (Test-Path $wt) { Remove-Item $wt -Recurse -Force; Ok "已删目录 $wt" }
      }
      & $Git -C $Root branch -D $branch 2>&1 | Out-Null
      Ok "已删分支 $branch"
    }
  }
}
finally { Pop-Location }
