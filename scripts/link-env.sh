#!/bin/bash

# Create symlinks for .env files in subdirectories pointing to root .env

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_ENV="$ROOT_DIR/.env"

if [ ! -f "$ROOT_ENV" ]; then
    echo "Error: Root .env file not found: $ROOT_ENV"
    exit 1
fi

link_env() {
    local dir="$1"
    local target="$dir/.env"

    if [ -L "$target" ]; then
        echo "Skipped: $target (already a symlink)"
    elif [ -f "$target" ]; then
        echo "Warning: $target exists and is not a symlink, skipped"
    else
        ln -s "$ROOT_ENV" "$target"
        echo "Created: $target -> $ROOT_ENV"
    fi
}

# Link for apps/*/
if [ -d "$ROOT_DIR/apps" ]; then
    for dir in "$ROOT_DIR/apps"/*/; do
        [ -d "$dir" ] && link_env "${dir%/}"
    done
fi

# Link for packages/*/
if [ -d "$ROOT_DIR/packages" ]; then
    for dir in "$ROOT_DIR/packages"/*/; do
        [ -d "$dir" ] && link_env "${dir%/}"
    done
fi

echo "Done!"