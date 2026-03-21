const axios = require('axios');
const { getConfig } = require('./configService');

const WECHAT_API_BASE = 'https://api-bot.aibotk.com/openapi/v1/chat';

function randomDelay(min = 5000, max = 10000) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min)
  );
}

async function sendToContact(apiKey, wxid, content) {
  await axios.post(`${WECHAT_API_BASE}/contact`, {
    apiKey,
    message: { content, type: 1 },
    wxid,
  });
}

async function sendToRoom(apiKey, roomName, content) {
  await axios.post(`${WECHAT_API_BASE}/room`, {
    apiKey,
    message: { content, type: 1 },
    roomName,
  });
}

async function pushAINews(newsTitle, newsSummary, tag = '#AINews') {
  const enabled = getConfig('wechat_enabled');
  if (enabled !== '1') return { skipped: true, reason: '微信推送已关闭' };

  const apiKey = getConfig('wechat_api_key');
  if (!apiKey) throw new Error('未配置微信 API Key');

  const content = `${newsTitle}\n\n${newsSummary}\n\n${tag}`;

  const results = [];

  // 推送私信
  const wxidsEnabled = getConfig('wechat_wxids_enabled');
  if (wxidsEnabled === '1') {
    let wxids = [];
    try {
      wxids = JSON.parse(getConfig('wechat_wxids') || '[]');
    } catch {}

    for (let i = 0; i < wxids.length; i++) {
      if (i > 0) await randomDelay();
      try {
        await sendToContact(apiKey, wxids[i], content);
        results.push({ type: 'wxid', target: wxids[i], success: true });
      } catch (e) {
        results.push({ type: 'wxid', target: wxids[i], success: false, error: e.message });
      }
    }
  }

  // 推送群聊
  const roomsEnabled = getConfig('wechat_rooms_enabled');
  if (roomsEnabled === '1') {
    let rooms = [];
    try {
      rooms = JSON.parse(getConfig('wechat_room_names') || '[]');
    } catch {}

    for (let i = 0; i < rooms.length; i++) {
      if (i > 0 || results.length > 0) await randomDelay();
      try {
        await sendToRoom(apiKey, rooms[i], content);
        results.push({ type: 'room', target: rooms[i], success: true });
      } catch (e) {
        results.push({ type: 'room', target: rooms[i], success: false, error: e.message });
      }
    }
  }

  return { results };
}

/**
 * 发送消息到飞书机器人 Webhook
 * 支持纯文本消息
 */
async function notifyFeishuBot(message) {
  const webhook = await getConfig('feishu_bot_webhook');
  if (!webhook) throw new Error('未配置飞书机器人 Webhook 地址');

  const resp = await axios.post(webhook, {
    msg_type: 'text',
    content: { text: message },
  });

  if (resp.data.code !== undefined && resp.data.code !== 0) {
    throw new Error(`飞书 Webhook 发送失败: ${resp.data.msg}`);
  }

  return { success: true };
}

module.exports = { pushAINews, notifyFeishuBot };
