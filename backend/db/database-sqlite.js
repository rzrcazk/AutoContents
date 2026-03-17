const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/app.db');

// 确保数据目录存在
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// 开启 WAL 模式提升性能
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 初始化表结构
db.exec(`
  CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('rsshub', 'rss')),
    route TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    limit_count INTEGER NOT NULL DEFAULT 20,
    translate INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    guid TEXT NOT NULL UNIQUE,
    title TEXT,
    description TEXT,
    translated_title TEXT,
    translated_description TEXT,
    link TEXT,
    pub_date TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    ai_newsed INTEGER NOT NULL DEFAULT 0,
    saved INTEGER NOT NULL DEFAULT 0,
    saved_at TEXT,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS saved_contents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    news_id INTEGER,
    title TEXT,
    content TEXT,
    cover_url TEXT,
    detail_urls TEXT,
    tags TEXT,
    source_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS feishu_daily_docs (
    date TEXT PRIMARY KEY,
    node_token TEXT NOT NULL,
    obj_token TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_news_source_id ON news(source_id);
  CREATE INDEX IF NOT EXISTS idx_news_hidden ON news(hidden);
  CREATE INDEX IF NOT EXISTS idx_news_fetched_at ON news(fetched_at);
`);

// 迁移：为已存在的数据库添加新列（忽略已存在的错误）
const migrations = [
  "ALTER TABLE news ADD COLUMN saved INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE news ADD COLUMN saved_at TEXT",
  "ALTER TABLE news ADD COLUMN push_type TEXT",
  "ALTER TABLE saved_contents ADD COLUMN news_id INTEGER",
  "ALTER TABLE saved_contents ADD COLUMN tags TEXT",
  "ALTER TABLE saved_contents ADD COLUMN source_url TEXT",
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (_) { /* 列已存在则忽略 */ }
}

// 插入默认示例信源（仅首次）
const sourceCount = db.prepare('SELECT COUNT(*) as cnt FROM sources').get();
if (sourceCount.cnt === 0) {
  const insertSource = db.prepare(`
    INSERT INTO sources (name, type, route, enabled, limit_count, translate)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertSource.run('36kr快讯', 'rsshub', '/36kr/newsflashes', 1, 20, 0);
  insertSource.run('HackerNews', 'rsshub', '/hackernews', 1, 20, 1);
  insertSource.run('ProductHunt', 'rss', 'https://decohack.com/feed/', 1, 20, 1);
}

module.exports = db;
