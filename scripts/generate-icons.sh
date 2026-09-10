#!/usr/bin/env bash
set -euo pipefail

extension_dir="$(cd "$(dirname "$0")/.." && pwd)"
icon_dir="$extension_dir/assets/icons"
mkdir -p "$icon_dir"
cp "$extension_dir/../public/logo.svg" "$icon_dir/logo.svg"

png_files=()
for size in 16 24 32 48 64 128 256; do
  rsvg-convert --width "$size" --height "$size" --output "$icon_dir/icon-$size.png" "$icon_dir/logo.svg"
  magick "$icon_dir/icon-$size.png" "$icon_dir/icon-$size.ico"
  png_files+=("$icon_dir/icon-$size.png")
done
magick "${png_files[@]}" "$icon_dir/icon.ico"
