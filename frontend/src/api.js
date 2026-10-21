const BASE = '/api';

async function req(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`服务返回异常(${res.status}),请确认后端已启动`);
  }
  if (!res.ok) throw new Error(data.error || `请求失败(${res.status})`);
  return data;
}

export const health = () => req('/health');

export const listSources = () => req('/sources');
export const addSource = (path) => req('/sources', { method: 'POST', body: JSON.stringify({ path }) });
export const deleteSource = (id) => req(`/sources/${id}`, { method: 'DELETE' });
export const refreshSource = (id) => req(`/sources/${id}/refresh`, { method: 'POST' });
export const openResultsFolder = (id, dataType = '', taskId) =>
  req(`/sources/${id}/open-results`, { method: 'POST', body: JSON.stringify({ dataType, taskId }) });

export const listDrives = () => req('/fs/drives');
export const listDir = (path) => req(`/fs/list?path=${encodeURIComponent(path)}`);

// requests: [{ sourceId, dataType, layers: ['ground','10m'] | ['all'] }]
// options:  { coordMode: 'abs' | 'rel-ll' | 'rel-center' }
export const plot = (requests, dryRun = false, options = {}) =>
  req('/plot', { method: 'POST', body: JSON.stringify({ requests, dryRun, options }) });
export const getJob = (id) => req(`/jobs/${id}`);
export const loadRasterPreview = (fig) => req('/preview', { method: 'POST', body: JSON.stringify({
  sourceId: fig.sourceId, taskId: fig.taskId, dataType: fig.dataType, layer: fig.layer,
}) });
export const saveRasterPreview = (fig, options) => req('/preview/save', { method: 'POST', body: JSON.stringify({
  sourceId: fig.sourceId, taskId: fig.taskId, dataType: fig.dataType, layer: fig.layer, ...options,
}) });
export const exportZip = (requests, options = {}) =>
  req('/export', { method: 'POST', body: JSON.stringify({ requests, options }) });

export const imageUrl = (fig, download = false, version = 0) => {
  const params = [];
  if (download) params.push('download=1');
  if (version) params.push(`v=${version}`);
  return fig.url + (params.length ? `${fig.url.includes('?') ? '&' : '?'}${params.join('&')}` : '');
};
