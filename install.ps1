<#
.SYNOPSIS
Copy the it-diagrams skill into a project for OpenAI Codex (.agents/skills) or, as a
documented fallback, for Claude Code without the plugin (.claude/skills).

.EXAMPLE
powershell -ExecutionPolicy Bypass -File install.ps1 -Target codex -Dest C:\work\my-project

Exit codes: 0 installed or already up to date, 1 usage or I/O error,
            3 the installed copy is newer than this source.
The script only copies files. It never runs npm, never touches the network, and never
deletes an existing install: a differing destination is moved to <dest>.bak-<timestamp>.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('codex', 'claude-project')][string]$Target,
  [string]$Dest = (Get-Location).Path
)
$ErrorActionPreference = 'Stop'

$subdir = if ($Target -eq 'codex') { '.agents\skills' } else { '.claude\skills' }
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $scriptDir 'skills\it-diagrams'
$manifest = Join-Path $scriptDir '.claude-plugin\plugin.json'
$marker = '.it-diagrams-version'

if (-not (Test-Path (Join-Path $src 'SKILL.md'))) { Write-Error "Source skill not found at $src"; exit 1 }
if (-not (Test-Path $manifest)) { Write-Error "Manifest not found at $manifest"; exit 1 }

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
$destSkill = Join-Path $destDir 'it-diagrams'
$markerPath = Join-Path $destSkill $marker

if (Test-Path $markerPath) {
  $installed = (Get-Content $markerPath -First 1).Trim()
  if (-not (Test-ReleaseVersion $installed)) {
    Write-Error "Installed version marker '$installed' at $markerPath is not a release version; refusing to compare. Remove the folder by hand to reinstall."
    exit 1
  }
  switch (Compare-Versions $srcVersion $installed) {
    0  { Write-Output "it-diagrams $installed already up to date at $destSkill"; exit 0 }
    -1 { Write-Error "Installed it-diagrams $installed at $destSkill is newer than this source ($srcVersion); not downgrading."; exit 3 }
    1  { Write-Output "Upgrading it-diagrams $installed -> $srcVersion at $destSkill" }
  }
} elseif (Test-Path $destSkill) {
  Write-Output "Existing folder without a version marker at $destSkill; it will be backed up and replaced."
} else {
  Write-Output "Installing it-diagrams $srcVersion to $destSkill"
}

New-Item -ItemType Directory -Force -Path $destDir | Out-Null
$tmp = Join-Path $destDir ".it-diagrams.tmp-$PID"
try {
  Get-ChildItem -Path $destDir -Directory -Filter '.it-diagrams.tmp-*' -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
  New-Item -ItemType Directory -Path $tmp | Out-Null
  Get-ChildItem -Path $src -Force | Where-Object { $_.Name -ne 'node_modules' } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $tmp -Recurse -Force
  }
  Get-ChildItem -Path $tmp -Recurse -Directory -Filter node_modules -Force | Remove-Item -Recurse -Force
  Set-Content -Path (Join-Path $tmp $marker) -Value $srcVersion -NoNewline
  Add-Content -Path (Join-Path $tmp $marker) -Value ""

  if (Test-Path $destSkill) {
    $bak = "$destSkill.bak-$(Get-Date -Format 'yyyyMMddHHmmss')"
    Move-Item -Path $destSkill -Destination $bak
    Write-Output "Previous install moved to $bak"
  }
  Move-Item -Path $tmp -Destination $destSkill
} finally {
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
}

Write-Output "Installed it-diagrams $srcVersion to $destSkill"
if ($Target -eq 'claude-project') {
  Write-Warning "This is the fallback channel. If the it-diagrams plugin is also installed, two skills with the same name compete for routing; use one channel per machine."
}
