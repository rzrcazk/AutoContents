const express = require('express');
const router = express.Router();
const db = require('../db/database');

// 获取所有信源
router.get('/', async (req, res) => {
  try {
    const sources = await db.prepare('SELECT * FROM sources ORDER BY id').all();
    res.json({ success: true, data: sources });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 新增信源
router.post('/', async (req, res) => {
  try {
    const { name, type, route, enabled, limit_count, translate } = req.body;
    if (!name || !type || !route) {
      return res.status(400).json({ success: false, error: '缺少必填字段' });
    }
    if (!['rsshub', 'rss'].includes(type)) {
      return res.status(400).json({ success: false, error: 'type 必须是 rsshub 或 rss' });
    }

    const result = await db.prepare(`
      INSERT INTO sources (name, type, route, enabled, limit_count, translate)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      name,
      type,
      route,
      enabled ? 1 : 0,
      limit_count || 20,
      translate ? 1 : 0
    );

    const source = await db.prepare('SELECT * FROM sources WHERE id = ?').get(result.lastInsertRowid);
    res.json({ success: true, data: source });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 更新信源
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, route, enabled, limit_count, translate } = req.body;

    const existing = await db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: '信源不存在' });
    }

    await db.prepare(`
      UPDATE sources SET
        name = ?, type = ?, route = ?, enabled = ?,
        limit_count = ?, translate = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name ?? existing.name,
      type ?? existing.type,
      route ?? existing.route,
      enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
      limit_count ?? existing.limit_count,
      translate !== undefined ? (translate ? 1 : 0) : existing.translate,
      id
    );

    const updated = await db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除信源
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.prepare('DELETE FROM sources WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
