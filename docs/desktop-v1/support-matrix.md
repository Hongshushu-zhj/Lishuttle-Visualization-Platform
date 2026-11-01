# Desktop V1 RC3 支持与验证范围

初始记录：2026-10-31；外机补充复核：2026-11-01。候选版本：1.0.0-rc.3，尚未确认为正式 1.0.0。

| 项目 | 实际版本/状态 | 证据及边界 |
|---|---|---|
| Windows | Windows 11 x64，10.0.26200.0 | 本机真实安装及自动回归；不承诺未测试系统 |
| MATLAB 本机 | 9.12.0.1884302 (R2022a) | RC3 实际产物环境检测、室内/室外/BESTSERVER 三图通过 |
| MATLAB 外机 RC3 | 24.2.0.2712019 (R2024b) | 最终 0090f38 构建两轮五项检查、六张样图、两份 ZIP 内容通过；用户确认重开及离线本地 RSRP 正常，完整界面/异常矩阵待补 |
| Electron / 内置 Node | 45.1.0 / 24.22.1 | RC3 实际进程 getAppInfo；应用自带运行时 |
| 构建机 Node / npm | 24.15.0 / 11.12.1 | 仅开发构建需要，安装使用者不需要 |
| electron-builder / Playwright | 26.18.0 / 1.64.1 | package-lock.json 固定版本 |
| 安装范围 | 当前 Windows 用户、x64 | 中文和空格安装路径纳入安装矩阵 |
| 签名 | 未签名 | 不绕过系统策略；交付核对 SHA-256 |

用户必须自行安装具备有效许可的 MATLAB。真实许可失效尚未演练，不修改正常许可来制造故障；没有 MATLAB 时可使用分析和预览，绘图需先配置并检测。

stable 为 com.antennadraw.desktop，数据根为 %LOCALAPPDATA%/AntennaDraw；dev 为 com.antennadraw.desktop.dev，数据根为 %LOCALAPPDATA%/AntennaDraw-Dev。稳定默认在源目录旁输出，开发默认独立结果目录；用户明确选择相同目标时使用跨实例输出锁。

V1 采用手动升级；不包含自动更新、账号、使用者准入控制、云计算或数据上传。最终独立设备验收范围见 external-final-guide.md 和 final-manual-results.md。
