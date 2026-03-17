import React, { useState, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { contentAPI, newsAPI } from '../services/api';
import { useToast } from '../components/Toast';
import './MakeContentPage.css';

// 生产模式用空串（同域），开发模式通过 package.json proxy 代理到后端
const API_BASE = process.env.NODE_ENV === 'production'
  ? (process.env.REACT_APP_API_URL?.replace('/api', '') || '')
  : '';

const TITLE_COLORS = [
  { value: '#06FFA5', label: '翠绿' },
  { value: '#FF6B35', label: '橙红' },
  { value: '#5478EB', label: '蓝紫' },
  { value: '#FFD700', label: '金黄' },
];

// 图片上传区域
function ImageUploader({ images, onImagesChange }) {
  const fileInputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(async (files) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    // 先生成本地预览立即显示，用临时 id 占位
    const previews = imageFiles.map((f) => ({
      filename: `preview-${Date.now()}-${f.name}`,
      url: URL.createObjectURL(f),
      originalname: f.name,
      uploading: true,
    }));
    onImagesChange((prev) => [...prev, ...previews]);

    // 异步上传
    const formData = new FormData();
    imageFiles.forEach((f) => formData.append('images', f));
    try {
      const resp = await contentAPI.uploadImages(formData);
      if (resp.data.success) {
        const uploaded = resp.data.data;
        onImagesChange((prev) => {
          let result = [...prev];
          previews.forEach((p, i) => {
            const idx = result.findIndex((r) => r.filename === p.filename);
            if (idx !== -1) result[idx] = uploaded[i];
          });
          return result;
        });
        previews.forEach((p) => URL.revokeObjectURL(p.url));
      }
    } catch (e) {
      onImagesChange((prev) => prev.filter((r) => !previews.some((p) => p.filename === r.filename)));
      previews.forEach((p) => URL.revokeObjectURL(p.url));
      console.error('上传失败', e);
    }
  }, [onImagesChange]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const handlePaste = useCallback(
    (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageItems = Array.from(items).filter((i) => i.type.startsWith('image/'));
      const files = imageItems.map((i) => i.getAsFile()).filter(Boolean);
      if (files.length > 0) handleFiles(files);
    },
    [handleFiles]
  );

  const removeImage = (filename) => {
    onImagesChange((prev) => prev.filter((img) => img.filename !== filename));
  };

  return (
    <div
      className={`image-uploader ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onPaste={handlePaste}
      tabIndex={0}
    >
      <div className="uploader-inner" onClick={() => fileInputRef.current?.click()}>
        <span className="uploader-icon">⊕</span>
        <span className="uploader-text">点击上传、拖拽或粘贴图片</span>
        <span className="uploader-hint">支持 JPG、PNG、GIF、WebP，最多 10 张</span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />
      {images.length > 0 && (
        <div className="image-preview-list">
          {images.map((img) => (
            <div key={img.filename} className="image-preview-item">
              <img
                src={img.uploading ? img.url : `${API_BASE}${img.url}`}
                alt={img.originalname}
                style={img.uploading ? { opacity: 0.5 } : {}}
              />
              <button className="remove-image-btn" onClick={(e) => { e.stopPropagation(); removeImage(img.filename); }}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 可编辑内容字段
function EditableField({ label, value, onChange, multiline, hint, children }) {
  return (
    <div className="editable-field">
      <label className="field-label">{label}</label>
      {children || (
        multiline ? (
          <textarea
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            rows={5}
          />
        ) : (
          <input value={value || ''} onChange={(e) => onChange(e.target.value)} />
        )
      )}
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  );
}

// 预览卡片（小红书风格）
function RedBookPreview({ title, content, coverUrl, detailUrls }) {
  const [currentImg, setCurrentImg] = useState(0);
  const allImages = [coverUrl, ...detailUrls].filter(Boolean);

  const copyText = (text) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <div className="redbook-preview">
      <h3 className="preview-title-bar">预览</h3>
      <div className="redbook-card">
        {/* 左侧图片轮播 2/3 */}
        <div className="redbook-images">
          {allImages.length > 0 ? (
            <>
              <div className="main-image">
                <img src={`${API_BASE}${allImages[currentImg]}`} alt="" />
                {allImages.length > 1 && (
                  <>
                    <button
                      className="img-nav prev"
                      onClick={() => setCurrentImg((p) => (p - 1 + allImages.length) % allImages.length)}
                    >
                      ‹
                    </button>
                    <button
                      className="img-nav next"
                      onClick={() => setCurrentImg((p) => (p + 1) % allImages.length)}
                    >
                      ›
                    </button>
                  </>
                )}
                <div className="img-dots">
                  {allImages.map((_, i) => (
                    <span
                      key={i}
                      className={`dot ${i === currentImg ? 'active' : ''}`}
                      onClick={() => setCurrentImg(i)}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="image-placeholder">
              <span>无图片</span>
            </div>
          )}
        </div>

        {/* 右侧文字 1/3 */}
        <div className="redbook-text">
          <div
            className="redbook-post-title"
            onClick={() => copyText(title)}
            title="点击复制标题"
          >
            {title || '内容标题'}
          </div>
          <div
            className="redbook-post-content"
            onClick={() => copyText(content)}
            title="点击复制正文"
          >
            {content || '内容正文将在此显示…'}
          </div>
          <div className="copy-hint">点击文字可复制</div>
        </div>
      </div>
    </div>
  );
}

export default function MakeContentPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const previewRef = useRef(null);

  const initialData = location.state || {};

  const [images, setImages] = useState([]);
  const [extraInfo, setExtraInfo] = useState('');
  const [creating, setCreating] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingBitable, setSavingBitable] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [renderResult, setRenderResult] = useState(null);
  const [editContent, setEditContent] = useState(null);
  const [titleColor, setTitleColor] = useState('#06FFA5');

  const handleCreate = async () => {
    if (!initialData.title) {
      toast.error('缺少资讯标题');
      return;
    }
    setCreating(true);
    try {
      const resp = await contentAPI.create({
        title: initialData.title,
        description: initialData.description,
        extra_info: extraInfo,
      });
      if (resp.data.success) {
        setEditContent({ ...resp.data.data });
        toast.success('内容创作完成！');
      }
    } catch (e) {
      toast.error(e.response?.data?.error || '创作失败');
    } finally {
      setCreating(false);
    }
  };

  const handleRender = async () => {
    if (!editContent) {
      toast.error('请先创作内容');
      return;
    }
    setRendering(true);
    try {
      const resp = await contentAPI.render({
        cover_word: editContent.cover_word,
        cover_title: editContent.cover_title,
        cover_description: editContent.cover_description,
        cover_emoji: editContent.cover_emoji,
        cover_title_color: titleColor,
        image_filenames: images.map((img) => img.filename),
      });
      if (resp.data.success) {
        setRenderResult(resp.data.data);
        toast.success('渲染完成！');
        // 渲染成功后自动滚动到预览区
        setTimeout(() => {
          previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    } catch (e) {
      toast.error(e.response?.data?.error || '渲染失败');
    } finally {
      setRendering(false);
    }
  };

  const handleDownload = async () => {
    if (!renderResult) return;
    setDownloading(true);
    try {
      const resp = await contentAPI.download({
        cover_url: renderResult.cover_url,
        detail_urls: renderResult.detail_urls,
      });
      const url = URL.createObjectURL(new Blob([resp.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `makecontents_${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('下载完成！');
    } catch (e) {
      toast.error('下载失败');
    } finally {
      setDownloading(false);
    }
  };

  const handleSaveContent = async () => {
    if (!renderResult && !editContent) return;
    setSaving(true);
    try {
      await contentAPI.saveContent({
        title: editContent?.title || '',
        content: editContent?.content || '',
        cover_url: renderResult?.cover_url || '',
        detail_urls: renderResult?.detail_urls || [],
        source_url: initialData.link || '',
      });
      toast.success('已保存到资源库！');
    } catch (e) {
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveToBitable = async () => {
    if (!renderResult && !editContent) return;
    setSavingBitable(true);
    try {
      await contentAPI.saveToBitable({
        title: editContent?.title || '',
        content: editContent?.content || '',
        cover_url: renderResult?.cover_url || '',
        detail_urls: renderResult?.detail_urls || [],
        source_url: initialData.link || '',
        news_title: initialData.title || '',
        news_source_url: initialData.link || '',
        news_pub_date: initialData.pub_date,
      });
      toast.success('已保存到飞书多维表！');
    } catch (e) {
      toast.error(e.response?.data?.error || '保存到多维表失败');
    } finally {
      setSavingBitable(false);
    }
  };

  const handlePublishXhs = async () => {
    if (!renderResult) return;
    setPublishing(true);
    try {
      const resp = await contentAPI.publishXhs({
        title: editContent?.title || '',
        desc: editContent?.content || '',
        cover_url: renderResult.cover_url,
        detail_urls: renderResult.detail_urls || [],
        is_private: false,
      });
      if (resp.data.success) {
        const noteUrl = resp.data.data?.note_url;
        toast.success(noteUrl
          ? `发布成功！笔记链接：${noteUrl}`
          : '发布成功！');
      }
    } catch (e) {
      toast.error(e.response?.data?.error || '发布小红书失败');
    } finally {
      setPublishing(false);
    }
  };

  // 推送相关状态
  const [pushing, setPushing] = useState(false);
  const [pushType, setPushType] = useState(null);
  const [showPushModal, setShowPushModal] = useState(false);
  const [pushForm, setPushForm] = useState({ news_title: '', news_summary: '' });

  const openPushModal = (type) => {
    if (!initialData.id) {
      toast.error('无法推送：缺少资讯来源');
      return;
    }
    setPushType(type);
    // 预填充标题和摘要
    const title = editContent?.title || initialData.title || '';
    const summary = editContent?.content
      ? editContent.content.substring(0, 200) + (editContent.content.length > 200 ? '…' : '')
      : initialData.description
        ? initialData.description.substring(0, 200) + (initialData.description.length > 200 ? '…' : '')
        : '';
    setPushForm({
      news_title: title.length > 30 ? title.substring(0, 30) : title,
      news_summary: summary,
    });
    setShowPushModal(true);
  };

  const handlePush = async () => {
    if (!pushType || !initialData.id) {
      toast.error('缺少资讯ID，无法推送');
      return;
    }
    setPushing(true);
    try {
      const apiMap = {
        ainews: newsAPI.ainews,
        aitopics: newsAPI.aitopics,
        aitools: newsAPI.aitools,
      };
      const resp = await apiMap[pushType](initialData.id, {
        news_title: pushForm.news_title,
        news_summary: pushForm.news_summary,
      });
      if (resp.data.success) {
        toast.success(`${getPushTypeLabel(pushType)} 推送成功！`);
        setShowPushModal(false);
      }
    } catch (e) {
      toast.error(e.response?.data?.error || '推送失败');
    } finally {
      setPushing(false);
    }
  };

  const updateEdit = (key) => (val) => {
    setEditContent((prev) => ({ ...prev, [key]: val }));
  };

  // 获取推送类型标签
  const getPushTypeLabel = (type) => {
    const labels = { ainews: '资讯速报', aitopics: '话题讨论', aitools: '工具推荐' };
    return labels[type] || type;
  };

  // 推送弹窗组件
  const PushModal = () => {
    if (!showPushModal) return null;
    return (
      <div className="modal-overlay" onClick={() => setShowPushModal(false)}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h3>推送内容编辑</h3>
            <button className="modal-close" onClick={() => setShowPushModal(false)}>✕</button>
          </div>
          <div className="modal-body">
            <div className="push-type-badge">{getPushTypeLabel(pushType)}</div>
            <div className="form-group">
              <label>推送标题（≤30字）</label>
              <input
                type="text"
                value={pushForm.news_title}
                onChange={(e) => setPushForm({ ...pushForm, news_title: e.target.value })}
                placeholder="输入推送标题"
                maxLength={30}
              />
              <span className="char-count">{pushForm.news_title.length}/30</span>
            </div>
            <div className="form-group">
              <label>推送摘要（100-200字）</label>
              <textarea
                value={pushForm.news_summary}
                onChange={(e) => setPushForm({ ...pushForm, news_summary: e.target.value })}
                placeholder="输入推送摘要内容"
                rows={5}
              />
              <span className="char-count">{pushForm.news_summary.length}字</span>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setShowPushModal(false)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={handlePush}
              disabled={pushing || !pushForm.news_title || !pushForm.news_summary}
            >
              {pushing ? (
                <>
                  <span className="spinner" style={{ width: 14, height: 14 }} />
                  推送中…
                </>
              ) : (
                '✓ 确认推送'
              )}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="make-content-page">
      <div className="make-content-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          ← 返回
        </button>
        <h1 className="make-content-title">内容创作</h1>
      </div>

      <div className="make-content-body">
        {/* 左栏：输入与创作 */}
        <div className="make-content-left">
          {/* 资讯信息 */}
          <div className="card news-info-card">
            <h3 className="card-section-title">资讯信息</h3>
            <div className="news-info-title">{initialData.title || '无标题'}</div>
            {initialData.description && (
              <div className="news-info-desc">
                {initialData.description.substring(0, 300)}
                {initialData.description.length > 300 ? '…' : ''}
              </div>
            )}
            {initialData.link && (
              <a
                href={initialData.link}
                target="_blank"
                rel="noopener noreferrer"
                className="news-info-link"
              >
                查看原文 ↗
              </a>
            )}
          </div>

          {/* 图片上传 */}
          <div className="card">
            <h3 className="card-section-title">图片素材</h3>
            <ImageUploader images={images} onImagesChange={setImages} />
          </div>

          {/* 补充信息 */}
          <div className="card">
            <h3 className="card-section-title">补充信息（选填）</h3>
            <textarea
              value={extraInfo}
              onChange={(e) => setExtraInfo(e.target.value)}
              placeholder="可以填写创作方向、风格偏好、补充背景信息等…"
              rows={4}
            />
          </div>

          {/* 创作按钮 */}
          <button
            className="btn btn-primary create-btn"
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? (
              <>
                <span className="spinner" style={{ width: 16, height: 16 }} />
                内容创作中…
              </>
            ) : (
              '✦ 开始创作内容'
            )}
          </button>

          {/* 创作结果编辑 */}
          {editContent && (
            <div className="card created-content-card">
              <h3 className="card-section-title">创作结果（可编辑）</h3>
              <div className="edit-fields-grid">
                <EditableField
                  label="封面英文词 (cover_word)"
                  value={editContent.cover_word}
                  onChange={updateEdit('cover_word')}
                  hint="一个概括性英文单词"
                />
                <EditableField
                  label="封面 Emoji (cover_emoji)"
                  value={editContent.cover_emoji}
                  onChange={updateEdit('cover_emoji')}
                />
                <div style={{ gridColumn: '1/-1' }}>
                  <EditableField label="封面主标题颜色">
                    <div className="color-picker-row">
                      {TITLE_COLORS.map((c) => (
                        <button
                          key={c.value}
                          className={`color-chip ${titleColor === c.value ? 'active' : ''}`}
                          style={{ '--chip-color': c.value }}
                          onClick={() => setTitleColor(c.value)}
                          title={c.label}
                        >
                          <span className="chip-dot" style={{ background: c.value }} />
                          <span className="chip-label">{c.label}</span>
                        </button>
                      ))}
                    </div>
                  </EditableField>
                </div>
                <EditableField
                  label="封面主标题 (cover_title)"
                  value={editContent.cover_title}
                  onChange={updateEdit('cover_title')}
                  hint="不超过 15 字"
                />
                <EditableField
                  label="封面描述 (cover_description)"
                  value={editContent.cover_description}
                  onChange={updateEdit('cover_description')}
                  hint="不超过 20 字"
                />
                <div style={{ gridColumn: '1/-1' }}>
                  <EditableField
                    label="内容标题 (title)"
                    value={editContent.title}
                    onChange={updateEdit('title')}
                    hint="不超过 20 字"
                  />
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <EditableField
                    label="内容正文 (content)"
                    value={editContent.content}
                    onChange={updateEdit('content')}
                    multiline
                  />
                </div>
              </div>

              <button
                className="btn btn-primary render-btn"
                onClick={handleRender}
                disabled={rendering}
              >
                {rendering ? (
                  <>
                    <span className="spinner" style={{ width: 16, height: 16 }} />
                    渲染中…
                  </>
                ) : (
                  '◈ 渲染封面和图片'
                )}
              </button>
            </div>
          )}
        </div>

        {/* 右栏：预览 + 操作按钮 */}
        <div className="make-content-right" ref={previewRef}>
          {(renderResult || editContent) ? (
            <>
              <RedBookPreview
                title={editContent?.title || ''}
                content={editContent?.content || ''}
                coverUrl={renderResult?.cover_url || ''}
                detailUrls={renderResult?.detail_urls || []}
              />

              {/* 渲染成功后的所有操作按钮统一放在预览区下方 */}
              {renderResult && (
                <div className="render-actions">
                  <button
                    className="btn btn-ghost"
                    onClick={handleDownload}
                    disabled={downloading}
                    title="打包下载所有图片"
                  >
                    {downloading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '↓'}
                    {downloading ? ' 打包中…' : ' 下载图片'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={handleSaveContent}
                    disabled={saving}
                    title="保存到资源库"
                  >
                    {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '★'}
                    {saving ? ' 保存中…' : ' 保存到资源库'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={handleSaveToBitable}
                    disabled={savingBitable}
                    title="保存到飞书多维表供审核"
                  >
                    {savingBitable ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '⊞'}
                    {savingBitable ? ' 同步中…' : ' 存入多维表'}
                  </button>
                  <div className="action-divider" />
                  <button
                    className="btn btn-push btn-push-news"
                    onClick={() => openPushModal('ainews')}
                    disabled={pushing}
                    title="推送到 AINews（资讯速报）"
                  >
                    {pushing && pushType === 'ainews' ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '◈'}
                    {pushing && pushType === 'ainews' ? ' 推送中…' : ' AINews'}
                  </button>
                  <button
                    className="btn btn-push btn-push-topics"
                    onClick={() => openPushModal('aitopics')}
                    disabled={pushing}
                    title="推送到 AITopics（话题讨论）"
                  >
                    {pushing && pushType === 'aitopics' ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '◉'}
                    {pushing && pushType === 'aitopics' ? ' 推送中…' : ' AITopics'}
                  </button>
                  <button
                    className="btn btn-push btn-push-tools"
                    onClick={() => openPushModal('aitools')}
                    disabled={pushing}
                    title="推送到 AITools（工具推荐）"
                  >
                    {pushing && pushType === 'aitools' ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '⚒'}
                    {pushing && pushType === 'aitools' ? ' 推送中…' : ' AITools'}
                  </button>
                  <div className="action-divider" />
                  <button
                    className="btn btn-xhs"
                    onClick={handlePublishXhs}
                    disabled={publishing}
                    title="发布到小红书（需在配置中开启）"
                  >
                    {publishing ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '✿'}
                    {publishing ? ' 发布中…' : ' 发布到小红书'}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="preview-placeholder">
              <div className="preview-placeholder-inner">
                <span style={{ fontSize: 48 }}>◈</span>
                <p>点击「开始创作内容」后，预览将在此显示</p>
              </div>
            </div>
          )}
        </div>
      </div>
      <PushModal />
    </div>
  );
}
