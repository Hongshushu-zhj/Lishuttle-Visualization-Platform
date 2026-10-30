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
| A | 独立普通用户、无 Node/源码 Windows 环境安装 | 未执行 | 用户确认有独立环境，等待提供使用方式 |
| B | 渠道隔离、设置、迁移、环境检测、首次引导 | 未执行 | 按 A 关口后推进 |
| C | 取消/超时、部分失败、重启恢复、输出策略 | 未执行 | 按计划推进 |
| C | 室内外、多任务、对比、调色、分析、三种导出 | 未执行 | 自动及人工回归 |
| D | 安装、升级、卸载、共存、离线、错误恢复 | 未执行 | 最终安装包验收 |

阶段 A 未通过前不推进设置页等后续任务，不将候选产物标为正式版本。

## 阶段 A 实际结果与边界

工具链锁定为 Electron 45.1.0（内置 Node 24.22.1）、electron-builder 26.18.0、Playwright 1.64.1。版本来自实施时 npm 官方登记，使用根 package-lock.json 固定。测试机 Windows 11 x64 / 10.0.26200，真实 MATLAB 9.12.0.1884302 (R2022a)。

产物通过：室内 RSRP、室外 10m SCR、室内 BESTSERVER 共 3 图；成功数 3、失败数 0。原生解码尺寸分别为 823×426、744×639、829×407；PNG/ZIP 实际下载保存各 1 份。worker 均值 -90、有效样本 3。退出后后端正常结束；独立生命周期用例另外验证端口可重新绑定。

本机安装测试在 `.desktop-test-data/installed-prototype`，应用进程 PATH 只包含 Windows/System32 和 Windows；仍属于有开发工具的本机，不能代替独立干净系统验收。NSIS 当前仅提供 dev 渠道、alpha 未签名候选。

已发现并修复的测试问题：旧坐标脚本触及固定开发服务；打包器默认过滤后端 node_modules，现明确配置复制；Playwright 默认不接管 Electron 下载，改观察原生 DownloadItem 完成状态；测试求值回调中 require 不可用曾弹出主进程异常，现回调不再使用 require，重跑原生 PNG/ZIP/canvas 保存通过。

尚未实现的后续范围：MATLAB 图形化设置、偏好迁移、完整任务取消/超时、统一独立输出、安全诊断与正式发行。该候选只用于阶段 A 技术验证。
