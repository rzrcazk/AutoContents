const db = require('../db/database');

const DEFAULT_CONFIG = {
  translate_model: '',
  translate_base_url: '',
  translate_api_key: '',
  translate_sys_prompt: '你是一个专业翻译，请将以下内容翻译为简体中文，保持原意，输出纯文本，不要加任何解释。',
  edit_model: '',
  edit_base_url: '',
  edit_api_key: '',
  edit_sys_prompt: '你是一个专业的新闻编辑，请将提供的新闻标题和内容进行结构化提炼，输出简短精炼的资讯标题和新闻概要。',
  aitopics_sys_prompt: '你是一个擅长引导话题讨论的内容编辑，请将新闻改写为能激发读者思考和参与讨论的资讯推文，要有鲜明观点，结尾提出引导性问题。',
  aitools_sys_prompt: '你是一个 AI 工具评测达人，请将新闻改写为工具推荐性资讯，突出工具的核心功能、使用场景和亮点，语气积极热情，让读者有想尝试的冲动。',
  create_model: '',
  create_base_url: '',
  create_api_key: '',
  create_sys_prompt: '你是一个优秀的内容创作者，擅长将资讯内容改写为小红书风格的内容。',
  feishu_app_id: '',
  feishu_app_secret: '',
  feishu_space_id: '',
  feishu_parent_node_token: '',
  wechat_api_key: '',
  wechat_wxids: '[]',
  wechat_room_names: '[]',
  wechat_wxids_enabled: '1',
  wechat_rooms_enabled: '1',
  wechat_enabled: '1',
  blacklist_keywords: '["广告","推广","招聘","求职"]',
  allowlist_keywords: '[]',
  allowlist_scope: 'title',
  feishu_bitable_url: '',
  feishu_bot_webhook: '',
  xhs_cookie: '',
  xhs_enabled: '0',
};

async function getConfig(key) {
  const row = await db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  if (row) return row.value;
  return DEFAULT_CONFIG[key] ?? null;
}

async function setConfig(key, value) {
  await db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, value);
}

async function getAllConfig() {
  const rows = await db.prepare('SELECT key, value FROM config').all();
  const result = { ...DEFAULT_CONFIG };
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

async function setMultiConfig(obj) {
  const entries = Object.entries(obj);
  for (const [k, v] of entries) {
    await db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(k, String(v ?? ''));
  }
}

async function getBlacklist() {
  const raw = await getConfig('blacklist_keywords');
  try {
    return JSON.parse(raw) || [];
  } catch {
    return [];
  }
}

async function getAllowlist() {
  const raw = await getConfig('allowlist_keywords');
  try {
    return JSON.parse(raw) || [];
  } catch {
    return [];
  }
}

async function getAllowlistScope() {
  return await getConfig('allowlist_scope') || 'title';
}

async function getLLMConfig(type) {
  const cfg = await getAllConfig();
  const model = cfg[`${type}_model`] || '';
  const baseUrl = cfg[`${type}_base_url`] || '';
  const apiKey = cfg[`${type}_api_key`] || '';
  const sysPrompt = cfg[`${type}_sys_prompt`] || DEFAULT_CONFIG[`${type}_sys_prompt`] || '';
  return { model, baseUrl, apiKey, sysPrompt };
}

module.exports = {
  getConfig,
  setConfig,
  getAllConfig,
  setMultiConfig,
  getBlacklist,
  getAllowlist,
  getAllowlistScope,
  getLLMConfig,
};
