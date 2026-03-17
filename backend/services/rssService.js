const axios = require('axios');
const Parser = require('rss-parser');
const db = require('../db/database');
const { getBlacklist, getAllowlist, getAllowlistScope } = require('./configService');
const { translate } = require('./llmService');

const parser = new Parser({
  timeout: 30000,
  headers: {
    'User-Agent': 'MakeContents/1.0 RSS Reader',
  },
  customFields: {
    item: ['description', 'content', 'content:encoded'],
  },
});

const RSSHUB_BASE = process.env.RSSHUB_URL || 'http://localhost:1200';

function containsBlacklisted(text, blacklist) {
  if (!text || blacklist.length === 0) return false;
  return blacklist.some((kw) => text.includes(kw));
}

function passesAllowlist(text, allowlist) {
  if (allowlist.length === 0) return true;
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return allowlist.some((kw) => lowerText.includes(kw.toLowerCase()));
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchSource(source) {
  let url;
  if (source.type === 'rsshub') {
    const limitParam = source.limit_count ? `?limit=${source.limit_count}` : '';
    url = `${RSSHUB_BASE}${source.route}${limitParam}`;
  } else {
    url = source.route;
  }

  const feed = await parser.parseURL(url);
  return feed.items || [];
}

async function processAndSaveItems(source, items) {
  const blacklist = await getBlacklist();
  const allowlist = await getAllowlist();
  const allowlistScope = await getAllowlistScope();

  const rows = [];
  for (const item of items) {
    const title = item.title || '';
    const rawDesc = item['content:encoded'] || item.content || item.description || item.summary || '';
    const description = stripHtml(rawDesc).substring(0, 2000);
    const link = item.link || item.guid || '';
    const guid = item.guid || item.link || `${source.id}-${item.title}-${Date.now()}`;
    const pubDate = item.pubDate || item.isoDate || new Date().toISOString();

    if (containsBlacklisted(title + ' ' + description, blacklist)) {
      continue;
    }

    const allowlistText = allowlistScope === 'title' ? title : title + ' ' + description;
    if (!passesAllowlist(allowlistText, allowlist)) {
      continue;
    }

    rows.push({
      source_id: source.id,
      guid,
      title,
      description,
      link,
      pub_date: pubDate,
    });
  }

  // 批量插入
  for (const row of rows) {
    await db.prepare(`
      INSERT OR IGNORE INTO news
      (source_id, guid, title, description, link, pub_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(row.source_id, row.guid, row.title, row.description, row.link, row.pub_date);
  }

  return rows.length;
}

async function translateNewsForSource(sourceId) {
  const untranslated = await db.prepare(`
    SELECT id, title, description FROM news
    WHERE source_id = ? AND hidden = 0
    AND (translated_title IS NULL OR translated_title = '')
    ORDER BY fetched_at DESC LIMIT 50
  `).all(sourceId);

  for (const item of untranslated) {
    try {
      const [transTitle, transDesc] = await Promise.all([
        translate(item.title),
        translate(item.description),
      ]);
      await db.prepare(`
        UPDATE news SET translated_title = ?, translated_description = ? WHERE id = ?
      `).run(transTitle, transDesc, item.id);
    } catch (err) {
      console.error(`翻译新闻 ${item.id} 失败:`, err.message);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function fetchAndUpdateSource(source) {
  try {
    const items = await fetchSource(source);
    const count = await processAndSaveItems(source, items);
    console.log(`[${source.name}] 新增 ${count} 条资讯`);

    if (source.translate) {
      translateNewsForSource(source.id).catch((e) =>
        console.error(`翻译信源 ${source.name} 失败:`, e.message)
      );
    }

    return { sourceId: source.id, newCount: count };
  } catch (err) {
    console.error(`拉取信源 [${source.name}] 失败:`, err.message);
    return { sourceId: source.id, error: err.message };
  }
}

async function fetchAllSources() {
  const sources = await db.prepare('SELECT * FROM sources WHERE enabled = 1').all();
  const results = await Promise.allSettled(sources.map((s) => fetchAndUpdateSource(s)));
  return results.map((r, i) => ({
    source: sources[i].name,
    ...(r.status === 'fulfilled' ? r.value : { error: r.reason?.message }),
  }));
}

module.exports = { fetchAllSources, fetchAndUpdateSource, translateNewsForSource };
