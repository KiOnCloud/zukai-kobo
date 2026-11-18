<#
.SYNOPSIS
Copy the Zukai skills into a project for OpenAI Codex (.agents/skills) or, as a
documented fallback, for Claude Code without the plugin (.claude/skills).

Inside the plugin the skills are named "draw", "revise", "recook", "sync", "labs" and
"report" (/zukai:draw, /zukai:revise, /zukai:recook, /zukai:sync, /zukai:labs,
/zukai:report). A copied skill has no plugin namespace, so the copies are installed as
"zukai", "zukai-revise", "zukai-recook", "zukai-sync", "zukai-labs" and "zukai-report":
the folder and the "name" line of each SKILL.md take that name ($zukai, $zukai-revise,
$zukai-recook, $zukai-sync, $zukai-labs and $zukai-report in Codex, /zukai,
/zukai-revise, /zukai-recook, /zukai-sync, /zukai-labs and /zukai-report in Claude Code).
revise, recook, sync, labs and report find the draw skill's CLI in the sibling zukai
folder, sync reads the draft rules of zukai-revise, labs carries out its jobs with the
other five, and the CLI reads the built-in report templates from zukai-report/templates,
so the six are always installed together.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File install.ps1 -Target codex -Dest C:\work\my-project

Usage: install.ps1 -Target codex|claude-project [-Dest <project-dir>]

Exit codes: 0 installed or already up to date, 1 usage or I/O error,
            3 the installed copy is newer than this source.
The script only copies files. It never runs npm, never touches the network, and never
deletes an existing install: a differing destination is moved out of the skills folder, to
<project>\.agents\zukai-backups\<name>-<timestamp> (.claude\zukai-backups for claude-project).
A backup left inside the skills folder would still be a skill named zukai, and two skills
with one name compete for routing.

The copy holds what the skills run with: SKILL.md, references\, the bundled CLI
(scripts\bin\cli.mjs) and the feature matrix. The sources, tests and fixtures of the CLI
stay in the repository.
#>
param(
  [string]$Target = '',
  [string]$Dest = ''
)
$ErrorActionPreference = 'Stop'

# Messages for the user go to stderr as plain lines, and the exit code is set here: an error
# record would print the script's own source around the message.
function Stop-Install([string]$Message, [int]$Code = 1) {
  [Console]::Error.WriteLine($Message)
  exit $Code
}
function Stop-WithUsage([string]$Message = '') {
  if ($Message) { [Console]::Error.WriteLine($Message) }
  Stop-Install 'Usage: install.ps1 -Target codex|claude-project [-Dest <project-dir>]'
}

if ($args.Count -gt 0) { Stop-WithUsage "Unknown argument: $($args[0])" }
# Paths are always taken literally (-LiteralPath, .NET): a folder named "[client] app" is a
# folder, not a wildcard pattern.
if ($Target -ceq 'codex') { $subdir = Join-Path '.agents' 'skills' }
elseif ($Target -ceq 'claude-project') { $subdir = Join-Path '.claude' 'skills' }
else { Stop-WithUsage }
if ($Dest -eq '') { $Dest = (Get-Location).ProviderPath }

# Resolve the source from the script's own location, never from the working directory.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Join-Path (Join-Path $scriptDir '.claude-plugin') 'plugin.json'
$skills = @(
  @{ Source = 'draw'; Name = 'zukai'; Marker = '.zukai-version' },
  @{ Source = 'revise'; Name = 'zukai-revise'; Marker = '.zukai-revise-version' },
  @{ Source = 'recook'; Name = 'zukai-recook'; Marker = '.zukai-recook-version' },
  @{ Source = 'sync'; Name = 'zukai-sync'; Marker = '.zukai-sync-version' },
  @{ Source = 'labs'; Name = 'zukai-labs'; Marker = '.zukai-labs-version' },
  @{ Source = 'report'; Name = 'zukai-report'; Marker = '.zukai-report-version' }
)
# The name the draw skill was installed under before it was renamed.
$legacyName = 'it-diagrams'
$legacyMarker = '.it-diagrams-version'
# What only a rebuild or a test of the CLI needs; it stays in the repository.
$devOnly = @('src', 'tests', 'fixtures', 'tools', 'build.mjs', 'vitest.config.mjs', 'package-lock.json')

if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { Stop-Install "Manifest not found at $manifest" }
foreach ($s in $skills) {
  $s.Src = Join-Path (Join-Path $scriptDir 'skills') $s.Source
  if (-not (Test-Path -LiteralPath (Join-Path $s.Src 'SKILL.md') -PathType Leaf)) { Stop-Install "Source skill not found at $($s.Src)" }
}

$srcVersion = ''
try { $srcVersion = [string](Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).version } catch { $srcVersion = '' }
function Test-ReleaseVersion([string]$v) { return $v -match '^[0-9]+\.[0-9]+\.[0-9]+$' }
function Compare-Versions([string]$a, [string]$b) {
  $x = $a.Split('.') | ForEach-Object { [int]$_ }
  $y = $b.Split('.') | ForEach-Object { [int]$_ }
  for ($i = 0; $i -lt 3; $i++) {
    if ($x[$i] -lt $y[$i]) { return -1 }
    if ($x[$i] -gt $y[$i]) { return 1 }
  }
  return 0
}

if (-not (Test-ReleaseVersion $srcVersion)) {
  Stop-Install "Source version '$srcVersion' is not a release version (expected MAJOR.MINOR.PATCH, no prerelease suffix)."
}
if (-not (Test-Path -LiteralPath $Dest -PathType Container)) { Stop-Install "Destination project directory does not exist: $Dest" }
$destRoot = (Resolve-Path -LiteralPath $Dest).ProviderPath
$destDir = Join-Path $destRoot $subdir
$legacySkill = Join-Path $destDir $legacyName
$backupDir = Join-Path (Split-Path -Parent $destDir) 'zukai-backups'

# Move a folder out of the skills folder and return where it went.
function Move-ToBackup([string]$Path, [string]$Name) {
  [System.IO.Directory]::CreateDirectory($backupDir) | Out-Null
  $target = Join-Path $backupDir $Name
  $n = 1
  while (Test-Path -LiteralPath $target) { $n++; $target = Join-Path $backupDir "$Name-$n" }
  Move-Item -LiteralPath $Path -Destination $target
  return $target
}

# Backups that an earlier version of this script left inside the skills folder
# (<name>.bak-<timestamp>) still carry a SKILL.md with the skill's name: move them out too.
function Move-OldBackups {
  if (-not (Test-Path -LiteralPath $destDir -PathType Container)) { return }
  foreach ($name in @('zukai', 'zukai-revise', 'zukai-recook', 'zukai-sync', 'zukai-labs', 'zukai-report', $legacyName)) {
    $prefix = "$name.bak-"
    Get-ChildItem -LiteralPath $destDir -Directory -Force | Where-Object { $_.Name.StartsWith($prefix, [System.StringComparison]::Ordinal) } | Sort-Object Name | ForEach-Object {
      $stamp = $_.Name.Substring($prefix.Length)
      Write-Output "Backup from an earlier install moved out of the skills folder: $(Move-ToBackup $_.FullName "$name-$stamp")"
    }
  }
}

# Copy a folder byte for byte, without any node_modules folder in it and without the entries
# of its top level named in $Skip. Nothing is copied only to be deleted again: a dependency
# tree is hundreds of megabytes, with paths longer than Windows PowerShell can remove.
function Copy-Tree([string]$From, [string]$To, [string[]]$Skip = @()) {
  [System.IO.Directory]::CreateDirectory($To) | Out-Null
  foreach ($entry in Get-ChildItem -LiteralPath $From -Force) {
    if ($entry.Name -ceq 'node_modules' -or $Skip -ccontains $entry.Name) { continue }
    $target = Join-Path $To $entry.Name
    if ($entry.PSIsContainer) { Copy-Tree $entry.FullName $target }
    else { [System.IO.File]::Copy($entry.FullName, $target, $true) }
  }
}

# Decide for every skill before touching anything. A copy already at this version is left
# alone (backing it up would leave a second copy with the same name competing for routing);
# the others are installed.
$todo = @()
foreach ($s in $skills) {
  $s.Dest = Join-Path $destDir $s.Name
  $markerPath = Join-Path $s.Dest $s.Marker
  if (Test-Path -LiteralPath $markerPath -PathType Leaf) {
    # The first line without its white space; an empty file has none.
    $installed = (([string](@(Get-Content -LiteralPath $markerPath -TotalCount 1) + '')[0]) -replace '\s', '')
    if (-not (Test-ReleaseVersion $installed)) {
      Stop-Install "Installed version marker '$installed' at $markerPath is not a release version; refusing to compare. Remove the folder by hand to reinstall."
    }
    $order = Compare-Versions $srcVersion $installed
    if ($order -eq 0) { continue }
    if ($order -lt 0) { Stop-Install "Installed $($s.Name) at $($s.Dest) is newer than this source ($srcVersion); not downgrading." 3 }
    Write-Output "Upgrading $($s.Name) -> $srcVersion at $($s.Dest)"
  } elseif (Test-Path -LiteralPath $s.Dest) {
    Write-Output "Existing folder without a version marker at $($s.Dest); it will be backed up and replaced."
  } else {
    Write-Output "Installing $($s.Name) $srcVersion to $($s.Dest)"
  }
  $todo += $s
}
if ($todo.Count -eq 0) {
  Move-OldBackups
  Write-Output "zukai $srcVersion already up to date at $destDir (zukai, zukai-revise, zukai-recook, zukai-sync, zukai-labs, zukai-report)"
  exit 0
}

[System.IO.Directory]::CreateDirectory($destDir) | Out-Null
$tmp = Join-Path $destDir ".zukai.tmp-$PID"
try {
  # Copy into a temporary sibling first so an interrupted copy never leaves a half install.
  # Temporary siblings are only ever created by this script, so stale ones from a killed run are safe to drop.
  Get-ChildItem -LiteralPath $destDir -Force | Where-Object { $_.Name.StartsWith('.zukai.tmp-', [System.StringComparison]::Ordinal) } | ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Recurse -Force
  }
  # Written through .NET: no byte-order mark before the frontmatter and no CRLF from the
  # platform, so a copy is the same bytes whichever installer wrote it.
  $utf8 = New-Object System.Text.UTF8Encoding $false
  foreach ($s in $todo) {
    $copy = Join-Path $tmp $s.Name
    # The CLI runs from its bundle; what only a rebuild or a test needs stays in the repository.
    # The feature matrix is the one source file the skill text points at.
    $scripts = Join-Path $s.Src 'scripts'
    if (Test-Path -LiteralPath (Join-Path $scripts 'src') -PathType Container) {
      Copy-Tree $s.Src $copy @('scripts')
      Copy-Tree $scripts (Join-Path $copy 'scripts') $devOnly
      $matrixDir = Join-Path (Join-Path $copy 'scripts') 'src'
      [System.IO.Directory]::CreateDirectory($matrixDir) | Out-Null
      [System.IO.File]::Copy((Join-Path (Join-Path $scripts 'src') 'feature-matrix.json'), (Join-Path $matrixDir 'feature-matrix.json'), $true)
    } else {
      Copy-Tree $s.Src $copy
    }
    [System.IO.File]::WriteAllText((Join-Path $copy $s.Marker), "$srcVersion`n", $utf8)

    # Name the copy after its folder: a skill's name has to match the directory it lives in.
    $skillFile = Join-Path $copy 'SKILL.md'
    $skillText = [System.IO.File]::ReadAllText($skillFile, $utf8)
    $namePattern = "(?m)^name: $($s.Source)(?=\r?$)"
    if ($skillText -cnotmatch $namePattern) {
      Stop-Install "SKILL.md at $($s.Src) does not declare 'name: $($s.Source)'; refusing to install a copy with the wrong name."
    }
    [System.IO.File]::WriteAllText($skillFile, ($skillText -creplace $namePattern, "name: $($s.Name)"), $utf8)
  }

  $stamp = Get-Date -Format 'yyyyMMddHHmmss'
  # A copy installed under the old name would compete with this one for routing. Move it
  # aside only when its version marker shows this installer wrote it.
  if (Test-Path -LiteralPath (Join-Path $legacySkill $legacyMarker) -PathType Leaf) {
    Write-Output "Install under the old name moved to $(Move-ToBackup $legacySkill "$legacyName-$stamp")"
  }
  Move-OldBackups

  # Every copy is complete before any is moved in; only a failure between these moves
  # (a locked folder) can leave one updated, and running the installer again finishes the job.
  foreach ($s in $todo) {
    if (Test-Path -LiteralPath $s.Dest) {
      Write-Output "Previous install of $($s.Name) moved to $(Move-ToBackup $s.Dest "$($s.Name)-$stamp")"
    }
    Move-Item -LiteralPath (Join-Path $tmp $s.Name) -Destination $s.Dest
    Write-Output "Installed $($s.Name) $srcVersion to $($s.Dest)"
  }
} finally {
  if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
}

if ($Target -eq 'claude-project') {
  [Console]::Error.WriteLine('Warning: this is the fallback channel. If the zukai plugin is also installed, two copies of the same skills compete for routing; use one channel per machine.')
}
