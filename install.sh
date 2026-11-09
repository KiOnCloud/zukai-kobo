#!/usr/bin/env sh
# Copy the it-diagrams skill into a project for OpenAI Codex (.agents/skills) or, as a
# documented fallback, for Claude Code without the plugin (.claude/skills).
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
SRC="$SCRIPT_DIR/skills/it-diagrams"
MANIFEST="$SCRIPT_DIR/.claude-plugin/plugin.json"
MARKER=".it-diagrams-version"

[ -f "$SRC/SKILL.md" ] || { echo "Source skill not found at $SRC" >&2; exit 1; }
[ -f "$MANIFEST" ] || { echo "Manifest not found at $MANIFEST" >&2; exit 1; }

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

if ! is_release_version "$SRC_VERSION"; then
  echo "Source version '$SRC_VERSION' is not a release version (expected MAJOR.MINOR.PATCH, no prerelease suffix)." >&2
  exit 1
fi

[ -d "$DEST_ROOT" ] || { echo "Destination project directory does not exist: $DEST_ROOT" >&2; exit 1; }
DEST_ROOT=$(CDPATH= cd -- "$DEST_ROOT" && pwd -P)
DEST="$DEST_ROOT/$SUBDIR/it-diagrams"

if [ -f "$DEST/$MARKER" ]; then
  INSTALLED=$(head -n 1 "$DEST/$MARKER" | tr -d '[:space:]')
  if ! is_release_version "$INSTALLED"; then
    echo "Installed version marker '$INSTALLED' at $DEST/$MARKER is not a release version; refusing to compare. Remove the folder by hand to reinstall." >&2
    exit 1
  fi
  case $(compare_versions "$SRC_VERSION" "$INSTALLED") in
    0)  echo "it-diagrams $INSTALLED already up to date at $DEST"; exit 0 ;;
    -1) echo "Installed it-diagrams $INSTALLED at $DEST is newer than this source ($SRC_VERSION); not downgrading." >&2; exit 3 ;;
    1)  echo "Upgrading it-diagrams $INSTALLED -> $SRC_VERSION at $DEST" ;;
  esac
elif [ -e "$DEST" ]; then
  echo "Existing folder without a version marker at $DEST; it will be backed up and replaced."
else
  echo "Installing it-diagrams $SRC_VERSION to $DEST"
fi

mkdir -p "$DEST_ROOT/$SUBDIR"
TMP="$DEST_ROOT/$SUBDIR/.it-diagrams.tmp-$$"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

# Copy into a temporary sibling first so an interrupted copy never leaves a half install.
# Temporary siblings are only ever created by this script, so stale ones from a killed run are safe to drop.
for stale in "$DEST_ROOT/$SUBDIR"/.it-diagrams.tmp-*; do
  [ -e "$stale" ] && rm -rf "$stale"
done
mkdir -p "$TMP"
( cd "$SRC" && tar -cf - --exclude=node_modules . ) | ( cd "$TMP" && tar -xf - )
printf '%s\n' "$SRC_VERSION" > "$TMP/$MARKER"

if [ -e "$DEST" ]; then
  BAK="$DEST.bak-$(date +%Y%m%d%H%M%S)"
  mv "$DEST" "$BAK"
  echo "Previous install moved to $BAK"
fi
mv "$TMP" "$DEST"
trap - EXIT INT TERM

echo "Installed it-diagrams $SRC_VERSION to $DEST"
if [ "$TARGET" = "claude-project" ]; then
  echo "Warning: this is the fallback channel. If the it-diagrams plugin is also installed, two skills with the same name compete for routing; use one channel per machine." >&2
fi
