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

export const listDrives = () => req('/fs/drives');
export const listDir = (path) => req(`/fs/list?path=${encodeURIComponent(path)}`);

// requests: [{ sourceId, dataType, layers: ['ground','10m'] | ['all'] }]
export const plot = (requests, dryRun = false) =>
  req('/plot', { method: 'POST', body: JSON.stringify({ requests, dryRun }) });
export const getJob = (id) => req(`/jobs/${id}`);
export const exportZip = (requests) => req('/export', { method: 'POST', body: JSON.stringify({ requests }) });

export const imageUrl = (fig, download = false, version = 0) => {
  const params = [];
  if (download) params.push('download=1');
  if (version) params.push(`v=${version}`);
  return fig.url + (params.length ? `?${params.join('&')}` : '');
};
