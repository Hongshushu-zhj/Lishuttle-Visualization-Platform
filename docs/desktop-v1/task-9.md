# Task 9：安装、升级、卸载与渠道共存

2026-10-31，Windows 11 x64 / 10.0.26200.0。最终候选 1.0.0-rc.3，干净源提交 `0090f386575dd1df186324b8d252f47b53ae26b3`，两渠道均 workingTreeDirty=false。

## 构建与资源

- dist 默认 stable，开发启动限定 dev；分别使用 com.antennadraw.desktop / com.antennadraw.desktop.dev、AntennaDraw / AntennaDraw Dev 名称与独立数据根、会话和单实例。
- 当前用户 NSIS 安装，允许中文/空格目录与桌面快捷方式；默认保留用户数据。两渠道安装包均未签名，仍使用默认 Electron 图标，如实列入说明。
- 进程监管 C# helper 在构建机预编译后随包分发；实际安装运行不需要本地 Node.js 或编译器。MATLAB 由使用者自备有效许可。
- 每次重建合成 demo，逐文件哈希审计；包内 worker/MATLAB/frontend/helper/许可证检查通过，各 2787 个资源文件。app.asar 仅允许预期桌面模块及 package.json。
- 拒绝个人配置、源注册表、密钥/许可文件、真实 DEM、开发服务器 URL 和文件链接；第三方依赖版本、许可全文与 Electron/Chromium 说明随包。
- RC3 生产依赖安全修订见 dependency-audit.md；body-parser 1.20.9、qs 6.16.1、source-map-js 1.2.2 已在两个包内核对。
- 安装技术自检提示已统一要求带回整个报告目录，含 downloads；明确只是五项技术子集，不能代表完整 V1 验收。

## 最终安装矩阵

证据 `.desktop-test-data/install-matrix-report.json`，9 项 PASS，退出码 0，所有安装包哈希与最终文件一致。测试根 `.desktop-test-data/install-matrix-中文 Juwd1B`，只使用合成输入和独立 LOCALAPPDATA，不修改日常配置/业务 DEM/许可。

1. RC1 实际安装，保存 MATLAB、45 分钟超时、RSRP 色标和合成源，真实出图。
2. RC3 覆盖升级，settings/preferences/sources 文件及历史 PNG 哈希一致；历史 URL 正常。
3. 同时运行 stable/dev，用户根、会话、端口和默认结果目录不同；Dev 真实出图位于独立根。
4. stable 第二实例正常退出，恢复原窗口且不新建后端。
5. dev 第二实例同样通过。
6. 两渠道明确选同一 source 输出目标，竞争方 OUTPUT_BUSY；取消原任务后确认清理并释放锁。
7. stable 实际卸载，配置、输入和结果保留；重装恢复。
8. dev 实际卸载，配置、输入和结果保留；重装恢复。
9. Windows-only PATH 下运行包内监管器，用户 processes 目录没有动态编译的 AntennaProcessHost EXE。

中间构建首次矩阵在 Dev 偏好尚未保存时直接读取文件而失败，已修正测试准备；旧失败与专项补测证据保存在 intermediate-rc3-40d1a59。最终提交的两包重新完整执行上述矩阵，9 项一次性通过，没有沿用旧哈希的矩阵结论。

## 后续边界

实际产物、安装目录完整技术自检及样图/下载核对见 acceptance-report.md。本机没有冒充无 Node/源码的独立设备。R2024b 最终候选、真实案例、离线/重开与完整异常矩阵仍需按 external-final-guide.md 在另一台设备验收；没有将 alpha.2 的旧报告替代 RC3。

本地候选交付不等于正式发布；未推送、合并或发布 GitHub Release。
