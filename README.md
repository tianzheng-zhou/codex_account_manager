# Codex 账号管理系统

管理从 chongzhi.art 兑换的 Claude Team / Plus 账号。支持一键密钥兑换、自动接收验证码。

## 功能

- **一键兑换** — 输入密钥，自动从 chongzhi.art 获取账号信息并录入
- **一键接码** — 自动登录收码邮箱，获取最新验证码
- **账号管理** — 增删改查、搜索筛选、状态管理、一键复制

## 技术栈

- **后端**: Python FastAPI + SQLite + httpx + BeautifulSoup4
- **前端**: HTML / CSS / JS，Claude-Inspired Design System 风格
- **数据库**: SQLite（零配置，本地文件）

## 快速开始

### 1. 创建虚拟环境并安装依赖

```bash
python -m venv venv
# Windows
.\venv\Scripts\pip.exe install -r backend\requirements.txt
# macOS / Linux
./venv/bin/pip install -r backend/requirements.txt
```

### 2. 启动服务

```bash
# Windows
.\start.bat
# macOS / Linux
./start.sh
```

或手动启动：

```bash
# Windows
.\venv\Scripts\python.exe backend\main.py
# macOS / Linux
./venv/bin/python backend/main.py
```

### 3. 访问

浏览器打开 http://127.0.0.1:25487

## 项目结构

```
codex_account_manager/
├── backend/
│   ├── main.py           # FastAPI 入口
│   ├── models.py         # 数据模型
│   ├── database.py       # 数据库连接
│   ├── schemas.py        # 数据校验
│   ├── scraper.py        # chongzhi.art 兑换/查回
│   ├── mailbox.py        # 收码邮箱接口
│   └── requirements.txt  # Python 依赖
├── frontend/
│   ├── index.html        # 主页面
│   ├── app.css           # 样式
│   └── app.js            # 交互逻辑
├── start.bat             # Windows 启动脚本
├── start.sh              # Linux/macOS 启动脚本
└── README.md
```

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/accounts` | 账号列表 |
| POST | `/api/accounts` | 手动添加 |
| POST | `/api/accounts/redeem` | 密钥兑换 |
| PUT | `/api/accounts/{id}` | 更新账号 |
| DELETE | `/api/accounts/{id}` | 删除账号 |
| GET | `/api/stats` | 统计数据 |
| POST | `/api/accounts/{id}/fetch-code` | 获取验证码 |
