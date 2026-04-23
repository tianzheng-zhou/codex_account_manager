#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
    echo "正在创建虚拟环境…"
    python3 -m venv venv
    echo "正在安装依赖…"
    ./venv/bin/pip install -r backend/requirements.txt
fi

echo ""
echo "  Codex 账号管理系统"
echo "  http://127.0.0.1:25487"
echo ""

./venv/bin/python backend/main.py
