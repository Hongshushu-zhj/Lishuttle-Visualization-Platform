# 本机 Web 功能对齐验收记录

日期：2026-11-03。目标仓库：`platform`，分支：`feat/web-desktop-alignment`。

Web 基线为 `7b94004`，功能参考为桌面版 `97c4cc3`（1.0.1）。保持 Vue 3、Express、MATLAB 架构，默认仅监听 `127.0.0.1:8000`，数据根为 `backend/data`。桌面仓库与实际源 DEM 未修改。

## 功能交付

| 能力 | 本次结果 |
|---|---|
| 应用设置与 MATLAB | 页面设置、自动发现、真实检测、取消及重新检测；绘图前后端检查就绪状态 |
| 引导与演示 | 首次引导、可跳过 MATLAB、独立生成室内/室外及缺层合成数据 |
| 持久任务 | 逐图进度、部分失败、取消、超时、重试未完成层、任务记录；重启标记 interrupted |
| 进程监管 | 所属 Windows Job 隔离；取消、超时及崩溃恢复等待退出证明，不影响外部进程 |
| 输出与历史 | 源目录旁/独立输出根、路径快照、跨实例锁、PNG 完整性检查及原子发布；历史图片/ZIP/打开目录 |
| 数据与偏好 | 原 sourceId 保持、离线重定位、旧项目及 JSON 导入；色标/分析偏好服务端持久化、按指标合并 |
| 原浏览器偏好 | 显式预览后迁入，保留旧 localStorage，下载反馈明确为已发起下载 |
| 诊断与维护 | 限量脱敏日志预览/下载，清理仅处理过期直属 UUID ZIP，保留正式结果、历史及旧缓存 |
| 启动与停止 | 统一端口配置、同项目实例复用、未知占用拒绝；私有实例令牌停止，等待任务/统计线程与监听退出 |
| 原有业务 | 室内/室外、多任务、五类绘图、三种坐标、分析、CSV/图表、实时调色及全局色标继续保留 |

不迁入 Electron 安装器、原生窗口、菜单和自动更新。浏览器关闭不取消服务任务。历史保存原路径；同路径重绘可能更新旧链接的内容，不提供不可变图片归档。

## 自动化验证

验证使用临时数据根、合成 DEM 和随机测试端口；测试不依赖桌面仓库的业务代码或测试资源。

| 命令 | 结果 |
|---|---|
| `npm --prefix backend test` | 87/87 通过，零跳过；覆盖真实 Windows 子进程、统计 Worker 退出及单坐标预览边界 |
| `npm --prefix frontend test` | 设置 Playwright 环境变量后 22/22 通过，零跳过，包含真实 Canvas/WebGL 和导出 PNG 像素检查 |
| `npm --prefix frontend run build` | 生产构建通过，2230 modules |
| `node backend/scripts/verify-cache-compatibility.js` | BACKEND_COMPATIBILITY_OK |
| `node backend/scripts/verify-multi-task.js` | MULTI_TASK_OK |
| `node backend/scripts/verify-raster-preview.js` | RASTER_PREVIEW_OK |
| `node backend/scripts/verify-analysis.js` | ANALYSIS_OK |
| MATLAB `verify_matlab_compatibility` | MATLAB_COMPATIBILITY_OK，真实 R2022a 退出码 0 |

浏览器回归：先构建前端，在具备 Playwright 和 Chromium 的环境运行 `node backend/scripts/verify-web-ui.js`。可用 `PLAYWRIGHT_MODULE_PATH`、`PLAYWRIGHT_EXECUTABLE_PATH` 指定已有工具，不要求把浏览器自动化依赖装入生产项目。

流程包含：首次引导→合成演示→跳过 MATLAB→分析→CSV/PNG 下载→保存超时设置→主动迁入两项旧浏览器偏好→诊断下载→交互预览像素检查及保存/下载→任务记录→刷新恢复。最终输出 `WEB_UI_OK`，无页面脚本错误；使用普通点击，可检测提示遮挡控件的问题。截图保存在 `.web-test-data/ui/`，已目视确认有效栅格有颜色、无效值保留空白。

前端像素检查在未指定 Playwright 时会明确跳过该项，其他模型测试照常运行；本次记录使用实际浏览器，未跳过。

## 真实 MATLAB

命令：

```powershell
node backend/scripts/verify-web-matlab.js --matlab "D:\Matlab\R2022a\bin\matlab.exe"
```

本机 MATLAB：`9.12.0.1884302 (R2022a)`，2026-11-03 11:19–11:24（Asia/Shanghai），脚本退出码 0。

- 真实环境检测通过，室内/室外/PNG 能力均为 true；取消一次检测后重新检测通过。
- `abs`、`rel-ll`、`rel-center` 三种坐标模式各 5 张，共 15/15 PNG；覆盖室内 RSRP、室外 SCR/BESTSERVER 和 ground/10m。
- ZIP 实际下载 152955 字节、5 张 PNG；解压 CRC 和原图字节一致。
- 修改独立输出根后，历史图片与 ZIP 继续读取原位置，图片字节一致。
- 6 个所属 Windows Job 的退出证明均为 `job_no_longer_exists`；监管器空闲，无 active.json，服务关闭完成。
- 目视确认 MATLAB 示例图标题、坐标、色条正常，无工具栏混入导出图。

本机完整证据：`.web-test-data/real-matlab-kKrbrr/evidence.json`；示例图：同目录 `sample-indoor-RSRP.png`。这些为可重新生成的本机产物，不纳入 Git。

原有 MATLAB 兼容专项同时实跑通过，证据为 `.web-test-data/matlab-compat-74k5Ve/evidence.json`。其隔离的备用路径 fixture 已补上导出清理 helper；所属进程退出证明确认完成。MATLAB 启动有本机 toolbox cache 格式警告，全部断言通过，stderr 为空。

## 审查修复

独立审查确认并修复：旧缓存被临时清理误删、统计线程未等待退出、损坏历史记录导致启动异常、数据恢复警告未汇总、环境状态重载后设置保持禁用，以及下载提示遮挡按钮。修复后已有针对性回归，并通过只读复核。

截图复核另发现室内单坐标序列导致预览 extent 退化、栅格白图。先补真实浏览器颜色断言复现：图内彩色采样点为 0；再实测 MATLAB R2022a 的标量坐标行为，按单位像素间距修正单序列边界，保留普通范围行为。前端明确拒绝退化范围，避免静默保存白图。几何、Canvas/WebGL、导出 PNG 像素和整站浏览器复验全部通过，独立只读复核无阻断问题。

## 兼容性与运行说明

实际运行 Node.js `24.15.0`，浏览器为本机 Google Chrome。代码保持 Node.js 20.19+ 接口兼容，CRC32 有独立实现和标准向量/PNG 破损检查，不使用较新的 `zlib.crc32`；当前机器没有可用 Node 20，**未实跑 Node 20 全流程**。

Windows 进程辅助程序源码和构建脚本已提交，生成 EXE、manifest 与 build-info 保持忽略。源码环境可首次构建；正式交付构建流程及完整性检查见 README。

所有 Git 提交采用规范类型及中文说明；未自动推送、合并或发布。双击 `启动平台.bat` 启动，使用 `停止平台.bat` 停止。
