import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3710/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 120000,
});

// 信源
export const sourcesAPI = {
  list: () => api.get('/sources'),
  create: (data) => api.post('/sources', data),
  update: (id, data) => api.put(`/sources/${id}`, data),
  delete: (id) => api.delete(`/sources/${id}`),
};

// 配置
export const configAPI = {
  get: () => api.get('/config'),
  save: (data) => api.post('/config', data),
};

// 资讯
export const newsAPI = {
  list: (params) => api.get('/news', { params }),
  grouped: (params) => api.get('/news/grouped', { params }),
  raw: () => api.get('/news/raw'),
  saved: () => api.get('/news/saved'),
  fetch: (source_id, days) => api.post('/news/fetch', source_id ? { source_id, days } : { days }),
  hide: (id) => api.post(`/news/${id}/hide`),
  save: (id) => api.post(`/news/${id}/save`),
  unsave: (id) => api.post(`/news/${id}/unsave`),
  ainews: (id, data) => api.post(`/news/${id}/ainews`, data),
  aitopics: (id, data) => api.post(`/news/${id}/aitopics`, data),
  aitools: (id, data) => api.post(`/news/${id}/aitools`, data),
  detail: (id) => api.get(`/news/${id}`),
};

// 内容创作
export const contentAPI = {
  uploadImages: (formData) =>
    api.post('/content/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  create: (data) => api.post('/content/create', data),
  render: (data) => api.post('/content/render', data),
  download: (data) => api.post('/content/download', data, { responseType: 'blob' }),
  saveContent: (data) => api.post('/content/save', data),
  saveToBitable: (data) => api.post('/content/save-to-bitable', data),
  notifyBot: (message) => api.post('/content/notify-bot', { message }),
  savedList: () => api.get('/content/saved'),
  deleteSaved: (id) => api.delete(`/content/saved/${id}`),
  publishXhs: (data) => api.post('/content/publish-xhs', data),
};

export default api;
