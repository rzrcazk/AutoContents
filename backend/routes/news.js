const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { fetchAllSources, fetchAndUpdateSource } = require('../services/rssService');
const { formatNewsForAINews, formatNewsForAITopics, formatNewsForAITools } = require('../services/llmService');
const { pushAINews } = require('../services/wechatService');
const { saveNewsToFeishu } = require('../services/feishuService');

// 获取资讯列表
router.get('/', async (req, res) => {
  try {
    const { source_id, page = 1, limit = 30 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query, params;
    if (source_id) {
      query = `
        SELECT n.*, s.name as source_name, s.translate as source_translate
        FROM news n JOIN sources s ON n.source_id = s.id
        WHERE n.hidden = 0 AND n.source_id = ?
        ORDER BY n.pub_date DESC, n.fetched_at DESC
        LIMIT ? OFFSET ?
      `;
      params = [source_id, parseInt(limit), offset];
    } else {
      query = `
        SELECT n.*, s.name as source_name, s.translate as source_translate
        FROM news n JOIN sources s ON n.source_id = s.id
        WHERE n.hidden = 0
        ORDER BY n.pub_date DESC, n.fetched_at DESC
        LIMIT ? OFFSET ?
      `;
      params = [parseInt(limit), offset];
    }

    const news = await db.prepare(query).all(...params);
    res.json({ success: true, data: news });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取按信源分组的资讯
router.get('/grouped', async (req, res) => {
  try {
    const isAgent = req.query.agent === '1';

    // 解析信源筛选参数（支持多选）
    let sourceIds = [];
    if (req.query.source_ids) {
      try {
        sourceIds = JSON.parse(req.query.source_ids);
        if (!Array.isArray(sourceIds)) {
          sourceIds = [sourceIds];
        }
      } catch {
        // 如果不是JSON数组，尝试按逗号分隔
        sourceIds = req.query.source_ids.split(',').map(id => id.trim()).filter(Boolean);
      }
    }

    // 解析时间范围参数
    let startDate = req.query.start_date;
    let endDate = req.query.end_date;

    // 如果没有提供时间范围，默认使用最近30天
    if (!startDate && !endDate) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      startDate = thirtyDaysAgo.toISOString();
    }

    // 构建查询条件
    let sourceFilter = '';
    let dateFilter = '';
    const queryParams = [];

    if (sourceIds.length > 0) {
      const placeholders = sourceIds.map(() => '?').join(',');
      sourceFilter = `AND id IN (${placeholders})`;
      queryParams.push(...sourceIds);
    }

    const sources = await db.prepare(`
      SELECT * FROM sources
      WHERE enabled = 1 ${sourceFilter}
      ORDER BY id
    `).all(...queryParams);

    const result = [];
    for (const source of sources) {
      const newsParams = [source.id];
      let newsFilter = '';

      if (isAgent) {
        newsFilter += ' AND ai_newsed = 0';
      }

      if (startDate) {
        newsFilter += ' AND pub_date >= ?';
        newsParams.push(startDate);
      }

      if (endDate) {
        newsFilter += ' AND pub_date <= ?';
        newsParams.push(endDate);
      }

      const items = await db.prepare(`
        SELECT * FROM news
        WHERE source_id = ? AND hidden = 0 ${newsFilter}
        ORDER BY pub_date DESC, fetched_at DESC
        LIMIT 50
      `).all(...newsParams);

      result.push({ source, items });
    }
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取原始资讯（未过滤，含 hidden，按信源分组，资源页用）
router.get('/raw', async (req, res) => {
  try {
    const sources = await db.prepare('SELECT * FROM sources ORDER BY id').all();
    const result = [];
    for (const source of sources) {
      const items = await db.prepare(`
        SELECT * FROM news
        WHERE source_id = ?
        ORDER BY pub_date DESC, fetched_at DESC
        LIMIT 50
      `).all(source.id);
      result.push({ source, items });
    }
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取已保存的资讯列表
router.get('/saved', async (req, res) => {
  try {
    const items = await db.prepare(`
      SELECT n.*, s.name as source_name
      FROM news n JOIN sources s ON n.source_id = s.id
      WHERE n.saved = 1
      ORDER BY n.saved_at DESC
      LIMIT 200
    `).all();
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Agent 信息汇总接口
router.get('/agent-summary', async (req, res) => {
  try {
    const savedNews = await db.prepare(`
      SELECT n.id, n.title, n.translated_title, n.description, n.translated_description,
             n.link, n.pub_date, n.push_type, n.saved_at, s.name as source_name
      FROM news n JOIN sources s ON n.source_id = s.id
      WHERE n.saved = 1
      ORDER BY n.saved_at DESC
      LIMIT 5
    `).all();

    const savedContentsRaw = await db.prepare(`
      SELECT sc.*, n.title as news_title, n.link as news_link
      FROM saved_contents sc
      LEFT JOIN news n ON sc.news_id = n.id
      ORDER BY sc.created_at DESC
      LIMIT 5
    `).all();

    const savedContents = savedContentsRaw.map((item) => ({
      ...item,
      detail_urls: (() => { try { return JSON.parse(item.detail_urls); } catch { return []; } })(),
    }));

    const earliestSavedAt = savedNews.length > 0
      ? savedNews[savedNews.length - 1].saved_at
      : new Date(Date.now() - 86400000).toISOString();

    const allNewsInPeriod = await db.prepare(`
      SELECT n.id, n.title, n.translated_title, n.hidden, n.saved, n.ai_newsed, n.push_type,
             n.pub_date, s.name as source_name
      FROM news n JOIN sources s ON n.source_id = s.id
      WHERE n.fetched_at >= datetime(?, '-1 day')
      ORDER BY n.pub_date DESC
      LIMIT 100
    `).all(earliestSavedAt);

    res.json({
      success: true,
      data: {
        saved_news: savedNews,
        saved_contents: savedContents,
        all_news_in_period: allNewsInPeriod,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 拉取资讯（全部或指定信源）
router.post('/fetch', async (req, res) => {
  const { source_id, days } = req.body;
  try {
    let results;
    if (source_id) {
      const source = await db.prepare('SELECT * FROM sources WHERE id = ?').get(source_id);
      if (!source) return res.status(404).json({ success: false, error: '信源不存在' });
      const r = await fetchAndUpdateSource(source, days);
      results = [r];
    } else {
      results = await fetchAllSources();
    }
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 隐藏/移除资讯
router.post('/:id/hide', async (req, res) => {
  try {
    const { id } = req.params;
    await db.prepare('UPDATE news SET hidden = 1 WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 保存资讯
router.post('/:id/save', async (req, res) => {
  try {
    const { id } = req.params;
    await db.prepare("UPDATE news SET saved = 1, saved_at = datetime('now') WHERE id = ?").run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 取消保存资讯
router.post('/:id/unsave', async (req, res) => {
  try {
    const { id } = req.params;
    await db.prepare('UPDATE news SET saved = 0, saved_at = NULL WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 通用推送核心逻辑
 */
async function doPush(id, type, overrideContent) {
  const item = await db.prepare('SELECT * FROM news WHERE id = ?').get(id);
  if (!item) throw Object.assign(new Error('资讯不存在'), { status: 404 });

  let newsTitle, newsSummary;

  if (overrideContent && overrideContent.news_title && overrideContent.news_summary) {
    newsTitle = overrideContent.news_title;
    newsSummary = overrideContent.news_summary;
  } else {
    let formatted;
    if (type === 'ainews') {
      formatted = await formatNewsForAINews(item.translated_title || item.title, item.translated_description || item.description);
    } else if (type === 'aitopics') {
      formatted = await formatNewsForAITopics(item.translated_title || item.title, item.translated_description || item.description);
    } else if (type === 'aitools') {
      formatted = await formatNewsForAITools(item.translated_title || item.title, item.translated_description || item.description);
    } else {
      throw new Error('未知推送类型');
    }
    newsTitle = formatted.news_title;
    newsSummary = formatted.news_summary;
  }

  const tagMap = { ainews: '#AINews', aitopics: '#AITopic', aitools: '#AITools' };
  const emojiMap = { ainews: '🆕', aitopics: '💬', aitools: '🛠' };
  const tag = tagMap[type] || '#AINews';
  const feishuEmoji = emojiMap[type] || '🆕';
  const sourceUrl = item.link;

  const [wechatResult, feishuResult] = await Promise.allSettled([
    pushAINews(newsTitle, newsSummary, tag),
    saveNewsToFeishu(newsTitle, newsSummary, sourceUrl, feishuEmoji, item.pub_date),
  ]);

  // 检查飞书推送结果，失败则抛出错误
  if (feishuResult.status === 'rejected') {
    throw new Error(`飞书推送失败: ${feishuResult.reason?.message || '未知错误'}`);
  }

  await db.prepare(`
    UPDATE news SET ai_newsed = 1, saved = 1, saved_at = datetime('now'), push_type = ?
    WHERE id = ?
  `).run(type, id);

  return {
    news_id: id,
    news_title: newsTitle,
    news_summary: newsSummary,
    wechat: wechatResult.status === 'fulfilled' ? wechatResult.value : { error: wechatResult.reason?.message },
    feishu: feishuResult.value,
  };
}

// 加入 AINews
router.post('/:id/ainews', async (req, res) => {
  try {
    const data = await doPush(req.params.id, 'ainews', req.body);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// 加入 AITopics
router.post('/:id/aitopics', async (req, res) => {
  try {
    const data = await doPush(req.params.id, 'aitopics', req.body);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// 加入 AITools
router.post('/:id/aitools', async (req, res) => {
  try {
    const data = await doPush(req.params.id, 'aitools', req.body);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// 获取单条资讯详情
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const item = await db.prepare(`
      SELECT n.*, s.name as source_name
      FROM news n JOIN sources s ON n.source_id = s.id
      WHERE n.id = ?
    `).get(id);
    if (!item) return res.status(404).json({ success: false, error: '资讯不存在' });
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
