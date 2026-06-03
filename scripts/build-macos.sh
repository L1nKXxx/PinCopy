#!/usr/bin/env bash
# 在 macOS 本机构建 Universal 安装包（Apple Silicon + Intel）
set -euo pipefail
cd "$(dirname "$0")/.."

rustup target add aarch64-apple-darwin x86_64-apple-darwin 2>/dev/null || true
npm ci
npm run tauri build -- --target universal-apple-darwin

echo ""
echo "构建完成，产物位置："
ls -la src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null || true
ls -d src-tauri/target/release/bundle/macos/*.app 2>/dev/null || true
