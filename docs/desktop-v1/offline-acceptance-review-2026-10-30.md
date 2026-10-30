# 独立设备离线与重新启动验收复核

复核日期：2026-10-30（北京时间）。用户提供目录：`D:/workspace/antenna-draw/桌面版测试结果/离线测试结果`。本次复核保留所有用户原始文件，不在外机重新执行程序。

## 结论

**五项自动检查 PASS；本轮样图查看 PASS；离线运行 PASS；关闭后重新启动 PASS。阶段 A 安装可行性技术关口完成。**

离线状态依据用户明确说明；用户另明确回答：“是，关闭后重新打开，再运行了离线验收”。该操作确认与新报告共同作为人工项证据。网络状态和重启行为没有程序侧自动测量，不把 JSON 的 NOT_RUN 改成 PASS；审核结果单独保存。

本次不将安装包确认为正式版，版本仍为 `1.0.0-alpha.2` / dev。原计划 Task 3～10 尚未完成。首次 SCR 图片出现的工具栏遮挡问题在本轮未复现；代码和构建 revision 未变，不能宣称问题已修复，正式版前仍需定位和回归。

## 新一轮报告核对

- 运行时间：2026-10-30 23:13:28～23:13:39（北京时间），晚于首次报告，确认是新一轮验收。
- 构建：1.0.0-alpha.2，revision `70557f3b4f91e2c30046fbda8afaa04be17cb1b6`，workingTreeDirty=false，与已交付候选一致。
- 系统：Windows x64，内核 10.0.26200；Electron 45.1.0；包内 Node 24.22.1。
- MATLAB：24.2.0.2712019 (R2024b)。cleanEnvironmentConfirmed=true，为测试者对无 Node.js/源码环境的确认。
- 扫描：3 个测试任务；统计：2 层、各层均值 -90、有效样本数 3。
- 绘图：3 成功、0 失败；PNG 和 ZIP 保存检查 PASS，count=2。
- 三张 PNG 已实际打开，并另行验证签名、分块边界、压缩流与报告尺寸：823×426、744×639、829×407。
- 本轮 sample-2.png 标题完整，未见上轮工具栏图标遮挡；sample-1/3 也未见明显标题、坐标或色标遮挡。
- 带回目录没有 downloads；下载保存依据外机自动报告，不把它写成已独立解压验证 ZIP 内容。

复核命令退出 0，输出 `OFFLINE_EVIDENCE_VALIDATION_OK`。机器记录：`.desktop-test-data/external-offline-review-2026-10-30.json`（忽略文件）。

## 原始 manualChecks 的解释

原始报告中 imageAppearance、offlineOperation、relaunch 均为 NOT_RUN，属于当前验收工具的固定输出。本次图片已由审核者查看，离线和关闭后重启由测试者明确确认；这些结果记录在本复核文件，不篡改自动报告。五项自动 PASS 的范围仍然仅限阶段 A 合成样本，不代替完整 V1 功能矩阵。

## 文件指纹

| 文件 | SHA-256 |
|---|---|
| acceptance-report.json | b445071ab5aa0250397c292a75e370c9ded32f6a04cceb97ca08dc63dbee9446 |
| sample-1.png | b7e7cd142b1d36af1e0c04c1ed9d2ed4b12b7e50a5827a2f2a99b90c7c03b7e9 |
| sample-2.png | 52bcdd7442ffe43f1060b0298693b55eb937c8fa62e81b94eefa9fcba42f041d |
| sample-3.png | e895b3ff1ad1df18a3353d77eff16d2769f202041f38273c919e94c9746dcef9 |
