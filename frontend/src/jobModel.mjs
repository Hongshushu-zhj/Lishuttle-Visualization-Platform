export const terminalJobStates = new Set(['done', 'partial', 'failed', 'cancelled', 'timed_out', 'interrupted']);
export const jobStateLabel = status => ({ queued: '排队中', running: '绘图中', cancelling: '正在取消并等待 MATLAB 停止', done: '全部完成', partial: '部分完成', failed: '失败', cancelled: '已取消', timed_out: '已超时', interrupted: '上次运行被中断' }[status] || status);
export function jobPercent(job) { return job?.total ? Math.min(100, Math.round(((job.done || 0) + (job.failed || 0) + (job.cancelled || 0)) / job.total * 100)) : 0; }
