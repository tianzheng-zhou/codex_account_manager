@echo off
chcp 65001 >nul
title Codex 账号管理系统
cd /d "%~dp0"

if not exist venv (
    echo 正在创建虚拟环境…
    python -m venv venv
    echo 正在安装依赖…
    .\venv\Scripts\pip.exe install -r backend\requirements.txt
)

echo.
echo  Codex 账号管理系统
echo  http://127.0.0.1:25487
echo.

.\venv\Scripts\python.exe backend\main.py
pause
