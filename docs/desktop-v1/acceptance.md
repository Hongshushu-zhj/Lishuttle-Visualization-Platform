# Desktop V1 验收矩阵

状态只使用 PASS / FAIL / 未执行。构建成功不能代替安装后验收。

| 阶段 | 检查 | 状态 | 证据 |
|---|---|---|---|
| 基线 | 临时合成样本、统计断言、原专项 | PASS | baseline.md，baseline-results.json |
| 基线 | 真实 MATLAB R2022a 数值及微型出图 | PASS | MATLAB_COMPATIBILITY_OK，exit 0 |
| A | utilityProcess 启动、释放端口、失败反馈、单实例 | PASS | 3 项 node:test + 2 项 Electron 用例 |
| A | canvas blob PNG 原生下载 | PASS | Electron 生命周期用例，校验保存文件签名 |
| A | unpacked 真实 worker、MATLAB、PNG、ZIP 保存 | PASS | .desktop-test-data/packaged-smoke.json，DESKTOP_SMOKE_OK |
| A | 本机 NSIS 安装及安装目录复测（系统 PATH 无 Node） | PASS | 安装 exit 0，installed-smoke.json，DESKTOP_SMOKE_OK |
| A | 独立 Windows 环境安装与五项自动检查 | PASS | 用户带回 alpha.2 / R2024b 报告，cleanEnvironmentConfirmed=true；无 Node/源码由测试者确认 |
| A | 独立设备最新样图人工复核 | PASS | 离线轮三张 PNG 已打开，本轮 SCR 标题无工具栏遮挡；首次异常保留在下方历史问题中 |
| A | 独立设备断网运行、关闭后重启 | PASS | 用户明确确认操作，新一轮报告五项 PASS，见 offline-acceptance-review-2026-10-30.md；JSON 不自动检测这两项 |
| A | 外机下载 ZIP 内容人工复核 | 未执行 | 自动保存检查 PASS，但两次带回目录均无 downloads，未独立解压检查 |
| A | 无 Node/源码的图形化验收工具 | PASS（本机源码和安装后入口） | alpha.2 安装 exit 0，真实菜单/三图/PNG/ZIP/版本报告，系统 PATH，无常规源修改 |
| B | 渠道隔离、设置、迁移、环境检测、首次引导 | PASS（源码本机） | task-3～5，真实 R2022a 检测/取消、重启恢复 |
| C | 取消/超时、部分失败、重启恢复、输出策略 | PASS（源码本机） | task-6～7，真实崩溃恢复与两策略下载 |
| C | 室内外、多任务、对比坐标、调色、分析、三种导出 | PASS（自动回归） | 七条基线、原分析界面、MATLAB 数值、61 单测、9 Electron；真实案例人工验收待最终候选 |
| C | 安全、日志、诊断、受管临时清理 | PASS（源码本机） | task-8，负测试及原生诊断导出 |
| D | 安装、升级、卸载、共存、离线、错误恢复 | 未执行 | 最终安装包验收 |

阶段 A 技术关口已通过，可以按计划进入阶段 B。此结论不等于阶段 B～D 完成，不将候选产物标为正式版本。

## 阶段 A 实际结果与边界

工具链锁定为 Electron 45.1.0（内置 Node 24.22.1）、electron-builder 26.18.0、Playwright 1.64.1。版本来自实施时 npm 官方登记，使用根 package-lock.json 固定。测试机 Windows 11 x64 / 10.0.26200，真实 MATLAB 9.12.0.1884302 (R2022a)。

产物通过：室内 RSRP、室外 10m SCR、室内 BESTSERVER 共 3 图；成功数 3、失败数 0。原生解码尺寸分别为 823×426、744×639、829×407；PNG/ZIP 实际下载保存各 1 份。worker 均值 -90、有效样本 3。退出后后端正常结束；独立生命周期用例另外验证端口可重新绑定。

本机安装测试在 `.desktop-test-data/installed-prototype`，应用进程 PATH 只包含 Windows/System32 和 Windows；仍属于有开发工具的本机，不能代替独立干净系统验收。NSIS 当前仅提供 dev 渠道、alpha 未签名候选。

已发现并修复的测试问题：旧坐标脚本触及固定开发服务；打包器默认过滤后端 node_modules，现明确配置复制；Playwright 默认不接管 Electron 下载，改观察原生 DownloadItem 完成状态；测试求值回调中 require 不可用曾弹出主进程异常，现回调不再使用 require，重跑原生 PNG/ZIP/canvas 保存通过。

尚未实现的后续范围：MATLAB 图形化设置、偏好迁移、完整任务取消/超时、统一独立输出、安全诊断与正式发行。该候选只用于阶段 A 技术验证。

## 另一台设备验收材料（alpha.2）

dev 候选加入“安装验收 → 运行阶段 A 安装验收…”菜单。该入口仅作为阶段 A 技术测试；使用原生对话框选择该设备的 matlab.exe、报告位置和实际环境条件，无需预置 MATLAB 路径、Node.js、源码或终端命令。验收服务使用独立目录/会话和包内合成数据，不修改常规数据源；报告保存真实 MATLAB 版本、自动 PASS/FAIL/NOT_RUN，以及仍需人工检查的三项状态。

源码入口的真实验收已通过，记录于 `.desktop-test-data/native-acceptance-source/`，其中 `cleanEnvironmentConfirmed=false`，没有冒充独立环境。新增模型/启动参数测试先失败后通过；菜单取消测试不启动 MATLAB 且不创建报告目录。独立验收窗口的下载需显式携带本次会话 Cookie（仅固定本机地址），最终使用 Electron 45 的对象式 headers 参数；真实下载保存已复测通过。转移说明见 `external-test-guide.txt`。

alpha.2 最终安装候选来自干净代码提交 `70557f3b4f91e2c30046fbda8afaa04be17cb1b6`，NSIS 安装退出 0，安装目录原生菜单验收在系统 PATH 下全项 PASS，真实 MATLAB 为 9.12.0.1884302 (R2022a)。报告/三张图/PNG/ZIP 保存证据位于 `.desktop-test-data/native-acceptance-packaged/`，仍标 `cleanEnvironmentConfirmed=false`，人工检查仍为 NOT_RUN。

转移包为 `release/AntennaDraw-StageA-1.0.0-alpha.2.zip`，仅含安装程序、另一台设备验收说明和 SHA256SUMS.txt。已逐项核对 ZIP 清单及其中安装程序 SHA-256，与原产物一致：`d68c1da30b437297948c0d78b30f6269c2d06982535077d833f8af9bbc92599e`。

## 独立设备结果复核（2026-10-30）

用户已带回报告与三张 PNG。外机五项自动检查通过，MATLAB 实测版本增加 R2024b；该证据仅覆盖阶段 A 的合成样本。人工复核 sample-2.png 发现 MATLAB 坐标轴工具栏遮挡标题，断网和重启未有执行证据。原始报告不修改；单独记录复核结果及 SHA-256 于 external-acceptance-review-2026-10-30.md。当前发布判定为 HOLD，安装包保持 `1.0.0-alpha.2` / dev，不能标记正式 `1.0.0`。

## 离线及重启补充复核（2026-10-30）

用户随后提供离线测试目录，并明确确认已完整关闭应用、从桌面快捷方式重新打开后再次验收。新报告北京时间 23:13:28～23:13:39，五项全部 PASS，MATLAB 仍为 R2024b；三张 PNG 已打开，尺寸及压缩流有效，本轮未见标题遮挡。离线运行和重新启动据此记为 PASS，阶段 A 技术关口完成；详细证据与文件指纹见 offline-acceptance-review-2026-10-30.md。

原始 JSON 的 manualChecks 仍为 NOT_RUN，因为当前程序不自动记录网络断开或用户重启；保留原件，在复核文档记录用户确认。首次 SCR 图片的工具栏遮挡在相同构建的新一轮中未复现，没有代码修复，作为后续图像回归问题保留。最终稳定版仍须完成 Task 3～10 及完整回归，外机 ZIP 内容也应在最终验收中检查；安装包版本和渠道不变。
