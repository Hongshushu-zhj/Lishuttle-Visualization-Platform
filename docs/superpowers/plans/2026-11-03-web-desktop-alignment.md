# 本机 Web 与桌面功能对齐实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将桌面 1.0.1 的设置、检测、任务、输出、引导与维护能力同步到 platform，保留本机 Web 交付。

**Architecture:** 复用桌面业务服务工厂及其经验证的运行模块，Web 入口单独组装；Vue 仅使用 HTTP。数据默认留在 backend/data，独立测试使用临时根。三个无重叠文件域并行实施，由主代理组装、检查、提交。

**Tech Stack:** Vue 3、Element Plus、ECharts、Vite、Express 4、Node.js 20.19+、Windows、MATLAB。

## Global Constraints

- 使用场景为本机 Web，默认 `http://127.0.0.1:8000`，保留 `backend/data`；不读取桌面用户数据。
- Node.js 20.19+；并发 1；超时默认 30 分钟，范围 5～240 分钟。
- 保留原五种绘图、三种坐标、统计语义和输入数据；绘图导出修复升级 renderVersion 到 4。
- 无 Electron/desktopBridge 依赖；浏览器关闭不取消任务；历史路径快照不等于不可变归档。
- 前后端均检查 MATLAB 绘图就绪；分析、预览和下载无需 MATLAB。
- 测试先证明缺失行为，再迁入实现；不改变实际注册表和源结果。新检查必须可从 Git 干净拉取执行。
- Git 提交类型使用规范类型，说明使用中文。代理只修改所分配文件，不自行提交；主代理统一提交。

## Task 1: 后端业务服务迁移

**Files:** backend/src 下桌面版中的业务工厂、JSON/设置、任务/输出/环境/进程模块；backend/tests/*.test.cjs。

**Interfaces:** `createSourcesStore(file)`、`createCache(runtime)`、`createJobQueue({config,JOBS_DIR,runMatlabJob,cache,supervisor})`、`createMatlabRunner(runtime)`、`createAnalysisService({store})`、`createRoutes({...runtime,sourcesStore,jobQueue,cache,exporter,analyzeRequest,openResultsFolder,openOutputFolder,ensurePlotReady})`。settingsStore 接口与桌面相同，偏好 PATCH 按指标合并。

- [x] 写入并运行生命周期/输出/配置测试，确认旧实现缺少取消、持久化、独立输出及并发偏好合并。
- [x] 从 `../antenna-draw-desktop/backend/src/` 按模块迁入现有业务实现，保留原算法不变；不覆盖 config/runtimePaths/serverApp/appRoutes/fsBrowse。
- [x] 增加 CRC32 兼容实现并用已知向量及 PNG 破损输入验证；不能依赖 Node 22 的 zlib.crc32。
- [x] 将 readiness 检查接入非 dryRun 绘图和重试；测试独立 router 可显式省略该注入，Web server 必须提供。
- [x] 在临时目录运行任务生命周期、输出、环境、原生完整性及设置测试，向集成者报告准确命令与结果。

## Task 2: Vue Web 交互同步

**Files:** frontend/src、frontend/scripts（仅前端所有权）。

**Interfaces:** 与桌面同名的 settings/preferences/environment/onboarding/jobs/sources HTTP API；新增 `GET /app-info`、`POST /preferences/import {preferences}`、`GET /diagnostics`、`GET /diagnostics/download`、`POST /logs/open`、`GET /fs/files?path=...&type=matlab`。`POST /settings/import` 可携带 preferences JSON 对象。

- [x] 写入模型/偏好迁移测试并运行，确认原 Web 缺少应用状态、服务器偏好及旧存储显式迁入。
- [x] 迁入桌面视图、任务状态、历史、设置、引导和偏好客户端；desktopModel/State 改为 appModel/appState，移除原生桥依赖。
- [x] 目录沿用 FolderPicker；文件模式使用受限 /fs/files；JSON 用浏览器文件输入，不发送伪绝对路径。
- [x] 旧 localStorage 提供预览和主动导入；更新按指标提交，避免其他标签页数据丢失。
- [x] 测试应用状态、异步保存、错误重试和迁移；运行前端生产构建。下载提示使用“已发起下载”。

## Task 3: 运行入口、样本与部署

**Files:** backend/server.js、scripts/*.cjs、启动平台.bat、停止平台.bat、frontend/vite.config.js、matlab/check_environment.m、matlab/prepare_export_figure.m、matlab/plot_dispatch.m、README.md、backend/tests/web-launcher.test.cjs。

**Interfaces:** root 提供 `backend/src/config.js` 的 `loadWebConfiguration({sourceRoot?,dataDir?}) => {port,paths,initialSettings,warnings}`；`backend/src/serverApp.js` 的 `createServer({paths,initialSettings,devOrigin?})` 返回 `{listen({host,port}),close(),...}`。监听返回 `{origin}`。GET /api/health 带 app 标识；实例文件包含随机 shutdownToken。POST /api/runtime/shutdown 使用实例令牌，经本机启动器调用并等待清理。

- [x] 先写端口冲突、实例身份/令牌与停止协议测试，验证旧 bat 按端口结束进程的问题。
- [x] 新启动器统一读取配置、复用同项目有效实例、未知占用明确失败，避免 taskkill 未知进程；停止调用本实例 API，等待清理和退出。
- [x] 迁入 MATLAB 环境与导出脚本；将合成演示生成器置于正式脚本中，运行不依赖被忽略的 desktop/tests。
- [x] Vite 代理和 bat 统一配置端口；保留首次依赖安装和构建流程并检查退出码。
- [x] 更新 README 说明全部 Web 功能、Node 要求、Windows 辅助程序来源及历史限制；独立测试启动器及样本。

## Task 4: Web 服务集成、迁移与维护

**Files:** backend/src/config.js、runtimePaths.js、serverApp.js、appRoutes.js、diagnosticsRoutes.js、fsBrowse.js；backend/tests/web-app.test.cjs；package.json；.gitignore。

- [x] 先写临时根服务测试：旧 config 只迁一次、偏好合并、同源限制、未就绪绘图拒绝、无 MATLAB 分析、诊断下载、shutdown 令牌。
- [x] 显式组装各工厂，绑定 loopback；Host 与修改请求 Origin/启动令牌校验；错误输出保持中文和结构化 code。
- [x] 设置读取保持原端口与数据根；旧 config/注册表备份后迁移，未知说明字段忽略，原 sourceId 保持。
- [x] Web HTTP 接入检测/引导/导入、按需生成演示、受限文件浏览、日志预览与下载；禁止浏览器原生桥依赖。
- [x] 注册可复现测试入口，不提交本机配置、真实输入、生成结果、依赖目录或日志。
- [x] 三个实现域完成后进行任务级审查，修复确认缺陷，再形成中文功能提交。

## Task 5: 验证、审查与交付

- [x] 原 Web 基线：`node backend/scripts/verify-cache-compatibility.js`、`verify-multi-task.js`、`verify-raster-preview.js`、`verify-analysis.js`、`node --test frontend/scripts/analysis-model.test.mjs`；必要的预览输出检查更新为有效 PNG。
- [x] 新模块：`node --test backend/tests/*.test.cjs`、`node --test frontend/scripts/*.test.mjs`、`npm --prefix frontend run build`。
- [x] 浏览器流程使用临时数据根和随机端口，验证引导、设置、演示、分析、预览、下载、历史、迁移和诊断。
- [x] 真实 MATLAB 使用隔离偏好/数据根验证检测、室内/室外出图、PNG/ZIP、取消/恢复；避免注册实际业务源。
- [x] 执行 Node 20 API 兼容验证；若当前机器无 Node 20 运行时，准确披露实际运行版本与静态兼容范围。
- [x] 请求整分支代码审查，修复重要问题，运行覆盖修复的检查，记录实际证据。
- [x] 使用 `feat: 同步本机 Web 的设置检测与任务管理` 等中文说明提交；不自动推送、合并或发布。

## 进度记录

- 基线：四项后端专项检查通过；分析模型 9/9 通过；实施分支 `feat/web-desktop-alignment`。
- 应用工作树工具无法为当前工作区的嵌套仓库注册工作树；已在原 platform 干净分支实施。

- 最终验收：后端 87/87、前端 22/22（含真实浏览器像素），生产构建、整站浏览器、真实 MATLAB 15 张 PNG/ZIP/检测重试和兼容专项均通过。详见同目录验收记录。
- 验收追加修复：室内单坐标序列预览边界按 MATLAB 实测行为展开，避免零高度白图；Node 20 仅完成接口兼容核对，当前实际运行 Node 24.15.0。
