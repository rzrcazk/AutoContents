require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3710;

// 中间件
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 静态文件服务
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 异步初始化数据库和启动服务器
async function startServer() {
  // 初始化数据库（确保在路由之前）
  const db = require('./db/database');
  if (db.init) {
    await db.init();
  }

  // API 路由
  app.use('/api/sources', require('./routes/sources'));
  app.use('/api/config', require('./routes/config'));
  app.use('/api/news', require('./routes/news'));
  app.use('/api/content', require('./routes/content'));

  // 健康检查
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // 前端静态文件（生产模式）
  const frontendBuildPath = (() => {
    const inDocker = path.join(__dirname, 'frontend/build');
    const inLocal  = path.join(__dirname, '../frontend/build');
    return fs.existsSync(inDocker) ? inDocker : inLocal;
  })();
  if (fs.existsSync(frontendBuildPath)) {
    app.use(express.static(frontendBuildPath));
    app.get('/{*path}', (req, res) => {
      res.sendFile(path.join(frontendBuildPath, 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`MakeContents 后端服务启动: http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('服务器启动失败:', err);
  process.exit(1);
});

module.exports = app;
