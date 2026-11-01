# Desktop V1 1.0.0 正式构建

日期：2026-11-01。分支：feature/desktop-v1。

## 用户确认

用户在收到 RC3 外机复核记录与剩余手工验收范围后明确回复：“没问题了，请你开始构建正式版1.0.0”。据此接受现有验收范围并授权正式版本构建；没有逐项回传的手工项目仍按原记录保留，不据此补写为实测 PASS。

RC3 两轮外机技术自检各 5/5、R2024b 六张样图与两份 ZIP 已复核通过；用户确认关闭重开和离线本地 RSRP 正常。原始复核见 external-rc3-review-2026-11-01.md。rc3-remaining-acceptance.md 保留当时逐项记录状态，后续可补录实际结果。

## 构建范围

从已验收代码重新构建正式版本 1.0.0，应用源码与依赖锁定版本保持 RC3 状态，仅提升根 package.json 和 package-lock.json 中的应用版本。stable 与 dev 分别生成，渠道标识及数据根保持隔离。构建前提交版本修改，实际构建 revision 和 workingTreeDirty 以各包 build-info.json 为准。

本机将核对正式包资源与版本、RC3→1.0.0 覆盖升级与配置/历史保留、stable/dev 共存、正式安装后的真实 MATLAB/线程/PNG/ZIP，并生成交付 SHA-256。构建、安装及校验结果完成后追加到本记录。

目标交付目录：release/交付-1.0.0。原 release/交付-RC3 保持冻结。安装程序为当前用户 Windows x64 包，未签名状态如实记录。不自动推送、合并或发布 GitHub Release。

## 已完成的构建与回归

- 干净构建提交：`4ac4548db0528afa579a8dd95dc4103e8aa6d273`。stable/dev 的版本均为 1.0.0，workingTreeDirty=false，各 2787 个资源文件审计通过。
- 两渠道分别与 RC3 逐文件比较：2785 个资源完全相同，只有 app.asar 中的应用版本和 build-info.json 的构建信息变化；应用代码及锁定依赖没有变化。RC3 冻结交付文件的原 SHA-256 清单复核通过。
- 配置/进程/安全/输出/前端模型 66/66、Electron 集成 9/9、原七条基线 7/7，通过且退出码均为 0。Electron 包含真实 MATLAB 检测/取消、两种输出、PNG/ZIP/CSV/Canvas 保存、配置重开和强退恢复。
- stable unpacked 正式资源下真实 MATLAB 检测、统计线程、室内/室外/BESTSERVER 三图、PNG/ZIP 保存及退出通过，系统 PATH 仅含 Windows 目录；仍是开发机本地验证，不冒充外机干净系统。
- 最新生产依赖审计：前端 0 项；后端 6 个中等级受影响包、0 高危/严重，来自两条 glob/minimatch 公告及传播；当前生产 ZIP 路径未执行通配遍历，详见 dependency-audit.md。没有把审计退出码 1 改为成功。

## 最终安装包指纹

| 渠道 | 文件 | SHA-256 |
|---|---|---|
| stable | AntennaDraw-Setup-1.0.0-x64.exe | 75e4e8f2761b478caf8fdba5ad856c8a081e53ad3b008e5ab6b69064e6053ee5 |
| dev | AntennaDraw-Dev-Setup-1.0.0-x64.exe | 341bf9ca32e8b7d72d20530a01f6c69dd3cac2285e653a913895cae2e6c0e7cf |

两个文件 Get-AuthenticodeSignature 均为 NotSigned。正式版不是 RC3 文件改名；NSIS 与包内版本已重新生成。

## 最终安装验证

RC3→1.0.0 安装矩阵 9/9、stable/dev 实际安装后各 7/7、正式 stable 菜单自检 5/5 通过。两渠道各 2787 安装资源及主 EXE 与构建产物哈希匹配；三张正式样图均已打开，无工具栏遮挡，ZIP 已实际解压且三张 PNG 与样图哈希集合匹配。证据为 .desktop-test-data/formal-release-1.0.0/final-artifacts.json 及同目录原始报告；全部本机自检保持 cleanEnvironmentConfirmed=false。

本地交付按用户接受的范围完成，不将未逐项回传的外机项目补写为实测通过。安装包、说明、证据和第三方许可汇总至 release/交付-1.0.0，逐文件 SHA-256 记录于该目录 SHA256SUMS.txt。测试安装入口恢复到测试前状态，正式使用从交付安装程序安装。
