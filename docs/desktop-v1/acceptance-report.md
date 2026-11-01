# Desktop V1 1.0.0 正式构建验收报告

日期：2026-11-01。分支 feature/desktop-v1。构建源提交 4ac4548db0528afa579a8dd95dc4103e8aa6d273；stable/dev 均为 1.0.0，workingTreeDirty=false。

**交付判定：按用户对 RC3 验收范围的明确确认，完成 1.0.0 正式构建和本机最终产物验证，可本地交付。** 用户原话：“没问题了，请你开始构建正式版1.0.0”。未逐项回传的外机手工项目保留原状态，不补写为实测 PASS。

## 最终产物验证

| 范围 | 结果 | 证据 |
|---|---|---|
| 单测：配置、进程、输出、安全、前端模型 | 66/66 PASS | unit-tests-1.0.0.tap，0 失败、0 跳过 |
| Electron 界面、配置重开、任务取消/强退、两种输出、PNG/ZIP/CSV/Canvas 保存 | 9/9 PASS | electron-tests.log，含真实 MATLAB |
| 原有功能七条基线 | 7/7 PASS | baseline-results.json，命令退出码均 0 |
| 两渠道 NSIS 和资源审计 | PASS | 每渠道 2787 资源，实际包版本、渠道、标识、许可及敏感文件检查 |
| RC3→1.0.0 实际升级、共存、第二实例、同目标锁、卸载重装 | 9/9 PASS | install-matrix-report.json；配置/偏好/源登记/历史图片保留，取消确认清理 |
| stable unpacked 正式资源真实技术链路 | 7/7 PASS | stable-unpacked-smoke.json；真实检测、线程、三类图、PNG/ZIP 和退出 |
| stable 实际安装目录真实技术链路 | 7/7 PASS | stable-installed-smoke.json，系统 PATH 仅 Windows 目录 |
| dev 实际安装目录真实技术链路 | 7/7 PASS | dev-installed-smoke.json，独立测试用户根 |
| 安装资源与构建目录逐文件相同 | PASS | final-artifacts.json，每渠道 2787 资源及主 EXE 哈希匹配 |
| 正式 stable 安装自检菜单 | 5/5 PASS | native-acceptance-packaged/acceptance-report.json，版本 1.0.0、真实 R2022a |
| 三张样图外观与 ZIP 解压 | PASS | 三图均已打开，无工具栏遮挡；ZIP 实际解压 3 张完整 PNG，哈希集合与样图匹配 |
| 与已验收 RC3 的应用及依赖一致性 | PASS | 两渠道各 2785 资源相同，仅 app.asar 版本元数据和 build-info.json 变化；应用源码及锁定依赖相同 |
| 原 RC3 冻结交付目录 | PASS | 原 SHA256SUMS.txt 全部条目复核不变 |

机器证据在 .desktop-test-data/formal-release-1.0.0，交付目录中提供副本。所有本机测试只用合成数据和独立用户根，未修改业务 DEM、常规用户配置或 MATLAB 许可；本机自检 cleanEnvironmentConfirmed=false，不冒充外机环境。

## 安装包

| 渠道 | 文件 | SHA-256 |
|---|---|---|
| stable | AntennaDraw-Setup-1.0.0-x64.exe | 75e4e8f2761b478caf8fdba5ad856c8a081e53ad3b008e5ab6b69064e6053ee5 |
| dev | AntennaDraw-Dev-Setup-1.0.0-x64.exe | 341bf9ca32e8b7d72d20530a01f6c69dd3cac2285e653a913895cae2e6c0e7cf |

两包为 Windows x64 当前用户安装，Get-AuthenticodeSignature 均为 NotSigned。随包及交付目录提供第三方许可。应用使用内置 Electron 45.1.0 / Node 24.22.1，安装使用者不需要另外安装 Node.js。

## 外机证据与用户确认

同代码 RC3 / 0090f38 在另一台 Windows x64 10.0.26200、MATLAB 24.2.0.2712019 (R2024b) 两轮各 5/5，六张 PNG 和两份 ZIP 已复核。无另装 Node.js/源码由测试者确认。用户说明一轮联网、一轮完整关闭重开，并另外断网使用本地 RSRP 正常。复核记录为 external-rc3-review-2026-11-01.md。

1.0.0 安装包本身没有再次到外机运行；本次以应用和依赖一致性核对、正式包本机安装验证及用户确认作为正式构建依据。rc3-remaining-acceptance.md 中未逐项回传的完整界面/异常手工范围仍保留原记录，不要求重复已通过的联网/重开/离线 RSRP。用户确认接受现有范围后授权正式构建，不能将这句话伪写成全部手工场景已现场执行。

## 已知限制与审计

2026-11-01 最新 npm 生产审计：前端 0，后端 6 个中等级受影响包，0 高危/严重；后端 audit 退出码 1。来自两条 glob/minimatch 公告及依赖传播；静态核查和动态阻断测试证明当前明确文件 ZIP 导出没有进入相关通配路径，依赖仍随包存在。详见 dependency-audit.md，原始审计随交付保存。

真实 MATLAB 许可失效、真实磁盘耗尽没有演练；不修改正常许可或业务磁盘来制造故障。不承诺未测平台，不提供自动更新、账号/使用者准入或云服务。

## 本地交付

目录：release/交付-1.0.0。包含正式 stable 安装包、开发测试 Dev 包、SHA256SUMS.txt、安装说明、支持矩阵、验收证据和第三方许可。保留 release/交付-RC3 及 acceptance-report-rc3.md 历史记录。本次不推送、不合并、不发布 GitHub Release。
