const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const db = require('../db/database');
const { getConfig } = require('./configService');

const FEISHU_API = 'https://open.feishu.cn/open-apis';

let tokenCache = { token: null, expiresAt: 0 };

async function getTenantAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60000) {
    return tokenCache.token;
  }

  const appId = await getConfig('feishu_app_id');
  const appSecret = await getConfig('feishu_app_secret');

  if (!appId || !appSecret) {
    throw new Error('未配置飞书 App ID 或 App Secret');
  }

  const resp = await axios.post(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    app_id: appId,
    app_secret: appSecret,
  });

  if (resp.data.code !== 0) {
    throw new Error(`获取飞书 token 失败: ${resp.data.msg}`);
  }

  tokenCache = {
    token: resp.data.tenant_access_token,
    expiresAt: Date.now() + resp.data.expire * 1000,
  };

  return tokenCache.token;
}

async function getOrCreateDailyDoc(dateStr) {
  // 检查数据库中是否已有今天的文档
  const existing = await db.prepare('SELECT * FROM feishu_daily_docs WHERE date = ?').get(dateStr);
  if (existing) return existing;

  const token = await getTenantAccessToken();
  const spaceId = await getConfig('feishu_space_id');
  const parentNodeToken = await getConfig('feishu_parent_node_token');

  if (!spaceId || !parentNodeToken) {
    throw new Error('未配置飞书知识库 space_id 或 parent_node_token');
  }

  const resp = await axios.post(
    `${FEISHU_API}/wiki/v2/spaces/${spaceId}/nodes`,
    {
      node_type: 'origin',
      obj_type: 'docx',
      parent_node_token: parentNodeToken,
      title: `${dateStr} AI 新闻`,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (resp.data.code !== 0) {
    throw new Error(`创建飞书文档失败: ${resp.data.msg}`);
  }

  // 检查返回数据结构
  if (!resp.data.data || !resp.data.data.node) {
    console.error('飞书创建文档返回异常:', JSON.stringify(resp.data, null, 2));
    throw new Error('创建飞书文档失败: 返回数据格式异常，缺少 node 信息');
  }

  const node = resp.data.data.node;
  const doc = {
    date: dateStr,
    node_token: node.node_token,
    obj_token: node.obj_token,
  };

  await db.prepare(
    'INSERT OR REPLACE INTO feishu_daily_docs (date, node_token, obj_token) VALUES (?, ?, ?)'
  ).run(doc.date, doc.node_token, doc.obj_token);

  return doc;
}

async function convertMarkdownToBlocks(markdown, token) {
  const resp = await axios.post(
    `${FEISHU_API}/docx/v1/documents/blocks/convert`,
    { content: markdown, content_type: 'markdown' },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (resp.data.code !== 0) {
    throw new Error(`Markdown转换失败: ${resp.data.msg}`);
  }

  return {
    blocks: resp.data.data.blocks,
    firstLevelBlockIds: resp.data.data.first_level_block_ids,
  };
}

async function insertBlocksToDoc(documentId, blocks, childrenIds, token) {
  const resp = await axios.post(
    `${FEISHU_API}/docx/v1/documents/${documentId}/blocks/${documentId}/descendant?document_revision_id=-1`,
    {
      index: 0,
      children_id: childrenIds,
      descendants: blocks,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
    }
  );

  if (resp.data.code !== 0) {
    throw new Error(`写入飞书文档失败: ${resp.data.msg}`);
  }

  return resp.data;
}

// titleEmoji: 标题前缀 Emoji，如 '🆕'、'💬'、'🛠'
// pubDate: 资讯的发布日期（ISO格式），用于确定文档日期
async function saveNewsToFeishu(newsTitle, newsSummary, sourceUrl, titleEmoji = '🆕', pubDate = null) {
  // 使用资讯的发布日期，如果没有则使用今天
  const docDate = pubDate ? new Date(pubDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  const doc = await getOrCreateDailyDoc(docDate);

  if (!doc || !doc.node_token) {
    throw new Error('获取飞书文档失败: 文档信息不完整');
  }

  const token = await getTenantAccessToken();

  const markdown = `### ${titleEmoji} ${newsTitle}\n> ${newsSummary}\n- 资讯链接：${sourceUrl}`;

  const { blocks, firstLevelBlockIds } = await convertMarkdownToBlocks(markdown, token);
  await insertBlocksToDoc(doc.node_token, blocks, firstLevelBlockIds, token);

  return { docToken: doc.node_token, date: docDate };
}

/**
 * 从飞书多维表 URL 中提取 app_token 和 table_id
 * URL 格式：https://xxx.feishu.cn/base/{app_token}?table={table_id}&...
 */
function parseBitableUrl(url) {
  if (!url) return null;
  const match = url.match(/\/base\/([^/?]+)/);
  const tableMatch = url.match(/[?&]table=([^&]+)/);
  if (!match || !tableMatch) return null;
  return { appToken: match[1], tableId: tableMatch[1] };
}

/**
 * 上传图片到飞书多维表素材（获取 file_token）
 * localPath: 服务器本地绝对路径
 */
async function uploadImageToBitable(localPath, appToken, token) {
  if (!fs.existsSync(localPath)) return null;

  const stat = fs.statSync(localPath);
  const form = new FormData();
  form.append('file_name', path.basename(localPath));
  form.append('parent_type', 'bitable_image');
  form.append('parent_node', appToken);
  form.append('size', String(stat.size));
  form.append('file', fs.createReadStream(localPath), { filename: path.basename(localPath) });

  const resp = await axios.post(
    `${FEISHU_API}/drive/v1/medias/upload_all`,
    form,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        ...form.getHeaders(),
      },
      timeout: 60000,
    }
  );

  if (resp.data.code !== 0) {
    throw new Error(`上传图片失败: ${resp.data.msg}`);
  }

  return resp.data.data.file_token;
}

/**
 * 保存内容到飞书多维表
 * data: { title, content, source_url, tags, cover_url, detail_urls, news_title, news_source_url, news_pub_date }
 * cover_url / detail_urls 为相对路径如 /uploads/rendered/xxx.png
 * news_pub_date: 资讯的原始发布日期
 */
async function saveContentToFeishuBitable(data) {
  const bitableUrl = await getConfig('feishu_bitable_url');
  if (!bitableUrl) throw new Error('未配置飞书多维表 URL');

  const parsed = parseBitableUrl(bitableUrl);
  if (!parsed) throw new Error('飞书多维表 URL 格式错误，无法解析 app_token 和 table_id');

  const { appToken, tableId } = parsed;
  const token = await getTenantAccessToken();

  // 上传封面图
  const coverLocalPath = data.cover_url
    ? path.join(__dirname, '../', data.cover_url)
    : null;
  const coverFileToken = coverLocalPath ? await uploadImageToBitable(coverLocalPath, appToken, token) : null;

  // 上传详情图
  const detailUrls = Array.isArray(data.detail_urls) ? data.detail_urls : [];
  const detailFileTokens = [];
  for (const dUrl of detailUrls) {
    const dPath = path.join(__dirname, '../', dUrl);
    const ft = await uploadImageToBitable(dPath, appToken, token);
    if (ft) detailFileTokens.push({ file_token: ft });
  }

  const today = new Date().toISOString().split('T')[0];
  // 资讯的发布日期，如果没有则使用今天
  const newsPubDate = data.news_pub_date
    ? new Date(data.news_pub_date).toISOString().split('T')[0]
    : today;

  const fields = {
    '资讯': data.news_title || data.title || '',
    'url': data.news_source_url || data.source_url || '',
    '标题': data.title || '',
    '正文': data.content || '',
    '创作时间': today,
    '资讯日期': newsPubDate,
  };

  if (data.tags) fields['Tags'] = data.tags;
  if (coverFileToken) fields['封面'] = [{ file_token: coverFileToken }];
  if (detailFileTokens.length > 0) fields['详情图'] = detailFileTokens;

  const resp = await axios.post(
    `${FEISHU_API}/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
    { fields },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (resp.data.code !== 0) {
    throw new Error(`写入多维表失败: ${resp.data.msg}`);
  }

  return { record_id: resp.data.data?.record?.record_id, appToken, tableId };
}

module.exports = { saveNewsToFeishu, getOrCreateDailyDoc, saveContentToFeishuBitable };
