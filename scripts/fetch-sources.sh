#!/usr/bin/env bash
# Fetches all source repos into _sources/ (gitignored)
# Run once before Sprint 2 starts migrating code.
# All 6 source repos are PUBLIC on github.com/Narcis13/*
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p _sources

# --- Standard full shallow clones (main branch only) ------------------

clone_or_update() {
  local name="$1"
  local url="$2"
  local dir="_sources/$name"
  if [ ! -d "$dir" ]; then
    echo "→ Cloning $name from $url"
    git clone --depth 1 "$url" "$dir"
  else
    echo "→ Updating $name"
    git -C "$dir" pull --ff-only
  fi
}

clone_or_update docraftr  https://github.com/Narcis13/docraftr.git
clone_or_update glyphrail https://github.com/Narcis13/glyphrail.git
clone_or_update bunbase   https://github.com/Narcis13/bunbase.git
clone_or_update robun     https://github.com/Narcis13/robun.git
clone_or_update takt-brn  https://github.com/Narcis13/brn.git

# --- Sparse clone for alteramens (only wiki/ needed for faber) --------

FABER_DIR="_sources/alteramens"
if [ ! -d "$FABER_DIR" ]; then
  echo "→ Sparse cloning alteramens (wiki/ only)"
  git clone --depth 1 --filter=blob:none --sparse \
    https://github.com/Narcis13/alteramens.git "$FABER_DIR"
  git -C "$FABER_DIR" sparse-checkout set wiki
else
  echo "→ Updating alteramens (sparse)"
  git -C "$FABER_DIR" pull --ff-only
fi

# --- Summary ----------------------------------------------------------

echo ""
echo "Sources ready:"
ls -la _sources/
echo ""
echo "Commits fetched:"
for d in _sources/*/; do
  name=$(basename "$d")
  sha=$(git -C "$d" rev-parse --short HEAD 2>/dev/null || echo "n/a")
  echo "  $name: $sha"
done
