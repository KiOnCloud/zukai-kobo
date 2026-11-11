#!/usr/bin/env sh
# Copy the Zukai skills into a project for OpenAI Codex (.agents/skills) or, as a
# documented fallback, for Claude Code without the plugin (.claude/skills).
#
# Inside the plugin the skills are named "draw" and "revise" (/zukai:draw, /zukai:revise).
# A copied skill has no plugin namespace, so the copies are installed as "zukai" and
# "zukai-revise": the folder and the "name" line of each SKILL.md take that name ($zukai and
# $zukai-revise in Codex, /zukai and /zukai-revise in Claude Code). revise finds the draw
# skill's CLI in the sibling zukai folder, so the two are always installed together.
#
# Usage: install.sh --target codex|claude-project [--dest <project-dir>]
#
# Exit codes: 0 installed or already up to date, 1 usage or I/O error,
#             3 the installed copy is newer than this source.
#
# The script only copies files. It never runs npm, never touches the network, and never
# deletes an existing install: a differing destination is moved to <dest>.bak-<timestamp>.
set -eu

usage() {
  echo "Usage: $0 --target codex|claude-project [--dest <project-dir>]" >&2
  exit 1
}

TARGET=""
DEST_ROOT="$PWD"
while [ $# -gt 0 ]; do
  case "$1" in
    --target) [ $# -ge 2 ] || usage; TARGET="$2"; shift 2 ;;
    --dest)   [ $# -ge 2 ] || usage; DEST_ROOT="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown argument: $1" >&2; usage ;;
  esac
done

case "$TARGET" in
  codex)          SUBDIR=".agents/skills" ;;
  claude-project) SUBDIR=".claude/skills" ;;
  *) usage ;;
esac

# Resolve the source from the script's own location, never from the working directory.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
MANIFEST="$SCRIPT_DIR/.claude-plugin/plugin.json"
# Each skill as <source folder>:<installed name>:<version marker>.
SKILLS="draw:zukai:.zukai-version revise:zukai-revise:.zukai-revise-version"
# The name the draw skill was installed under before it was renamed.
LEGACY_NAME="it-diagrams"
LEGACY_MARKER=".it-diagrams-version"

[ -f "$MANIFEST" ] || { echo "Manifest not found at $MANIFEST" >&2; exit 1; }
for spec in $SKILLS; do
  src=${spec%%:*}
  [ -f "$SCRIPT_DIR/skills/$src/SKILL.md" ] || { echo "Source skill not found at $SCRIPT_DIR/skills/$src" >&2; exit 1; }
done

# Version from plugin.json without jq: first "version": "x.y.z" occurrence.
SRC_VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST" | head -n 1)

is_release_version() {
  printf '%s' "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'
}

# Prints -1, 0 or 1 for a < b, a == b, a > b, comparing each dotted field numerically.
compare_versions() {
  a1=${1%%.*}; rest=${1#*.}; a2=${rest%%.*}; a3=${rest#*.}
  b1=${2%%.*}; rest=${2#*.}; b2=${rest%%.*}; b3=${rest#*.}
  for pair in "$a1:$b1" "$a2:$b2" "$a3:$b3"; do
    x=${pair%%:*}; y=${pair#*:}
    if [ "$x" -lt "$y" ]; then echo -1; return; fi
    if [ "$x" -gt "$y" ]; then echo 1; return; fi
  done
  echo 0
}

# Prints missing, unmarked, same, older or newer for the install at $1 with marker $2.
install_state() {
  if [ -f "$1/$2" ]; then
    installed=$(head -n 1 "$1/$2" | tr -d '[:space:]')
    if ! is_release_version "$installed"; then
      echo "Installed version marker '$installed' at $1/$2 is not a release version; refusing to compare. Remove the folder by hand to reinstall." >&2
      return 1
    fi
    case $(compare_versions "$SRC_VERSION" "$installed") in
      0)  echo "same" ;;
      -1) echo "newer" ;;
      1)  echo "older" ;;
    esac
  elif [ -e "$1" ]; then
    echo "unmarked"
  else
    echo "missing"
  fi
}

if ! is_release_version "$SRC_VERSION"; then
  echo "Source version '$SRC_VERSION' is not a release version (expected MAJOR.MINOR.PATCH, no prerelease suffix)." >&2
  exit 1
fi

[ -d "$DEST_ROOT" ] || { echo "Destination project directory does not exist: $DEST_ROOT" >&2; exit 1; }
DEST_ROOT=$(CDPATH= cd -- "$DEST_ROOT" && pwd -P)
DEST_DIR="$DEST_ROOT/$SUBDIR"
LEGACY="$DEST_DIR/$LEGACY_NAME"

# Decide for both skills before touching anything. A copy already at this version is left
# alone (backing it up would leave a second copy with the same name competing for routing);
# the others are installed.
TODO=""
for spec in $SKILLS; do
  rest=${spec#*:}; name=${rest%%:*}; marker=${rest#*:}
  state=$(install_state "$DEST_DIR/$name" "$marker") || exit 1
  case "$state" in
    newer)
      echo "Installed $name at $DEST_DIR/$name is newer than this source ($SRC_VERSION); not downgrading." >&2
      exit 3 ;;
    same) continue ;;
    older)    echo "Upgrading $name -> $SRC_VERSION at $DEST_DIR/$name" ;;
    unmarked) echo "Existing folder without a version marker at $DEST_DIR/$name; it will be backed up and replaced." ;;
    missing)  echo "Installing $name $SRC_VERSION to $DEST_DIR/$name" ;;
  esac
  TODO="$TODO $spec"
done
if [ -z "$TODO" ]; then
  echo "zukai $SRC_VERSION already up to date at $DEST_DIR (zukai, zukai-revise)"
  exit 0
fi

mkdir -p "$DEST_DIR"
TMP="$DEST_DIR/.zukai.tmp-$$"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

# Copy into a temporary sibling first so an interrupted copy never leaves a half install.
# Temporary siblings are only ever created by this script, so stale ones from a killed run are safe to drop.
for stale in "$DEST_DIR"/.zukai.tmp-*; do
  [ -e "$stale" ] && rm -rf "$stale"
done
for spec in $TODO; do
  src=${spec%%:*}; rest=${spec#*:}; name=${rest%%:*}; marker=${rest#*:}
  mkdir -p "$TMP/$name"
  ( cd "$SCRIPT_DIR/skills/$src" && tar -cf - --exclude=node_modules . ) | ( cd "$TMP/$name" && tar -xf - )
  printf '%s\n' "$SRC_VERSION" > "$TMP/$name/$marker"
  # Name the copy after its folder: a skill's name has to match the directory it lives in.
  grep -q "^name: $src\$" "$TMP/$name/SKILL.md" || { echo "SKILL.md at $SCRIPT_DIR/skills/$src does not declare 'name: $src'; refusing to install a copy with the wrong name." >&2; exit 1; }
  sed "s/^name: $src\$/name: $name/" "$TMP/$name/SKILL.md" > "$TMP/$name/SKILL.md.renamed"
  mv "$TMP/$name/SKILL.md.renamed" "$TMP/$name/SKILL.md"
done

STAMP=$(date +%Y%m%d%H%M%S)
# A copy installed under the old name would compete with this one for routing. Move it
# aside only when its version marker shows this installer wrote it.
if [ -f "$LEGACY/$LEGACY_MARKER" ]; then
  mv "$LEGACY" "$LEGACY.bak-$STAMP"
  echo "Install under the old name moved to $LEGACY.bak-$STAMP"
fi

# Both copies are complete before either is moved in; only a failure between these moves
# (a locked folder) can leave one updated, and running the installer again finishes the job.
for spec in $TODO; do
  rest=${spec#*:}; name=${rest%%:*}
  if [ -e "$DEST_DIR/$name" ]; then
    mv "$DEST_DIR/$name" "$DEST_DIR/$name.bak-$STAMP"
    echo "Previous install of $name moved to $DEST_DIR/$name.bak-$STAMP"
  fi
  mv "$TMP/$name" "$DEST_DIR/$name"
  echo "Installed $name $SRC_VERSION to $DEST_DIR/$name"
done
rm -rf "$TMP"
trap - EXIT INT TERM

if [ "$TARGET" = "claude-project" ]; then
  echo "Warning: this is the fallback channel. If the zukai plugin is also installed, two copies of the same skills compete for routing; use one channel per machine." >&2
fi
