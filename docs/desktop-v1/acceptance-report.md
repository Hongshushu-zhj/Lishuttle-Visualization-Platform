# Desktop V1 RC3 验收报告

日期：2026-10-31。分支 feature/desktop-v1，实际安装包源提交 `0090f386575dd1df186324b8d252f47b53ae26b3`，两个渠道均记录 workingTreeDirty=false。

**发布判定：候选版，待独立设备最终验收，不确认为正式 1.0.0。**

## 本地验证

| 范围 | 状态 | 实际证据 |
|---|---|---|
| Node/前端模型、安全、进程、输出、配置、包资源负测试 | PASS | 66/66，0 失败、0 跳过 |
| Electron 实际界面、隔离、设置、退出与恢复、下载和诊断 | PASS | 安全依赖更新后完整 9/9；随后仅修改自检提示文案，受影响的菜单/取消用例再次 1/1；均退出码 0 |
| 原有功能基线 | PASS | baseline-results.json 七条命令退出码均 0 |
| 原 MATLAB 数值、坐标、色标及工具栏强制回归 | PASS（R2022a） | task-8.md，MATLAB_COMPATIBILITY_OK / EXPORT_SAFETY_OK |
| 两渠道 NSIS 构建及包资源审计 | PASS | stable/dev RC3 均退出码 0，各 2787 个资源文件 |
| 后端/前端生产依赖审计 | PASS | 2026-10-31，npm audit --omit=dev，均 total=0；不代表不存在未知漏洞 |
| stable RC3 unpacked 实际产物技术链路 | PASS | stable-rc3-packaged-smoke.json，真实检测、worker、三图、PNG/ZIP 保存和退出；Windows-only PATH |
| RC1→RC3 实际覆盖升级 | PASS | settings/preferences/sources 文件及历史 PNG 哈希一致，历史 URL 可读 |
| stable/dev 实际安装共存与重复启动 | PASS | 默认输出隔离、独立端口/会话；两个渠道第二实例均退出并恢复原窗口 |
| 两渠道明确选择同一结果目标 | PASS | OUTPUT_BUSY 拒绝竞争；取消后确认所属进程清理且锁释放 |
| 两渠道卸载及重装 | PASS | 配置、偏好、输入和已生成结果哈希不变；重装恢复；中文/空格路径 |
| 包内原生进程监管器 | PASS | 两渠道实际运行，Windows-only PATH；未在用户 processes 目录编译 EXE |
| 最终两渠道安装目录完整 smoke 与 stable 原生自检 | PASS | stable-rc3-installed-smoke.json、dev-rc3-installed-smoke.json、native-acceptance-packaged；均 exit 0、Windows-only PATH、真实 R2022a、三图和下载保存 |
| 安装后资源与构建产物一致 | PASS | installed-resource-comparison.json；两渠道各 2787 个资源和主 EXE 哈希一致 |
| 最终原生自检 ZIP 内容 | PASS | 已实际解压，三张 PNG 与 sample-1/2/3 哈希集合完全一致；final-zip-contents.json |
| R2022a 三张 RC3 样图人工打开 | PASS | 823×426、744×639、829×407；标题/轴标/色标清晰，SCR 无工具栏遮挡 |

最终安装矩阵证据为 `.desktop-test-data/install-matrix-report.json`，最终两包哈希已核对，完整 9/9 一次性通过。中间构建首次在 Dev 偏好尚未保存时直接读取 preferences.json 而失败；修正测试准备后重跑。旧失败报告与补测原件保存在 intermediate-rc3-40d1a59，未将原失败改为 PASS，也未沿用中间包结论。

另一次并行烟雾测试被当时运行的 NSIS 卸载器按同名程序关闭，已核对安装器模板规则及对应测试进程无残留；这是测试编排冲突。安装矩阵结束后按顺序重跑 unpacked、stable 安装目录、dev 安装目录和 stable 原生自检，全部退出码 0。最终交付仅收录该顺序复测的证据。原生自检 HTML 和三张样图已实际打开，整目录/ZIP 带回提示正确，SCR 无工具栏遮挡。

所有本机测试使用合成数据和独立测试用户根，不以 PATH 移除 Node 冒充干净系统。真实业务输入、真实用户配置和 MATLAB 许可不作为破坏性测试材料。具体工具版本见 support-matrix.md。

## 安装包

| 渠道 | 文件 | SHA-256 |
|---|---|---|
| stable | AntennaDraw-Setup-1.0.0-rc.3-x64.exe | 9bf453455cf9e30b96209a02023185f3dbdd3b288e9cc3db3542e36c22c875bb |
| dev | AntennaDraw-Dev-Setup-1.0.0-rc.3-x64.exe | b64435c1a43b8ff1d39f3c5a82075e96e02c47dc3ba9f7bcac8d27ebe80bba4c |

两份均为未签名 NSIS 当前用户安装包，Get-AuthenticodeSignature 返回 NotSigned。许可资源随包提供：THIRD_PARTY_NOTICES.txt、inventory.json、LICENSE.electron.txt、LICENSES.chromium.html。包内没有个人配置、源登记、密钥/许可、真实仿真 DEM 或开发服务器 URL；合成 DEM 与重新生成的 manifest 哈希精确匹配。RC1/RC2 不交付。

## 独立设备最终关口

下列仍为未执行，不以源码测试或旧版外机报告替代：

- RC3 在普通用户、无 Node.js、无源码、有效 MATLAB 的独立 Windows 设备从安装开始的完整端到端流程。
- RC3 真实案例的室内/室外、多任务/层、对比、坐标、调色、分析；实际 PNG/ZIP/CSV/Canvas 保存，ZIP 实际解压；R2024b 工具栏修复复核。
- RC3 完整关闭、断网、桌面重新打开后复测，正常退出无所属残留。
- 最终候选在目标设备的错误路径、无 MATLAB、只读源/写入失败、取消/超时/部分失败、强退恢复、坏配置、数据移动、升级/卸载/共存。
- 真实 MATLAB 许可失败及真实磁盘空间不足：没有安全可用场景时如实保留未执行；不修改正常许可或业务目录制造故障。模拟错误与真实环境故障分开记录。

alpha.2 / 70557f3 已有另一台 Windows 11、MATLAB R2024b 的阶段 A 自动检查和用户确认的离线重启证据，详见历史复核文档。该证据不覆盖 RC3 新功能，不能据此确认正式版本。

外机执行 external-final-guide.md，填写 final-manual-results.md，并带回整个报告目录（含 downloads）和必要错误截图。待全部阻断问题闭环后再确认正式版本及正式版本号；本轮不推送、不合并、不发布 GitHub Release。

本地交付位于 `release/交付-RC3`：普通 stable 安装包、开发测试子目录、SHA256SUMS.txt、用户指南、手工结果表、此报告、支持矩阵与第三方许可。Task 9 完成；Task 10 的本地材料已准备，独立设备关口保持未完成。
