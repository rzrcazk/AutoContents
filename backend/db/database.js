/**
 * 统一数据库入口
 * 根据 DB_DRIVER 环境变量自动选择 SQLite 或 PostgreSQL
 * 默认为 SQLite，设置 DB_DRIVER=postgres 启用 PostgreSQL
 */

const path = require('path');
const fs = require('fs');

const DB_DRIVER = process.env.DB_DRIVER || 'sqlite';

let db;

if (DB_DRIVER === 'postgres') {
  // 使用 PostgreSQL
  console.log('[DB] 使用 PostgreSQL 数据库');
  const pgDb = require('./pg-database');

  // 包装为同步风格的 API（适配现有代码）
  db = {
    // 原始 pool（用于高级查询）
    pool: pgDb.pool,

    // 异步查询方法
    prepare: (sql) => {
      // 转换 SQLite 参数占位符 ? 为 PostgreSQL $1, $2...
      let pgSql = sql;

      // 转换 SQLite 函数为 PostgreSQL（必须在转换 ? 为 $1 之前处理）
      pgSql = pgSql.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
      // 转换 datetime(?, '-1 day') 为 ?::timestamp - interval '1 day'
      pgSql = pgSql.replace(/datetime\(\?\s*,\s*['"]([-+])?(\d+)\s+day['"]\s*\)/gi, (match, sign, days) => {
        const operator = sign === '-' || !sign ? '-' : '+';
        return `?::timestamp ${operator} interval '${days} day'`;
      });
      // 转换布尔值比较：= 1 改为 = true, = 0 改为 = false
      pgSql = pgSql.replace(/=\s*1(?![0-9])/g, '= true');
      pgSql = pgSql.replace(/=\s*0/g, '= false');
      pgSql = pgSql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');

      // 最后转换 ? 为 $1, $2...
      let paramIndex = 0;
      pgSql = pgSql.replace(/\?/g, () => `$${++paramIndex}`);

      return {
        all: async (...params) => {
          try {
            // 转换布尔值参数为 PostgreSQL 格式
            const convertedParams = convertParams(params);
            const rows = await pgDb.all(pgSql, convertedParams);
            // 转换 PostgreSQL 布尔值为 JavaScript 布尔值
            return rows.map(row => convertFromPostgres(row));
          } catch (err) {
            console.error('PostgreSQL 查询错误:', err);
            throw err;
          }
        },
        get: async (...params) => {
          try {
            const convertedParams = convertParams(params);
            const row = await pgDb.get(pgSql, convertedParams);
            return row ? convertFromPostgres(row) : null;
          } catch (err) {
            console.error('PostgreSQL 查询错误:', err);
            throw err;
          }
        },
        run: async (...params) => {
          try {
            // 转换 INSERT OR REPLACE 为 INSERT ... ON CONFLICT
            let runSql = pgSql;
            if (runSql.includes('INSERT OR REPLACE INTO')) {
              runSql = runSql.replace('INSERT OR REPLACE INTO', 'INSERT INTO');
              runSql = runSql.replace(/ON CONFLICT.*DO UPDATE SET.*$/i, '');
              runSql = runSql.trim();
              // 根据表名确定冲突列和更新语句
              const tableMatch = runSql.match(/INSERT INTO\s+(\w+)/i);
              const tableName = tableMatch ? tableMatch[1] : '';
              if (tableName === 'feishu_daily_docs') {
                runSql += ' ON CONFLICT (date) DO UPDATE SET node_token = EXCLUDED.node_token, obj_token = EXCLUDED.obj_token';
              } else {
                // 默认为 config 表（key-value 结构）
                runSql += ' ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value';
              }
            }
            // 添加 RETURNING id 支持获取 lastInsertRowid（config 表和无 id 列的表除外）
            const noIdTables = ['config', 'feishu_daily_docs'];
            const insertTableMatch = runSql.match(/INSERT INTO\s+(\w+)/i);
            const insertTableName = insertTableMatch ? insertTableMatch[1] : '';
            if (runSql.includes('INSERT INTO') && !runSql.includes('RETURNING') && !noIdTables.includes(insertTableName)) {
              runSql += ' RETURNING id';
            }
            const convertedParams = convertParams(params);
            const result = await pgDb.run(runSql, convertedParams);
            return {
              lastInsertRowid: result.lastInsertRowid,
              changes: result.rowCount,
            };
          } catch (err) {
            console.error('PostgreSQL 执行错误:', err);
            throw err;
          }
        },
      };
    },

    // 执行多条 SQL
    exec: async (sql) => {
      try {
        await pgDb.exec(sql);
      } catch (err) {
        console.error('PostgreSQL exec 错误:', err);
        throw err;
      }
    },

    // 事务支持
    transaction: (fn) => {
      return async () => {
        const client = await pgDb.beginTransaction();
        try {
          const tx = {
            run: (sql, params) => pgDb.txRun(client, sql, params),
            get: (sql, params) => pgDb.txGet(client, sql, params),
            all: (sql, params) => pgDb.txAll(client, sql, params),
          };
          const result = await fn(tx);
          await pgDb.commitTransaction(client);
          return result;
        } catch (err) {
          await pgDb.rollbackTransaction(client);
          throw err;
        }
      };
    },

    // 初始化
    init: async () => {
      await pgDb.initDatabase();
    },
  };
} else {
  // 使用 SQLite（默认）
  console.log('[DB] 使用 SQLite 数据库');
  const Database = require('better-sqlite3');

  const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/app.db');

  // 确保数据目录存在
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const sqliteDb = new Database(DB_PATH);

  // 开启 WAL 模式提升性能
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');

  // 初始化表结构
  sqliteDb.exec(`
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

  // 迁移：为已存在的数据库添加新列
  const migrations = [
    "ALTER TABLE news ADD COLUMN saved INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE news ADD COLUMN saved_at TEXT",
    "ALTER TABLE news ADD COLUMN push_type TEXT",
    "ALTER TABLE saved_contents ADD COLUMN news_id INTEGER",
    "ALTER TABLE saved_contents ADD COLUMN tags TEXT",
    "ALTER TABLE saved_contents ADD COLUMN source_url TEXT",
  ];
  for (const sql of migrations) {
    try { sqliteDb.exec(sql); } catch (_) { /* 列已存在则忽略 */ }
  }

  // 插入默认示例信源
  const sourceCount = sqliteDb.prepare('SELECT COUNT(*) as cnt FROM sources').get();
  if (sourceCount.cnt === 0) {
    const insertSource = sqliteDb.prepare(`
      INSERT INTO sources (name, type, route, enabled, limit_count, translate)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertSource.run('36kr快讯', 'rsshub', '/36kr/newsflashes', 1, 20, 0);
    insertSource.run('HackerNews', 'rsshub', '/hackernews', 1, 20, 1);
    insertSource.run('ProductHunt', 'rss', 'https://decohack.com/feed/', 1, 20, 1);
  }

  db = sqliteDb;
}

// 辅助函数：转换参数为 PostgreSQL 格式
function convertParams(params) {
  if (!params) {
    return [];
  }
  if (!Array.isArray(params)) {
    params = [params];
  }
  return params.map(p => {
    // 将 JavaScript 布尔值转换为 PostgreSQL 格式
    if (typeof p === 'boolean') {
      return p;
    }
    return p;
  });
}

// 辅助函数：从 PostgreSQL 结果转换
function convertFromPostgres(row) {
  if (!row) return row;
  const result = { ...row };
  // 转换常见布尔字段
  const booleanFields = ['enabled', 'translate', 'hidden', 'ai_newsed', 'saved'];
  for (const field of booleanFields) {
    if (field in result) {
      result[field] = Boolean(result[field]);
    }
  }
  return result;
}

module.exports = db;
