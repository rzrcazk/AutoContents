# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 提供该代码库的工作指引。

## 项目简介

AutoContents 是基于 RSS 的 AI 资讯聚合与内容创作工具。从 RSS/RSSHub 信源抓取资讯，经 AI 翻译/筛选后推送至微信/飞书，支持生成小红书风格图片，并提供完整的 Agent 自动化接口。

## 常用命令

### 后端（Node.js + Express）

```bash
cd backend
npm install           # 安装依赖
npm start             # 启动服务（端口 3710）
npm run dev           # 启动并监视变更（Node.js --watch）
```

### 前端（React 18）

```bash
cd frontend
npm install           # 安装依赖
npm start             # 启动开发服务器（端口 3711）
npm run build         # 构建生产版本
```

### Docker 部署

```bash
docker compose -p makecontent up -d --build    # 构建并启动所有服务
docker compose -p makecontent logs -f makecontents  # 查看应用日志
docker compose -p makecontent logs -f rsshub        # 查看 RSSHub 日志
```

Docker Compose 包含：AutoContents（端口 3710）+ RSSHub（端口 1200）+ Redis。

### 本地一键启动

```bash
./start.sh            # 自动安装依赖、创建目录、启动前后端服务
```

访问地址：

- 前端：http://localhost:3711
- 后端 API：http://localhost:3710/api
- 健康检查：http://localhost:3710/api/health

## 架构说明

### 目录结构

```
backend/
├── db/
│   ├── database.js         # 统一数据库入口（支持 SQLite/PostgreSQL）
│   ├── pg-database.js      # PostgreSQL 实现
│   └── database-sqlite.js  # 原 SQLite 实现（备份）
├── routes/                 # API 路由
│   ├── sources.js          # RSS 信源管理
│   ├── news.js             # 资讯抓取/推送/保存
│   ├── config.js           # 系统配置
│   └── content.js          # 内容创作与渲染
├── services/               # 业务逻辑层
│   ├── rssService.js       # RSS 解析（rss-parser）
│   ├── llmService.js       # 大模型调用（OpenAI 兼容格式）
│   ├── feishuService.js    # 飞书知识库与机器人
│   ├── xhsService.js       # 小红书发布
│   ├── renderService.js    # 图片渲染（Puppeteer + Canvas）
│   └── wechatService.js    # 微信推送（已废弃）
├── data/                   # SQLite 数据库（运行时创建）
├── uploads/                # 上传图片与渲染产物
│   ├── images/             # 用户上传图片
│   └── rendered/           # 生成的封面图与详情图
└── index.js                # Express 入口（端口 3710）

frontend/src/
├── pages/
│   ├── HomePage.js     # 首页仪表板（分组展示资讯）
│   ├── SourcesPage.js  # RSS 信源管理
│   ├── ResourcePage.js # 资源库（已保存资讯与内容）
│   ├── ConfigPage.js   # 系统配置（LLM、飞书、小红书）
│   └── MakeContentPage.js # 内容创作与渲染
├── components/         # 布局组件、Toast 等
└── services/api.js     # API 客户端封装
```

### 环境变量

后端使用 `.env` 文件（参考 `.env.example`）：

```bash
PORT=3710                           # 服务端口
RSSHUB_URL=http://localhost:1200    # RSSHub 实例地址
NODE_ENV=development                # 运行环境
CHROME_PATH=                        # Chromium 路径（留空则自动探测）

# 数据库配置（SQLite - 默认）
DB_DRIVER=sqlite                    # 数据库驱动：sqlite 或 postgres
DB_PATH=./data/app.db               # SQLite 数据库路径

# PostgreSQL 配置（可选，DB_DRIVER=postgres 时启用）
PGHOST=localhost
PGPORT=5432
PGDATABASE=autocontents
PGUSER=postgres
PGPASSWORD=your_password

RENDER_OUTPUT_DIR=./uploads/rendered  # 渲染图片输出目录
```

### 数据库支持

项目支持 **SQLite**（默认）和 **PostgreSQL** 两种数据库：

| 特性 | SQLite | PostgreSQL |
|------|--------|------------|
| 配置 | `DB_DRIVER=sqlite` | `DB_DRIVER=postgres` |
| 适用场景 | 开发环境、单机部署 | 生产环境、多用户并发 |
| 依赖 | better-sqlite3（内置） | pg 驱动（已添加） |

切换数据库只需修改 `.env` 中的 `DB_DRIVER` 和相关配置，代码无需改动。

#### 数据库结构

核心表：

- **sources**：RSS 信源（name, type: rsshub\|rss, route, enabled, translate）
- **news**：抓取的文章（guid, title, description, translated_字段, ai_newsed标记, saved标记）
- **saved_contents**：用户创作内容（含渲染图片路径）
- **config**：键值对系统配置（LLM设置、飞书凭证、小红书Cookie）
- **feishu_daily_docs**：飞书每日文档追踪

启动时自动执行表结构创建和迁移（见 `db/database.js`）。

### 核心技术

- **数据库**：SQLite via better-sqlite3，启动自动迁移
- **大模型**：OpenAI 兼容接口（DeepSeek、通义、Kimi 等），UI中配置
- **渲染引擎**：Puppeteer（无头 Chromium）+ Canvas + Sharp
- **图片生成**：1080×1440 封面/详情图，支持 Emoji
- **RSS**：rss-parser 库，支持 RSSHub 路由和标准 RSS

### 渲染流程

渲染服务（`services/renderService.js`）生成小红书风格图片：

1. **封面图**：1080×1440，渐变背景、大 Emoji、英文词、中文标题
2. **详情图**：源网页截图（长页面自动裁切），或用户正文内容
3. **配色主题**：按 content_type 自动选择（news=#FF6B35、tools=#5478EB、topics=#FFD700、default=#06FFA5）
4. **Emoji 支持**：macOS 使用 Apple Color Emoji，Docker 使用系统字体

渲染需要 Chrome/Chromium。Docker 中通过 apt 安装 Chromium。

### 飞书多维表配置要求

配置飞书多维表时，表格必须严格使用以下字段类型：

```json
{
  "资讯": "文本",
  "url": "文本",
  "标题": "文本",
  "正文": "文本",
  "Tags": "文本",
  "封面": ["附件"],
  "详情图": ["附件"],
  "创作时间": "文本"
}
```

### Agent 集成

项目提供完整的 REST API 供 Agent 自动化调用。详见 `Skills/makecontents/SKILL.md` 和 `Skills/makecontents/references/api.md`。

核心 Agent 接口：

- `POST /api/news/fetch` - 拉取最新资讯
- `GET /api/news/grouped?agent=1` - 获取资讯列表（自动排除已推送）
- `POST /api/news/{id}/ainews|aitopics|aitools` - 推送资讯（Agent 模式支持预生成内容）
- `POST /api/content/agent-render` - 一步完成图片渲染
- `POST /api/content/save-to-bitable` - 保存到飞书多维表
- `POST /api/content/publish-xhs` - 发布到小红书（Agent 必须传 `is_private: true`）
- `POST /api/content/notify-bot` - 飞书机器人通知

Agent 工作流状态追踪：

- 资讯推送后标记 `ai_newsed=1`
- 资讯保存后标记 `saved=1` 和 `push_type`
- `GET /api/news/grouped?agent=1` 自动过滤已处理条目

## 安全提示

小红书官方于 2025 年 3 月发布《关于打击AI托管运营账号的治理公告》。建议关闭 Agent 直接发布到小红书的功能，改为手动发布。

Agent 发布小红书时必须设置 `is_private: true`，发布为仅自己可见，等待人工审核后再设为公开。
