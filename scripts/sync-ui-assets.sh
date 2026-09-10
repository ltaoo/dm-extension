#!/usr/bin/env bash
set -euo pipefail
extension_dir="$(cd "$(dirname "$0")/.." && pwd)"
frontend_dir="$extension_dir/.."
vendor_dir="$extension_dir/assets/vendor"
mkdir -p "$vendor_dir/src" "$vendor_dir/public"
cp "$frontend_dir/src/dmui.js" "$frontend_dir/src/dmui.css" "$vendor_dir/src/"
for runtime in timeless timeless.dom timeless.web; do
  cp "$frontend_dir/public/timeless/0.33.0/$runtime.umd.min.js" "$vendor_dir/"
done
for icon in logo-watermark logo-watermark-broken logo-watermark-loading logo-watermark-empty logo-watermark-error; do
  cp "$frontend_dir/public/$icon.svg" "$vendor_dir/public/"
done
