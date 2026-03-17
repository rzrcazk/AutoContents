# 数据库迁移指南：SQLite → PostgreSQL

## 概述

本项目现已支持 **SQLite**（默认）和 **PostgreSQL** 两种数据库。您可以根据需求随时切换。

## 快速切换

### 1. 安装 PostgreSQL 依赖

```bash
cd backend
npm install
```

### 2. 配置环境变量

编辑 `backend/.env` 文件：

```bash
# 切换为 PostgreSQL
DB_DRIVER=postgres

# PostgreSQL 连接配置
PGHOST=localhost
PGPORT=5432
PGDATABASE=autocontents
PGUSER=postgres
PGPASSWORD=your_password
```

### 3. 创建 PostgreSQL 数据库

```bash
# 使用 psql 创建数据库
psql -U postgres -c "CREATE DATABASE autocontents;"
```

### 4. 启动服务

```bash
npm start
```

启动时会自动创建表结构。

---

## 环境变量说明

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DB_DRIVER` | 数据库驱动 (`sqlite` 或 `postgres`) | `sqlite` |
| `DB_PATH` | SQLite 数据库路径 | `./data/app.db` |
| `PGHOST` | PostgreSQL 主机 | `localhost` |
| `PGPORT` | PostgreSQL 端口 | `5432` |
| `PGDATABASE` | PostgreSQL 数据库名 | `autocontents` |
| `PGUSER` | PostgreSQL 用户名 | `postgres` |
| `PGPASSWORD` | PostgreSQL 密码 | - |

---

## 数据迁移（SQLite → PostgreSQL）

如需将现有 SQLite 数据迁移到 PostgreSQL：

```bash
# 1. 导出 SQLite 数据
sqlite3 backend/data/app.db .dump > dump.sql

# 2. 转换 SQL 语法（需要手动调整）
# - INTEGER PRIMARY KEY AUTOINCREMENT → SERIAL PRIMARY KEY
# - datetime('now') → CURRENT_TIMESTAMP
# - ? 占位符 → $1, $2...

# 3. 导入到 PostgreSQL
psql -U postgres -d autocontents -f dump.sql
```

---

## 技术实现

### 统一接口设计

`db/database.js` 提供了统一的数据库接口，自动根据 `DB_DRIVER` 选择底层实现：

```javascript
const db = require('./db/database');

// 查询所有
const sources = await db.prepare('SELECT * FROM sources').all();

// 查询单条
const source = await db.prepare('SELECT * FROM sources WHERE id = ?').get(id);

// 执行更新
await db.prepare('UPDATE sources SET name = ? WHERE id = ?').run(name, id);
```

### 自动 SQL 转换

当使用 PostgreSQL 时，系统会自动转换：

| SQLite | PostgreSQL |
|--------|------------|
| `?` 占位符 | `$1, $2...` 占位符 |
| `datetime('now')` | `CURRENT_TIMESTAMP` |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| `INSERT OR REPLACE` | `INSERT ... ON CONFLICT` |

### 布尔值处理

PostgreSQL 原生支持 `BOOLEAN` 类型，系统会自动转换：

- 查询结果：`0/1` → `true/false`
- 插入参数：`true/false` → 数据库布尔值

---

## Docker 部署 PostgreSQL

如需使用 Docker Compose 部署 PostgreSQL：

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3710:3710"
    environment:
      - DB_DRIVER=postgres
      - PGHOST=postgres
      - PGDATABASE=autocontents
      - PGUSER=postgres
      - PGPASSWORD=postgres
    depends_on:
      - postgres

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: autocontents
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

---

## 常见问题

### Q: 切换数据库后数据会丢失吗？
A: SQLite 和 PostgreSQL 是独立的数据存储。切换数据库驱动后，数据不会自动同步，需要手动迁移。

### Q: 可以同时使用两种数据库吗？
A: 不可以。同一时间只能使用一种数据库驱动，由 `DB_DRIVER` 环境变量决定。

### Q: PostgreSQL 比 SQLite 有什么优势？
A:
- 更好的并发性能（多用户同时访问）
- 支持远程连接
- 更完善的权限管理
- 适合生产环境部署

### Q: 开发环境推荐使用哪种？
A: 开发环境推荐使用 SQLite（默认），无需额外安装和配置。
