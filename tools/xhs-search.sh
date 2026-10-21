#!/usr/bin/env bash
# 小红书搜索（绕过 opencli 坏掉的站内搜索 UI）：直接开 search_result 页，从 DOM 取卡片。
# 用法：bash tools/xhs-search.sh "关键词" [数量]
set -euo pipefail
q="${1:?usage: xhs-search.sh \"query\" [limit]}"
limit="${2:-10}"
dir="$(cd "$(dirname "$0")" && pwd)"
enc=$(python -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$q")
opencli browser open "https://www.xiaohongshu.com/search_result?source=web_explore_feed&keyword=$enc" \
  --session "${XHS_SESSION:-xhs}" --window background >/dev/null
sleep 4
js=$(cat "$dir/xhs-extract.js")
js="${js//__LIMIT__/$limit}"
opencli browser eval --session "${XHS_SESSION:-xhs}" "$js"
