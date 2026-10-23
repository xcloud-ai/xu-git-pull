#!/bin/bash
# xu-git-pull 构建脚本：src/main.js（源码）→ main.js（发版产物，isogit 内联零 require 依赖）
# 每次改完 src/main.js 后必须运行本脚本再测试/发版
set -e
cd "$(dirname "$0")"
npx --no-install esbuild src/main.js \
  --bundle \
  --external:obsidian \
  --format=cjs \
  --platform=browser \
  --target=es2020 \
  --charset=utf8 \
  --minify \
  --outfile=main.js
echo "BUILD OK: main.js ($(du -h main.js | cut -f1))"
