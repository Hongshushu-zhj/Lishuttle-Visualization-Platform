# Desktop V1 1.0.0 支持与验证范围

日期：2026-11-01。正式版按用户确认的 RC3 验收范围构建，实际构建源提交 4ac4548db0528afa579a8dd95dc4103e8aa6d273；应用代码和依赖与 RC3 相同。

| 项目 | 实际版本/状态 | 证据及边界 |
|---|---|---|
| Windows | Windows 11 x64，10.0.26200 | 本机实际安装、升级与回归；同版本外机 RC3 报告；不承诺未测试系统 |
| MATLAB 本机 | 9.12.0.1884302 (R2022a) | 正式资源真实环境检测、统计线程、室内/室外/BESTSERVER、PNG/ZIP；Electron 流程回归 |
| MATLAB 外机 | 24.2.0.2712019 (R2024b) | RC3 两轮 5/5、六张样图、两份 ZIP；用户确认重开与离线 RSRP；1.0.0 包未再次带到外机运行 |
| Electron / 内置 Node | 45.1.0 / 24.22.1 | 正式包实际 getAppInfo，用户不需另装运行时 |
| 构建机 Node / npm | 24.15.0 / 11.12.1 | 仅开发构建需要 |
| electron-builder / Playwright | 26.18.0 / 1.64.1 | 根 package-lock.json 固定 |
| 安装范围 | 当前 Windows 用户、x64 | 中文及空格路径纳入实际矩阵；不要求管理员安装 |
| 签名 | 未签名（NotSigned） | 安装程序 SHA-256 随交付提供 |
| 生产依赖审计 | 前端 0；后端 6 中等级，0 高危/严重 | 2026-11-01 官方 npm 审计；具体调用核查见 dependency-audit.md |

用户必须自行安装具备有效许可的 MATLAB。没有 MATLAB 时可分析和预览，绘图需先配置并检测。没有为测试修改 MATLAB 许可或制造业务磁盘耗尽；这两个真实故障场景保留未执行说明。

stable 标识为 com.antennadraw.desktop，数据根为 %LOCALAPPDATA%/AntennaDraw；dev 为 com.antennadraw.desktop.dev，数据根为 %LOCALAPPDATA%/AntennaDraw-Dev。稳定默认在源目录旁输出，开发默认独立结果目录；用户明确选择相同目标时使用跨实例锁。

用户在查看外机复核和剩余范围后确认正式构建。没有逐项提供的新手工证据保持原始状态，不将用户总体确认等同于每项均有机器或现场记录。详见 formal-release-1.0.0.md、external-rc3-review-2026-11-01.md 和 rc3-remaining-acceptance.md。

V1 采用手动升级，不包含自动更新、账号、使用者准入控制、云计算或数据上传。
