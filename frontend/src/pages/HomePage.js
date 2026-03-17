import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { newsAPI, sourcesAPI } from '../services/api';
import { useToast } from '../components/Toast';
import './HomePage.css';

function NewsCard({ item, onHide, onPushed, onSaved, onMakeContent }) {
  const [pushLoading, setPushLoading] = useState(false); // false | 'ainews' | 'aitopics' | 'aitools'
  const [saveLoading, setSaveLoading] = useState(false);
  const toast = useToast();

  const displayTitle = item.translated_title || item.title || '无标题';
  const displayDesc = item.translated_description || item.description || '';

  const handlePush = async (type) => {
    if (pushLoading) return;
    setPushLoading(type);
    try {
      const apiMap = { ainews: newsAPI.ainews, aitopics: newsAPI.aitopics, aitools: newsAPI.aitools };
      const resp = await apiMap[type](item.id);
      if (resp.data.success) {
        toast.success('推送成功！');
        onPushed && onPushed(item.id);
      }
    } catch (e) {
      toast.error(e.response?.data?.error || '推送失败');
    } finally {
      setPushLoading(false);
    }
  };

  const handleSave = async () => {
    setSaveLoading(true);
    try {
      if (item.saved) {
        await newsAPI.unsave(item.id);
        toast.success('已取消保存');
        onSaved && onSaved(item.id, false);
      } else {
        await newsAPI.save(item.id);
        toast.success('已保存到资源库');
        onSaved && onSaved(item.id, true);
      }
    } catch (e) {
      toast.error('操作失败');
    } finally {
      setSaveLoading(false);
    }
  };

  const pubDate = item.pub_date
    ? new Date(item.pub_date).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className={`news-card ${item.ai_newsed ? 'ai-newsed' : ''}`}>
      <div className="news-card-header">
        {item.ai_newsed && <span className="badge badge-success" style={{ fontSize: '10px' }}>已推送</span>}
        {item.saved ? <span className="badge badge-warning" style={{ fontSize: '10px' }}>已保存</span> : null}
        {pubDate && <span className="news-date">{pubDate}</span>}
      </div>
      <div className="news-title">{displayTitle}</div>
      {displayDesc && (
        <div className="news-desc">{displayDesc.substring(0, 200)}{displayDesc.length > 200 ? '…' : ''}</div>
      )}
      <div className="news-actions">
        {item.link && (
          <a href={item.link} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
            原文
          </a>
        )}
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => handlePush('ainews')}
          disabled={pushLoading}
          title="资讯速报 #AINews"
        >
          {pushLoading === 'ainews' ? <span className="spinner" style={{ width: 11, height: 11 }} /> : null}
          AINews
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => handlePush('aitopics')}
          disabled={pushLoading}
          title="话题讨论 #AITopic"
        >
          {pushLoading === 'aitopics' ? <span className="spinner" style={{ width: 11, height: 11 }} /> : null}
          AITopics
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => handlePush('aitools')}
          disabled={pushLoading}
          title="工具推荐 #AITools"
        >
          {pushLoading === 'aitools' ? <span className="spinner" style={{ width: 11, height: 11 }} /> : null}
          AITools
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onMakeContent(item)}
          title="进入内容创作"
        >
          创作
        </button>
        <button
          className={`btn btn-sm ${item.saved ? 'btn-warning-ghost' : 'btn-ghost'}`}
          onClick={handleSave}
          disabled={saveLoading}
          title={item.saved ? '取消保存' : '保存到资源库'}
        >
          {item.saved ? '★' : '☆'}
        </button>
        <button
          className="btn btn-danger btn-sm"
          onClick={() => onHide(item.id)}
          title="移除此条资讯"
        >
          移除
        </button>
      </div>
    </div>
  );
}

function SourceSection({ sourceData, onHide, onPushed, onSaved, onMakeContent }) {
  const { source, items } = sourceData;
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="source-section">
      <div className="source-header" onClick={() => setExpanded(!expanded)}>
        <div className="source-info">
          <span className="source-name">{source.name}</span>
          <span className={`badge ${source.type === 'rsshub' ? 'badge-success' : 'badge-warning'}`}>
            {source.type.toUpperCase()}
          </span>
          {source.translate ? <span className="badge badge-warning">翻译中</span> : null}
          <span className="news-count">{items.length} 条</span>
        </div>
        <span className="expand-icon">{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div className="news-list">
          {items.length === 0 ? (
            <div className="empty-state" style={{ padding: '30px' }}>
              <div className="empty-state-text">暂无资讯，点击「拉取」获取最新内容</div>
            </div>
          ) : (
            items.map((item) => (
              <NewsCard
                key={item.id}
                item={item}
                onHide={onHide}
                onPushed={onPushed}
                onSaved={onSaved}
                onMakeContent={onMakeContent}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  const [groupedNews, setGroupedNews] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchResults, setFetchResults] = useState(null);
  const [sources, setSources] = useState([]);

  // 筛选状态
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedSourceIds, setSelectedSourceIds] = useState([]);
  const [showFilters, setShowFilters] = useState(false);

  const toast = useToast();
  const navigate = useNavigate();

  // 获取信源列表
  const loadSources = useCallback(async () => {
    try {
      const resp = await sourcesAPI.list();
      if (resp.data.success) {
        setSources(resp.data.data.filter(s => s.enabled));
      }
    } catch (e) {
      console.error('加载信源失败:', e);
    }
  }, []);

  const toastError = toast.error;

  // 计算默认开始日期（30天前）
  const getDefaultStartDate = () => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split('T')[0];
  };

  const loadNews = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};

      // 添加信源筛选
      if (selectedSourceIds.length > 0) {
        params.source_ids = JSON.stringify(selectedSourceIds);
      }

      // 添加时间筛选
      if (startDate) {
        params.start_date = new Date(startDate).toISOString();
      }
      if (endDate) {
        // 结束日期设置为当天的23:59:59
        const endDateTime = new Date(endDate);
        endDateTime.setHours(23, 59, 59, 999);
        params.end_date = endDateTime.toISOString();
      }

      const resp = await newsAPI.grouped(params);
      if (resp.data.success) {
        setGroupedNews(resp.data.data);
      }
    } catch (e) {
      toastError('加载资讯失败');
    } finally {
      setLoading(false);
    }
  }, [toastError, selectedSourceIds, startDate, endDate]);

  useEffect(() => {
    loadSources();
    // 设置默认开始日期为30天前
    setStartDate(getDefaultStartDate());
  }, [loadSources]);

  useEffect(() => {
    loadNews();
  }, [loadNews]);

  const handleFetch = async () => {
    setFetching(true);
    setFetchResults(null);
    try {
      const resp = await newsAPI.fetch();
      if (resp.data.success) {
        setFetchResults(resp.data.data);
        toast.success('拉取完成！');
        await loadNews();
      }
    } catch (e) {
      toast.error(e.response?.data?.error || '拉取失败');
    } finally {
      setFetching(false);
    }
  };

  const handleSourceToggle = (sourceId) => {
    setSelectedSourceIds(prev =>
      prev.includes(sourceId)
        ? prev.filter(id => id !== sourceId)
        : [...prev, sourceId]
    );
  };

  const handleSelectAllSources = () => {
    setSelectedSourceIds([]);
  };

  const handleClearFilters = () => {
    setStartDate(getDefaultStartDate());
    setEndDate('');
    setSelectedSourceIds([]);
  };

  const handleHide = async (newsId) => {
    try {
      await newsAPI.hide(newsId);
      setGroupedNews((prev) =>
        prev.map((sg) => ({
          ...sg,
          items: sg.items.filter((i) => i.id !== newsId),
        }))
      );
      toast.success('已移除');
    } catch (e) {
      toast.error('移除失败');
    }
  };

  const handlePushed = (newsId) => {
    setGroupedNews((prev) =>
      prev.map((sg) => ({
        ...sg,
        items: sg.items.map((i) => (i.id === newsId ? { ...i, ai_newsed: 1 } : i)),
      }))
    );
  };

  const handleSaved = (newsId, saved) => {
    setGroupedNews((prev) =>
      prev.map((sg) => ({
        ...sg,
        items: sg.items.map((i) => (i.id === newsId ? { ...i, saved: saved ? 1 : 0 } : i)),
      }))
    );
  };

  const handleMakeContent = (item) => {
    navigate('/make-content', {
      state: {
        id: item.id,
        title: item.translated_title || item.title,
        description: item.translated_description || item.description,
        link: item.link,
        pub_date: item.pub_date,
      },
    });
  };

  const totalCount = groupedNews.reduce((sum, sg) => sum + sg.items.length, 0);

  // 格式化日期显示
  const formatDateLabel = () => {
    if (!startDate && !endDate) return '全部时间';
    if (startDate && !endDate) return `${startDate} 至今`;
    if (!startDate && endDate) return `${endDate} 之前`;
    return `${startDate} 至 ${endDate}`;
  };

  // 格式化信源显示
  const formatSourceLabel = () => {
    if (selectedSourceIds.length === 0) return '所有信源';
    if (selectedSourceIds.length === 1) {
      const source = sources.find(s => s.id === selectedSourceIds[0]);
      return source ? source.name : '1个信源';
    }
    return `${selectedSourceIds.length}个信源`;
  };

  return (
    <div className="home-page page-container">
      <div className="page-header">
        <div className="page-title-area">
          <h1 className="page-title">资讯聚合</h1>
          <span className="total-badge">{totalCount} 条</span>
        </div>
        <div className="header-actions">
          {fetchResults && (
            <div className="fetch-summary">
              {fetchResults.map((r, i) => (
                <span key={i} className="fetch-result-item">
                  {r.source}: {r.error ? `❌ ${r.error}` : `+${r.newCount ?? 0}`}
                </span>
              ))}
            </div>
          )}
          <button
            className="btn btn-primary"
            onClick={handleFetch}
            disabled={fetching}
          >
            {fetching ? (
              <>
                <span className="spinner" style={{ width: 14, height: 14 }} />
                拉取中…
              </>
            ) : (
              '↻ 拉取最新'
            )}
          </button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="filter-bar">
        <div className="filter-row">
          {/* 时间筛选 */}
          <div className="filter-group">
            <label className="filter-label">时间范围</label>
            <div className="filter-inputs">
              <input
                type="date"
                className="filter-date-input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                placeholder="开始日期"
              />
              <span className="filter-separator">至</span>
              <input
                type="date"
                className="filter-date-input"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                placeholder="结束日期"
              />
            </div>
          </div>

          {/* 信源筛选 */}
          <div className="filter-group">
            <label className="filter-label">信源</label>
            <div className="filter-source-select">
              <div className="source-dropdown-trigger" onClick={() => setShowFilters(!showFilters)}>
                <span className="source-dropdown-text">{formatSourceLabel()}</span>
                <span className="expand-icon">{showFilters ? '▲' : '▼'}</span>
              </div>
              {showFilters && (
                <div className="source-dropdown-menu">
                  <div className="source-dropdown-item" onClick={handleSelectAllSources}>
                    <input
                      type="checkbox"
                      checked={selectedSourceIds.length === 0}
                      readOnly
                      className="source-checkbox"
                    />
                    <span className="source-name">所有信源</span>
                  </div>
                  {sources.map(source => (
                    <div
                      key={source.id}
                      className="source-dropdown-item"
                      onClick={() => handleSourceToggle(source.id)}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSourceIds.includes(source.id)}
                        readOnly
                        className="source-checkbox"
                      />
                      <span className="source-name">{source.name}</span>
                      <span className={`badge ${source.type === 'rsshub' ? 'badge-success' : 'badge-warning'}`}>
                        {source.type.toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 筛选操作 */}
          <div className="filter-actions">
            <button className="btn btn-ghost btn-sm" onClick={handleClearFilters}>
              重置
            </button>
          </div>
        </div>

        {/* 当前筛选标签 */}
        {(startDate || endDate || selectedSourceIds.length > 0) && (
          <div className="filter-tags">
            <span className="filter-tag-label">当前筛选：</span>
            <span className="filter-tag">
              时间: {formatDateLabel()}
            </span>
            {selectedSourceIds.length > 0 && (
              <span className="filter-tag">
                信源: {formatSourceLabel()}
              </span>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="loading-state">
          <span className="spinner" />
          <span>加载资讯…</span>
        </div>
      ) : groupedNews.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📰</div>
          <div className="empty-state-text">暂无符合条件的资讯</div>
        </div>
      ) : (
        <div className="sources-grid">
          {groupedNews.map((sg) => (
            <SourceSection
              key={sg.source.id}
              sourceData={sg}
              onHide={handleHide}
              onPushed={handlePushed}
              onSaved={handleSaved}
              onMakeContent={handleMakeContent}
            />
          ))}
        </div>
      )}
    </div>
  );
}
