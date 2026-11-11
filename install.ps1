<#
.SYNOPSIS
Copy the Zukai skills into a project for OpenAI Codex (.agents/skills) or, as a
documented fallback, for Claude Code without the plugin (.claude/skills).

Inside the plugin the skills are named "draw" and "revise" (/zukai:draw, /zukai:revise).
A copied skill has no plugin namespace, so the copies are installed as "zukai" and
"zukai-revise": the folder and the "name" line of each SKILL.md take that name ($zukai and
$zukai-revise in Codex, /zukai and /zukai-revise in Claude Code). revise finds the draw
skill's CLI in the sibling zukai folder, so the two are always installed together.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File install.ps1 -Target codex -Dest C:\work\my-project

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
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('codex', 'claude-project')][string]$Target,
  [string]$Dest = (Get-Location).Path
)
$ErrorActionPreference = 'Stop'

$subdir = if ($Target -eq 'codex') { '.agents\skills' } else { '.claude\skills' }
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Join-Path $scriptDir '.claude-plugin\plugin.json'
$skills = @(
  @{ Source = 'draw'; Name = 'zukai'; Marker = '.zukai-version' },
  @{ Source = 'revise'; Name = 'zukai-revise'; Marker = '.zukai-revise-version' }
)
# The name the draw skill was installed under before it was renamed.
$legacyName = 'it-diagrams'
$legacyMarker = '.it-diagrams-version'

if (-not (Test-Path $manifest)) { Write-Error "Manifest not found at $manifest"; exit 1 }
foreach ($s in $skills) {
  $s.Src = Join-Path $scriptDir ('skills\' + $s.Source)
  if (-not (Test-Path (Join-Path $s.Src 'SKILL.md'))) { Write-Error "Source skill not found at $($s.Src)"; exit 1 }
}

$srcVersion = (Get-Content $manifest -Raw | ConvertFrom-Json).version
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
  Write-Error "Source version '$srcVersion' is not a release version (expected MAJOR.MINOR.PATCH, no prerelease suffix)."
  exit 1
}
if (-not (Test-Path $Dest -PathType Container)) { Write-Error "Destination project directory does not exist: $Dest"; exit 1 }
$destRoot = (Resolve-Path $Dest).Path
$destDir = Join-Path $destRoot $subdir
$legacySkill = Join-Path $destDir $legacyName
$backupDir = Join-Path (Split-Path -Parent $destDir) 'zukai-backups'

# Move a folder out of the skills folder and return where it went.
function Move-ToBackup([string]$Path, [string]$Name) {
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  $target = Join-Path $backupDir $Name
  $n = 1
  while (Test-Path $target) { $n++; $target = Join-Path $backupDir "$Name-$n" }
  Move-Item -Path $Path -Destination $target
  return $target
}

# Backups that an earlier version of this script left inside the skills folder
# (<name>.bak-<timestamp>) still carry a SKILL.md with the skill's name: move them out too.
function Move-OldBackups {
  foreach ($name in @('zukai', 'zukai-revise', $legacyName)) {
    Get-ChildItem -Path $destDir -Directory -Filter "$name.bak-*" -Force -ErrorAction SilentlyContinue | ForEach-Object {
      $stamp = $_.Name.Substring(("$name.bak-").Length)
      Write-Output "Backup from an earlier install moved out of the skills folder: $(Move-ToBackup $_.FullName "$name-$stamp")"
    }
  }
}

# Decide for both skills before touching anything. A copy already at this version is left
# alone (backing it up would leave a second copy with the same name competing for routing);
# the others are installed.
$todo = @()
foreach ($s in $skills) {
  $s.Dest = Join-Path $destDir $s.Name
  $markerPath = Join-Path $s.Dest $s.Marker
  if (Test-Path $markerPath) {
    $installed = (Get-Content $markerPath -First 1).Trim()
    if (-not (Test-ReleaseVersion $installed)) {
      Write-Error "Installed version marker '$installed' at $markerPath is not a release version; refusing to compare. Remove the folder by hand to reinstall."
      exit 1
    }
    switch (Compare-Versions $srcVersion $installed) {
      0  { }
      # Written to stderr directly: Write-Error under 'Stop' would end the script with exit 1.
      -1 { [Console]::Error.WriteLine("Installed $($s.Name) $installed at $($s.Dest) is newer than this source ($srcVersion); not downgrading."); exit 3 }
      1  { $todo += $s; Write-Output "Upgrading $($s.Name) $installed -> $srcVersion at $($s.Dest)" }
    }
  } elseif (Test-Path $s.Dest) {
    $todo += $s
    Write-Output "Existing folder without a version marker at $($s.Dest); it will be backed up and replaced."
  } else {
    $todo += $s
    Write-Output "Installing $($s.Name) $srcVersion to $($s.Dest)"
  }
}
if ($todo.Count -eq 0) {
  Move-OldBackups
  Write-Output "zukai $srcVersion already up to date at $destDir (zukai, zukai-revise)"
  exit 0
}

New-Item -ItemType Directory -Force -Path $destDir | Out-Null
$tmp = Join-Path $destDir ".zukai.tmp-$PID"
try {
  # Copy into a temporary sibling first so an interrupted copy never leaves a half install.
  Get-ChildItem -Path $destDir -Directory -Filter '.zukai.tmp-*' -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $utf8 = New-Object System.Text.UTF8Encoding $false
  foreach ($s in $todo) {
    $copy = Join-Path $tmp $s.Name
    New-Item -ItemType Directory -Path $copy | Out-Null
    Get-ChildItem -Path $s.Src -Force | Where-Object { $_.Name -ne 'node_modules' } | ForEach-Object {
      Copy-Item -Path $_.FullName -Destination $copy -Recurse -Force
    }
    Get-ChildItem -Path $copy -Recurse -Directory -Filter node_modules -Force | Remove-Item -Recurse -Force
    # The CLI runs from its bundle; what only a rebuild or a test needs stays in the repository.
    # The feature matrix is the one source file the skill text points at.
    $scripts = Join-Path $copy 'scripts'
    if (Test-Path (Join-Path $scripts 'src')) {
      $matrix = [System.IO.File]::ReadAllBytes((Join-Path $scripts 'src\feature-matrix.json'))
      foreach ($dev in @('src', 'tests', 'fixtures', 'tools', 'build.mjs', 'package-lock.json')) {
        $devPath = Join-Path $scripts $dev
        if (Test-Path $devPath) { Remove-Item -Recurse -Force $devPath }
      }
      New-Item -ItemType Directory -Path (Join-Path $scripts 'src') | Out-Null
      [System.IO.File]::WriteAllBytes((Join-Path $scripts 'src\feature-matrix.json'), $matrix)
    }
    Set-Content -Path (Join-Path $copy $s.Marker) -Value $srcVersion -NoNewline
    Add-Content -Path (Join-Path $copy $s.Marker) -Value ""

    # Name the copy after its folder: a skill's name has to match the directory it lives in.
    # Written through .NET so Windows PowerShell adds no byte-order mark before the frontmatter.
    $skillFile = Join-Path $copy 'SKILL.md'
    $skillText = [System.IO.File]::ReadAllText($skillFile, $utf8)
    $namePattern = "(?m)^name: $($s.Source)(?=\r?$)"
    if ($skillText -notmatch $namePattern) {
      Write-Error "SKILL.md at $($s.Src) does not declare 'name: $($s.Source)'; refusing to install a copy with the wrong name."
      exit 1
    }
    [System.IO.File]::WriteAllText($skillFile, ($skillText -replace $namePattern, "name: $($s.Name)"), $utf8)
  }

  $stamp = Get-Date -Format 'yyyyMMddHHmmss'
  # A copy installed under the old name would compete with this one for routing. Move it
  # aside only when its version marker shows this installer wrote it.
  if (Test-Path (Join-Path $legacySkill $legacyMarker)) {
    Write-Output "Install under the old name moved to $(Move-ToBackup $legacySkill "$legacyName-$stamp")"
  }
  Move-OldBackups

  # Both copies are complete before either is moved in; only a failure between these moves
  # (a locked folder) can leave one updated, and running the installer again finishes the job.
  foreach ($s in $todo) {
    if (Test-Path $s.Dest) {
      Write-Output "Previous install of $($s.Name) moved to $(Move-ToBackup $s.Dest "$($s.Name)-$stamp")"
    }
    Move-Item -Path (Join-Path $tmp $s.Name) -Destination $s.Dest
    Write-Output "Installed $($s.Name) $srcVersion to $($s.Dest)"
  }
} finally {
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
}

if ($Target -eq 'claude-project') {
  Write-Warning "This is the fallback channel. If the zukai plugin is also installed, two copies of the same skills compete for routing; use one channel per machine."
}
