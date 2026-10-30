# Desktop V1 功能基线

执行日期：2026-10-30（北京时间）。源 revision：`7b94004`；工作区 `antenna-draw-desktop`；分支 `feature/desktop-v1`。

环境：Windows 11 x64（内核 10.0.26200），Node v24.15.0，npm 11.12.1，MATLAB 9.12.0.1884302 (R2022a)。

## 必须保持的口径

- 室内多楼层、室外地面/高度层，多任务与墙线优先级；五种绘图类型、三种坐标模式、同批统一范围。
- int16 little-endian；-32768 无效；室外 DLRSSINR 的零值无效，室内零值有效；BESTSERVER 保留类别绘图，分析界面不提供连续统计入口。
- 完整栅格统计、最近秩分位数、色标、预览、缓存依赖失效、中文文件名、PNG/ZIP/CSV 导出。
- `node scripts/create-demo.cjs` 仅在新目录生成演示样本，不注册数据源。三个任务：室内 A（F1/F2）、室内 B（缺 F2）、室外（ground/10m）；含五种指标及无效值。
- 室内 RSRP 原值 `[-10000,-9000,-8000,-32768]`：4 样本/3 有效，min=-100、max=-80、mean=median=-90、p10=-100、p90=-80。

## 已执行证据

`node scripts/baseline.cjs` 对每条命令分别记录退出码，原始输出位于忽略的 `.desktop-test-data/baseline-results.json`。

| 检查 | 退出码 | 结果 |
|---|---:|---|
| verify-cache-compatibility.js | 0 | BACKEND_COMPATIBILITY_OK |
| verify-multi-task.js | 0 | MULTI_TASK_OK |
| verify-raster-preview.js | 0 | RASTER_PREVIEW_OK |
| verify-analysis.js | 0 | ANALYSIS_OK |
| verify-render-options.js（隔离化后） | 0 | RENDER_OPTIONS_OK |
| frontend analysis-model | 0 | 9/9 |
| desktop fixtures | 0 | 1/1 |
| MATLAB verify_matlab_compatibility | 0 | MATLAB_COMPATIBILITY_OK |

MATLAB 使用工作区 `.desktop-test-data/matlab-prefs` 作为 MATLAB_PREFDIR；原始运行也通过但出现用户偏好权限告警。隔离运行只剩工具箱缓存告警，未修改业务脚本或数值断言。

旧 verify-render-options 依赖端口 8000 和固定个人数据，首次运行因缺少预设源失败，退出非零；其新增的一个临时源已精确清理。现已改为随机端口、临时源、内存注册表、finally 清理。新的 JS 检查只证明 API 坐标契约，实际 MATLAB 轴与出图由独立 .m 回归证明。

界面截图：`.desktop-test-data/screenshots/desktop-baseline.png`（已通过 Playwright 采集并查看）。产物截图为 `packaged-smoke.png`。截图不代表人工功能矩阵已通过。现有大图和真实案例不纳入提交。
