# 独立设备安装验收复核

复核日期：2026-10-30（北京时间）。用户提供的原始材料位于 `D:/workspace/antenna-draw/桌面版测试结果`，包含 acceptance-report.json、验收结果.html 和三张 sample PNG。原文件保持不变；复核没有在该外机重新执行验收。

## 当前补充结论

后续离线轮报告及用户明确确认已补齐离线运行、关闭后重新启动的证据，新一轮三张 PNG 均未见标题遮挡。阶段 A 技术关口已完成，可以进入 Task 3；首次 SCR 遮挡在相同构建下未复现，尚不能标为已修复。正式版仍为 HOLD，Task 3～10 未完成。详细补充记录见 offline-acceptance-review-2026-10-30.md。以下保留首次复核时的事实和结论。

## 首次复核结论（历史）

**外机阶段 A 五项自动检查：PASS。图像人工复核：FAIL。正式稳定版确认：HOLD。**

安装候选仍为 `AntennaDraw-Dev-Setup-1.0.0-alpha.2-x64.exe`，不能改名视为正式 `1.0.0`。除本次发现的图像问题外，原计划 Task 3～10 仍未完成，尚缺设置与首次引导、配置隔离、进程监管、取消/超时、输出与安全诊断、升级共存和最终端到端验收。

## 报告与构建对应关系

- 版本：1.0.0-alpha.2；revision：70557f3b4f91e2c30046fbda8afaa04be17cb1b6；workingTreeDirty=false，与本机最终安装候选记录一致。
- 外机：Windows x64，内核 10.0.26200；Electron 45.1.0；应用内置 Node 24.22.1。内置 Node 是安装包运行时，不代表外机另装了 Node.js。
- 测试者确认 cleanEnvironmentConfirmed=true；无 Node.js/源码为测试者声明，不是自动扫描或账户权限审计。
- MATLAB：24.2.0.2712019 (R2024b)。本次结果只证明该外机环境下合成样本通过，不等同于完整 R2024b 功能兼容认证。
- 外机报告时间：2026-10-30 22:47:08～22:47:22（北京时间）。
- 本次独立材料校验命令退出 0，输出 EXTERNAL_EVIDENCE_VALIDATION_OK；详细机器记录位于忽略的 `.desktop-test-data/external-acceptance-review-2026-10-30.json`。

| 自动项 | 复核结果 | 证据 |
|---|---|---|
| 合成数据扫描 | PASS | 3 个测试任务 |
| 真实统计线程 | PASS | 2 层，每层均值 -90，有效样本 3，与基线一致 |
| MATLAB 绘图 | PASS | 室内 RSRP、室外 SCR、室内 BESTSERVER；3 成功、0 失败 |
| PNG 签名与解码 | PASS | 已打开三张图；另核对 PNG 分块边界、压缩流及报告中的尺寸 |
| PNG / ZIP 下载保存 | PASS（外机报告证据） | 自动报告 count=2；本次未提供 downloads，未独立解压检查 ZIP 内容 |

## 图片人工复核

| 文件 | 尺寸 | 结果 |
|---|---|---|
| sample-1.png | 823 × 426 | 已打开，未见明显标题遮挡；不是全部绘图语义的完整回归 |
| sample-2.png | 744 × 639 | **FAIL：坐标轴工具栏（导出、平移、缩放等图标）被写入 PNG，遮挡标题中后部** |
| sample-3.png | 829 × 407 | 已打开，未见明显标题遮挡；保留既有 BESTSERVER 绘图语义 |

对照本机 R2022a 的 `.desktop-test-data/native-acceptance-packaged/sample-2.png`，标题没有上述工具栏遮挡。现有 `matlab/plot_dispatch.m` 直接 exportgraphics(gcf, ...)，尚未针对工具栏导出做显式处理。该差异提供定位方向，但尚未复现和证明根因，不宣称已经修复，也不把 R2022a 复测当成 R2024b 修复证据。

原始 manualChecks 的 imageAppearance、offlineOperation、relaunch 均为 NOT_RUN。此次仅完成带回图片的人工查看，不能补写成外机断网、重启已通过。缺少这些证据和后续实现时，自动报告顶层 PASS 不代表完整 V1 验收通过。

## 文件指纹

| 文件 | SHA-256 |
|---|---|
| acceptance-report.json | d084521a03ad78a5ee0510d0f087fd59641c76de855779044188166fd4b1ae92 |
| sample-1.png | 1fbd81f704cdbd4544e90e62fe65345e813ad40b91f56f08f2f168b92469d99c |
| sample-2.png | 2073d08804b641015e813b4e6456bfc3121920f1c358c458b5270467c27f0359 |
| sample-3.png | 326369b9cf086d2f7b092f63e06a60ea8be0db00ee6436c3316bc5741424d99b |
| 本机最终 alpha.2 安装包 | d68c1da30b437297948c0d78b30f6269c2d06982535077d833f8af9bbc92599e |

最后一项为本机保存的交付安装包校验值；外机回传材料没有安装程序哈希，构建对应关系依赖报告内的版本与 revision。
