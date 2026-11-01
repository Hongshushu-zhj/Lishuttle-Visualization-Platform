# Desktop V1 RC3 验收报告

初始记录：2026-10-31；外机补充复核：2026-11-01。分支 feature/desktop-v1，实际安装包源提交 `0090f386575dd1df186324b8d252f47b53ae26b3`，两个渠道均记录 workingTreeDirty=false。

**发布判定：RC3 外机技术自检、样图/下载、用户确认的重开和离线本地 RSRP 已通过；完整手工功能/异常验收待补，继续保持候选版，不确认为正式 1.0.0。**

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

## 2026-11-01 独立设备补充复核

已收到 `桌面版测试结果/第二次测试` 两份报告。两轮均对应最终 RC3 / 0090f38 干净构建，Windows x64 10.0.26200、MATLAB 24.2.0.2712019 (R2024b)，测试者确认无另装 Node.js/源码。报告分别在北京时间 15:52:04～15:52:17、15:53:23～15:53:37 运行，各 5/5 PASS。

| 补充范围 | 状态 | 证据 |
|---|---|---|
| 最终 RC3 外机五项技术链路，两轮 | PASS | 两份报告的版本/revision、统计基线和成功计数已核对 |
| R2024b 六张样图及工具栏 | PASS | 六图均已打开并校验完整 PNG，SCR 无工具栏遮挡；两轮图像内容相同，仅生成时间元数据不同 |
| 外机带回的 PNG 下载和两份 ZIP | PASS | 下载 PNG 分别与本轮 sample-1 相同；两份 ZIP 实际解压，各 3 图与本轮样图哈希集合匹配 |
| 完整关闭后重新打开自检 | PASS | 用户明确确认重开动作；报告确为两次运行 |
| 离线本地 RSRP 测试 | PASS（用户确认范围） | 用户明确说明断网使用本地 RSRP 正常，未回传该真实输入/结果供独立数值核对 |

原始 JSON 的 manualChecks=NOT_RUN 保持不变，人工操作确认另行登记；目录只按时间排序，不臆测哪一个文件夹对应联网或重开动作。离线 RSRP 成功不扩大为所有功能均经离线验收。详见 external-rc3-review-2026-11-01.md，完整机器记录在 `.desktop-test-data/external-rc3-review-2026-11-01/review.json`。原安装包和冻结交付目录不变。

## 尚需补齐的独立设备手工关口

未收到完整手工表，下列范围仍未确认，不以本机自动测试或五项技术自检替代。剩余填写表为 rc3-remaining-acceptance.md，已确认通过的项目不用重复：

- 普通 Windows 用户从安装、首次引导到日常 MATLAB 设置保存/检测/重开持久化的完整界面流程。无 Node/源码及真实 MATLAB 技术使用已有上述证据。
- 除已确认的本地 RSRP 运行外，真实室内/室外、多任务/层、对比、坐标、调色、统计可信结果核对，以及实际界面的 CSV/Canvas PNG 保存、两种输出和历史位置。
- 正常退出无所属残留、用户自己启动的 MATLAB 不受影响的外机观察记录；完整关闭重开动作本身已确认。
- 最终候选在目标设备的错误路径、无 MATLAB、只读源/写入失败、取消/超时/部分失败、强退恢复、坏配置、数据移动、升级/卸载/共存。
- 真实 MATLAB 许可失败及真实磁盘空间不足：没有安全可用场景时如实保留未执行；不修改正常许可或业务目录制造故障。模拟错误与真实环境故障分开记录。

alpha.2 / 70557f3 已有另一台 Windows 11、MATLAB R2024b 的阶段 A 自动检查和用户确认的离线重启证据，详见历史复核文档。该证据不覆盖 RC3 新功能，不能据此确认正式版本。

本轮已带回完整报告目录（含 downloads）并复核通过；后续只需按 rc3-remaining-acceptance.md 补录未覆盖手工项及必要错误截图。待全部阻断问题闭环后再确认正式版本及正式版本号；本轮不推送、不合并、不发布 GitHub Release。

本地交付位于 `release/交付-RC3`：普通 stable 安装包、开发测试子目录、SHA256SUMS.txt、用户指南、手工结果表、构建时报告、支持矩阵与第三方许可；该目录保持 2026-10-31 冻结内容。本次最新复核记录更新在 docs/desktop-v1。Task 9 完成；Task 10 外机基本检查已通过，完整手工关口保持未完成。
