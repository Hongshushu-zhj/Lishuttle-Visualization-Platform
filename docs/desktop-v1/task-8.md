# Task 8：本地安全、诊断与回归

2026-10-31，Windows 11 10.0.26200，MATLAB R2022a 9.12.0.1884302。

- 本机 API 在业务操作之前校验 Host、Origin 和会话 Cookie。负测试覆盖缺少/错误 Cookie、外部/空 Origin、伪 Host、无 Origin 修改请求；确认没有注册源、创建任务或启动进程。
- IPC 统一当前窗口、主框架、同源校验；外部导航、子框架导航、webview 和弹窗拒绝。sandbox、contextIsolation 保持启用，Node 禁用。CSP 禁用嵌入框架，响应 no-store/no-referrer。
- API 保留 error 字符串并提供结构化 details，前端保留错误代码。
- 单写者诊断日志：5 MiB/份，最多 5 份；每份最多导出末尾 64 KiB。脱敏会话值/认证字段，不读取业务 DEM、源注册表、配置或许可；图形预览提醒本地路径，用户点击后原生保存 JSON。
- 自动及手动清理仅受管 cache/exports、保留最近 7 天、跳过 junction/活动下载；绘图活动时不清理。并发下载按引用计数保留文件。
- 浏览器禁止端口从动态监听结果中排除，原回归服务采用相同监听函数。
- 导出前明确关闭 Figure 和 Axes 工具栏、禁用交互并刷新图形，缓存版本升至 4。强制创建可见轴工具栏的真实 MATLAB 用例验证已关闭，且矩阵/坐标/色标不变。

已执行：61/61 node:test（含前端模型）、9/9 Electron、七条基线、真实 MATLAB_COMPATIBILITY_OK 与 EXPORT_SAFETY_OK；原分析界面配置恢复、任务切换、旧响应隔离、CSV/PNG 全通过。

证据位于 `.desktop-test-data/` 和 `docs/analysis-qa/`（忽略的大型图片不入库）。R2022a 工具栏回归 PNG 已实际打开检查。R2024b 的最终候选样图仍需外机复测，不能用 alpha.2 后次未复现或本机通过代替。

未执行/最终验收：真实业务案例全流程、真实许可失效、最终候选的独立设备断网/重启及 R2024b 图片复核。
