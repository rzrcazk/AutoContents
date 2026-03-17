const { Pool } = require('pg');

// PostgreSQL 连接配置
const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  database: process.env.PGDATABASE || 'autocontents',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
});

// 监听连接错误
pool.on('error', (err) => {
  console.error('PostgreSQL 连接池错误:', err);
});

/**
 * 执行 SQL 查询，返回所有结果
 * @param {string} sql - SQL 语句，使用 $1, $2 作为参数占位符
 * @param {Array} params - 参数数组
 * @returns {Promise<Array>} 查询结果数组
 */
async function all(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

/**
 * 执行 SQL 查询，返回第一行结果
 * @param {string} sql - SQL 语句
 * @param {Array} params - 参数数组
 * @returns {Promise<Object|null>} 第一行结果或 null
 */
async function get(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

/**
 * 执行 SQL 语句（INSERT/UPDATE/DELETE）
 * @param {string} sql - SQL 语句
 * @param {Array} params - 参数数组
 * @returns {Promise<{rowCount: number, lastInsertRowid: number}>} 执行结果
 */
async function run(sql, params = []) {
  const result = await pool.query(sql, params);
  return {
    rowCount: result.rowCount,
    lastInsertRowid: result.rows[0]?.id || null,
  };
}

/**
 * 执行多条 SQL 语句（用于初始化）
 * @param {string} sql - SQL 语句
 */
async function exec(sql) {
  await pool.query(sql);
}

/**
 * 开始事务
 * @returns {Promise<Object>} 客户端连接，用于后续事务操作
 */
async function beginTransaction() {
  const client = await pool.connect();
  await client.query('BEGIN');
  return client;
}

/**
 * 提交事务
 * @param {Object} client - 客户端连接
 */
async function commitTransaction(client) {
  await client.query('COMMIT');
  client.release();
}

/**
 * 回滚事务
 * @param {Object} client - 客户端连接
 */
async function rollbackTransaction(client) {
  await client.query('ROLLBACK');
  client.release();
}

/**
 * 执行事务内的查询（all）
 * @param {Object} client - 客户端连接
 * @param {string} sql - SQL 语句
 * @param {Array} params - 参数数组
 */
async function txAll(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows;
}

/**
 * 执行事务内的查询（get）
 * @param {Object} client - 客户端连接
 * @param {string} sql - SQL 语句
 * @param {Array} params - 参数数组
 */
async function txGet(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0] || null;
}

/**
 * 执行事务内的语句（run）
 * @param {Object} client - 客户端连接
 * @param {string} sql - SQL 语句
 * @param {Array} params - 参数数组
 */
async function txRun(client, sql, params = []) {
  const result = await client.query(sql, params);
  return {
    rowCount: result.rowCount,
    lastInsertRowid: result.rows[0]?.id || null,
  };
}

// 初始化数据库表结构
async function initDatabase() {
  const initSQL = `
    -- 信源表
    CREATE TABLE IF NOT EXISTS sources (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('rsshub', 'rss')),
      route TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      limit_count INTEGER NOT NULL DEFAULT 20,
      translate BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- 资讯表
    CREATE TABLE IF NOT EXISTS news (
      id SERIAL PRIMARY KEY,
      source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      guid TEXT NOT NULL UNIQUE,
      title TEXT,
      description TEXT,
      translated_title TEXT,
      translated_description TEXT,
      link TEXT,
      pub_date TIMESTAMP,
      hidden BOOLEAN NOT NULL DEFAULT false,
      ai_newsed BOOLEAN NOT NULL DEFAULT false,
      saved BOOLEAN NOT NULL DEFAULT false,
      saved_at TIMESTAMP,
      fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      push_type TEXT
    );

    -- 保存的内容表
    CREATE TABLE IF NOT EXISTS saved_contents (
      id SERIAL PRIMARY KEY,
      news_id INTEGER REFERENCES news(id),
      title TEXT,
      content TEXT,
      cover_url TEXT,
      detail_urls TEXT,
      tags TEXT,
      source_url TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- 配置表
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- 飞书每日文档表
    CREATE TABLE IF NOT EXISTS feishu_daily_docs (
      date TEXT PRIMARY KEY,
      node_token TEXT NOT NULL,
      obj_token TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- 创建索引
    CREATE INDEX IF NOT EXISTS idx_news_source_id ON news(source_id);
    CREATE INDEX IF NOT EXISTS idx_news_hidden ON news(hidden);
    CREATE INDEX IF NOT EXISTS idx_news_fetched_at ON news(fetched_at);
  `;

  await exec(initSQL);

  // 检查是否需要插入默认信源
  const sourceCount = await get('SELECT COUNT(*) as cnt FROM sources');
  if (parseInt(sourceCount.cnt, 10) === 0) {
    await run(`
      INSERT INTO sources (name, type, route, enabled, limit_count, translate)
      VALUES
        ($1, $2, $3, $4, $5, $6),
        ($7, $8, $9, $10, $11, $12),
        ($13, $14, $15, $16, $17, $18)
    `, [
      '36kr快讯', 'rsshub', '/36kr/newsflashes', true, 20, false,
      'HackerNews', 'rsshub', '/hackernews', true, 20, true,
      'ProductHunt', 'rss', 'https://decohack.com/feed/', true, 20, true,
    ]);
  }
}

// 导出兼容 better-sqlite3 的 API
module.exports = {
  pool,
  all,
  get,
  run,
  exec,
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  txAll,
  txGet,
  txRun,
  initDatabase,
};
