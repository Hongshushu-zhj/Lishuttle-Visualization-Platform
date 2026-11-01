# Desktop V1 1.0.0 正式构建

日期：2026-11-01。分支：feature/desktop-v1。

## 用户确认

用户在收到 RC3 外机复核记录与剩余手工验收范围后明确回复：“没问题了，请你开始构建正式版1.0.0”。据此接受现有验收范围并授权正式版本构建；没有逐项回传的手工项目仍按原记录保留，不据此补写为实测 PASS。

RC3 两轮外机技术自检各 5/5、R2024b 六张样图与两份 ZIP 已复核通过；用户确认关闭重开和离线本地 RSRP 正常。原始复核见 external-rc3-review-2026-11-01.md。rc3-remaining-acceptance.md 保留当时逐项记录状态，后续可补录实际结果。

## 构建范围

从已验收代码重新构建正式版本 1.0.0，应用源码与依赖锁定版本保持 RC3 状态，仅提升根 package.json 和 package-lock.json 中的应用版本。stable 与 dev 分别生成，渠道标识及数据根保持隔离。构建前提交版本修改，实际构建 revision 和 workingTreeDirty 以各包 build-info.json 为准。

本机将核对正式包资源与版本、RC3→1.0.0 覆盖升级与配置/历史保留、stable/dev 共存、正式安装后的真实 MATLAB/线程/PNG/ZIP，并生成交付 SHA-256。构建、安装及校验结果完成后追加到本记录。

目标交付目录：release/交付-1.0.0。原 release/交付-RC3 保持冻结。安装程序为当前用户 Windows x64 包，未签名状态如实记录。不自动推送、合并或发布 GitHub Release。
