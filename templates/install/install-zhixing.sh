#!/usr/bin/env sh
set -eu
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' '未找到 Node.js。请先安装 Node.js 22 或更高版本。'
  exit 1
fi
node -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)" || {
  printf '%s\n' 'Node.js 版本过低。请升级到 22 或更高版本。'
  exit 1
}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -gt 0 ]; then
  vault=$1
else
  printf '%s' '请输入 Obsidian Vault 文件夹路径: '
  read -r vault
fi
node "$script_dir/scripts/zhixing.mjs" install --vault "$vault"
