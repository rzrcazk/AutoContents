const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');
const axios = require('axios');
const FormData = require('form-data');
const { createContent } = require('../services/llmService');
const { renderCover, renderDetail, screenshotUrl, OUTPUT_DIR } = require('../services/renderService');
const { saveContentToFeishuBitable } = require('../services/feishuService');
const { notifyFeishuBot } = require('../services/wechatService');
const { publishNote } = require('../services/xhsService');
const db = require('../db/database');

const UPLOAD_DIR = path.join(__dirname, '../uploads/images');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('只能上传图片文件'));
  },
});

// 上传图片
router.post('/upload', upload.array('images', 10), (req, res) => {
  const files = req.files.map((f) => ({
    filename: f.filename,
    url: `/uploads/images/${f.filename}`,
    originalname: f.originalname,
  }));
  res.json({ success: true, data: files });
});

// 内容创作（人工流程）
router.post('/create', async (req, res) => {
  const { title, description, extra_info } = req.body;
  if (!title) return res.status(400).json({ success: false, error: '缺少资讯标题' });

  try {
    const result = await createContent(title, description, extra_info);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 渲染图片（人工流程）
router.post('/render', async (req, res) => {
  const { cover_word, cover_title, cover_description, cover_emoji, cover_title_color, image_filenames } = req.body;

  if (!cover_word || !cover_title) {
    return res.status(400).json({ success: false, error: '缺少封面必要字段' });
  }

  const sessionId = uuidv4();

  try {
    const coverPath = await renderCover(
      { cover_word, cover_title, cover_description, cover_emoji, cover_title_color },
      sessionId
    );

    const detailPaths = [];
    const images = image_filenames || [];
    for (let i = 0; i < images.length; i++) {
      const imgPath = path.join(UPLOAD_DIR, images[i]);
      if (fs.existsSync(imgPath)) {
        const dp = await renderDetail(imgPath, sessionId, i, cover_title_color);
        detailPaths.push(dp);
      }
    }

    const coverUrl = `/uploads/rendered/${path.basename(coverPath)}`;
    const detailUrls = detailPaths.map((p) => `/uploads/rendered/${path.basename(p)}`);

    res.json({
      success: true,
      data: {
        session_id: sessionId,
        cover_url: coverUrl,
        detail_urls: detailUrls,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Agent 一步完成内容创作 + 渲染
router.post('/agent-render', async (req, res) => {
  const {
    news_id,
    source_url,
    cover_word,
    cover_title,
    cover_description,
    cover_emoji,
    cover_title_color,
    content_type,
    title,
    content,
    tags,
  } = req.body;

  if (!cover_word || !cover_title || !title) {
    return res.status(400).json({ success: false, error: '缺少必要字段：cover_word, cover_title, title' });
  }

  const colorMap = { news: '#FF6B35', tools: '#5478EB', topics: '#FFD700', default: '#06FFA5' };
  const titleColor = cover_title_color || colorMap[content_type] || '#06FFA5';

  const sessionId = uuidv4();

  try {
    const coverPath = await renderCover(
      { cover_word, cover_title, cover_description, cover_emoji, cover_title_color: titleColor },
      sessionId
    );

    const detailPaths = [];
    if (source_url) {
      try {
        const screenshotPaths = await screenshotUrl(source_url, sessionId);
        for (let i = 0; i < screenshotPaths.length; i++) {
          const dp = await renderDetail(screenshotPaths[i], sessionId, i, titleColor);
          detailPaths.push(dp);
        }
      } catch (e) {
        console.warn('截图失败，跳过详情图:', e.message);
      }
    }

    const coverUrl = `/uploads/rendered/${path.basename(coverPath)}`;
    const detailUrls = detailPaths.map((p) => `/uploads/rendered/${path.basename(p)}`);

    const result = await db.prepare(`
      INSERT INTO saved_contents (news_id, title, content, cover_url, detail_urls, tags, source_url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `).run(
      news_id || null,
      title,
      content,
      coverUrl,
      JSON.stringify(detailUrls),
      tags || '',
      source_url || ''
    );

    res.json({
      success: true,
      data: {
        saved_content_id: result.lastInsertRowid,
        session_id: sessionId,
        cover_url: coverUrl,
        detail_urls: detailUrls,
        title_color: titleColor,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 打包下载渲染图片
router.post('/download', (req, res) => {
  const { cover_url, detail_urls } = req.body;
  const allUrls = [cover_url, ...(detail_urls || [])].filter(Boolean);

  if (allUrls.length === 0) {
    return res.status(400).json({ success: false, error: '没有可下载的图片' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="rendered_${Date.now()}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => {
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
  });
  archive.pipe(res);

  for (const url of allUrls) {
    const filePath = path.join(__dirname, '../', url);
    if (fs.existsSync(filePath)) {
      archive.file(filePath, { name: path.basename(filePath) });
    }
  }

  archive.finalize();
});

// 保存内容到资源库（人工流程）
router.post('/save', async (req, res) => {
  try {
    const { news_id, title, content, cover_url, detail_urls, tags, source_url } = req.body;
    const result = await db.prepare(`
      INSERT INTO saved_contents (news_id, title, content, cover_url, detail_urls, tags, source_url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `).run(
      news_id || null,
      title || '',
      content || '',
      cover_url || '',
      JSON.stringify(detail_urls || []),
      tags || '',
      source_url || ''
    );
    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取已保存内容列表
router.get('/saved', async (req, res) => {
  try {
    const items = await db.prepare('SELECT * FROM saved_contents ORDER BY created_at DESC').all();
    const parsed = items.map((item) => ({
      ...item,
      detail_urls: (() => { try { return JSON.parse(item.detail_urls); } catch { return []; } })(),
    }));
    res.json({ success: true, data: parsed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除已保存内容
router.delete('/saved/:id', async (req, res) => {
  try {
    await db.prepare('DELETE FROM saved_contents WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 保存内容到飞书多维表
router.post('/save-to-bitable', async (req, res) => {
  let data = req.body;

  try {
    if (data.saved_content_id) {
      const row = await db.prepare('SELECT * FROM saved_contents WHERE id = ?').get(data.saved_content_id);
      if (!row) return res.status(404).json({ success: false, error: '内容不存在' });
      data = {
        ...row,
        detail_urls: (() => { try { return JSON.parse(row.detail_urls); } catch { return []; } })(),
      };
      if (row.news_id) {
        const newsRow = await db.prepare('SELECT * FROM news WHERE id = ?').get(row.news_id);
        if (newsRow) {
          data.news_title = newsRow.translated_title || newsRow.title;
          data.news_source_url = newsRow.link || data.source_url;
          data.news_pub_date = newsRow.pub_date;
        }
      }
    }

    const result = await saveContentToFeishuBitable(data);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 飞书机器人 Webhook 通知
router.post('/notify-bot', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ success: false, error: '缺少 message 字段' });

  try {
    const result = await notifyFeishuBot(message);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 发布内容到小红书
router.post('/publish-xhs', async (req, res) => {
  const { title, desc, cover_url, detail_urls, is_private } = req.body;

  if (!title || !cover_url) {
    return res.status(400).json({ success: false, error: '缺少必要字段：title 和 cover_url' });
  }

  const toLocalPath = (url) => path.join(__dirname, '../', url);
  const allUrls = [cover_url, ...(detail_urls || [])].filter(Boolean);
  const imagePaths = allUrls.map(toLocalPath).filter((p) => fs.existsSync(p));

  if (imagePaths.length === 0) {
    return res.status(400).json({ success: false, error: '没有可用的渲染图片文件' });
  }

  try {
    const result = await publishNote({ title, desc, imagePaths, isPrivate: is_private === true });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
