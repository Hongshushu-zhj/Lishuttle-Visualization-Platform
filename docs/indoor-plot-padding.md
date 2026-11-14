# Web 版室内绘图留白

实施日期：2026-11-10。仅修改 `platform`，依据桌面目录中的同日 indoor-plot-padding 方案适配 Web 架构。

## 规则与数据边界

同批室内原始范围先取并集，四侧各增加 `max(长边 × 5%, 最大栅格间距 × 2)` 米，不取整。常量及版本集中在 `backend/src/renderOptions.js`；前端和 MATLAB 只消费计算结果。

- `bounds`：每张图的原始解码范围及分辨率，不变。
- `xlim/ylim`：统一留白后的显示范围。
- `coordBounds`：本批原始并集，提供相对左下角和相对中心原点。
- `renderPolicy`：`indoor-padding-v1`。

示例：`[20,100] × [-70,0] / res=0.1` 显示为 `[16,104] × [-74,4]`，相对左下角仍为 `(20,-70)`。栅格仍按原始 extent 放置，白边不生成信号值。坐标轴维持等比例；色标、分析和统计口径未修改。非法或溢出的室内范围明确返回请求错误。

## Web 兼容性适配

新室内变体为 `ip1_<SHA-256 前16位>[_坐标模式]`，摘要包括精确显示范围、坐标基准及坐标模式。Web 版实际结果文件名原先只保留旧 `u...` 范围摘要，因此另外修改 `cache.js`，使新摘要也进入磁盘文件名；否则仅更新 URL 变体仍会覆盖旧 PNG。室外和旧变体命名保持原规则，不提升全局渲染缓存版本。

任务快照现有完整对象存取会保存新增字段，无需修改 schema 或用户设置。失败重试复制完整显示范围、基准、版本和变体，不按剩余层重新缩小范围。历史任务无字段时继续使用轴范围推导原点；旧下载、历史结果位置及输出快照沿用原逻辑。重新点击开始绘图才使用新规则。

`/preview` 继续返回原始栅格，不重复留白。Canvas 初次挂载和图卡范围/坐标基准更新都会同步高度并重绘；CPU Canvas 回退继续可用。

## 自动验证

在 `platform` 运行：

```powershell
node backend/scripts/verify-indoor-padding.js
node backend/scripts/verify-render-options.js
node --test frontend/scripts/indoor-padding.test.mjs
npm run test:baseline
npm --prefix frontend run build
```

Web 原有 `verify-render-options.js` 会连接已有服务、使用真实源并清除缓存；现改为隔离的 HTTP 集成测试入口。新增 `scripts/baseline.cjs` 和根目录 npm 脚本，统一执行纯函数检查及前后端测试。所有业务夹具使用临时目录，不登记或删除用户真实数据。

浏览器检查需已安装的 Playwright，通过 `PLAYWRIGHT_MODULE_PATH` 提供；`PLAYWRIGHT_EXECUTABLE_PATH` 可指定现有浏览器，无需下载浏览器。执行：

```powershell
node --test frontend/scripts/indoor-padding-browser.test.mjs frontend/scripts/raster-renderer.test.mjs
node backend/scripts/verify-web-ui.js
```

本机验证使用现有 Edge。检查真实像素：四侧留白为白色、有效栅格有色、无效格透明叠于白底、调色仅改变数据颜色。实际挂载 Vue 图卡，修改范围及基准后检查 Canvas 高度更新。现有 Web 界面流程亦验证引导、演示分析、CSV/PNG、设置、偏好迁移、诊断、预览保存/下载、任务记录与刷新恢复。

MATLAB 使用本应用当前配置的 `D:\Matlab\R2022a\bin\matlab.exe`，运行：

```matlab
addpath(fullfile(pwd,'matlab'));
verify_indoor_padding;
```

实际执行的合成验证已通过：三种坐标模式、旧室内任务、室外对照，共五张 PNG；核对 AXES 日志、实际轴范围、实际刻度标签/原点、数据纵横比例、栅格 CData/AlphaData/XData/YData 不变及 PNG 解码。产物保留在 `.web-test-data/indoor-padding/`，正式相对左下角图已人工查看，四侧有白底间距。

运行环境首次启动 MATLAB 时报告用户偏好目录访问警告，但上述五组断言和导出均成功，未修改该用户偏好文件。

另执行 `node backend/scripts/verify-web-matlab.js`，通过隔离的实际 Web 服务检测 MATLAB 并完成 15 张正式 PNG（三种模式各含室内 RSRP、室外 SCR/BESTSERVER）；历史图片在修改输出目录后仍可下载，ZIP 实际内容及 CRC 校验通过，MATLAB 检测取消/重试通过，退出后所属进程清理得到确认。证据为 `.web-test-data/real-matlab-9683of/evidence.json`。该次运行设置独立 `MATLAB_PREFDIR`，避免写用户偏好目录。

总回归需与上述实际 MATLAB 检查串行执行：原有两项进程恢复用例会保守地把其他活动监管器判为尚未退出，并发运行时会失败。已保留并发日志供核查，不为消除测试冲突修改原有进程保护逻辑。

最终串行重跑 `npm run test:baseline`：后端 89/89、前端 24/24（含 Canvas/WebGL 真实浏览器检查），无失败、无跳过；纯函数专项检查通过。`verify-render-options.js`、Web 界面回归及 `npm --prefix frontend run build` 均通过。最终总回归日志：`.web-test-data/indoor-padding/baseline.log`；首次并发冲突日志：同目录 `baseline-concurrent.log`。

## 验收边界

原墙线文件若已有遗漏，留白不会恢复缺失墙线。不改变图片固定像素尺寸或高清导出规则。

### 真实案例复核及服务生效排查（2026-11-10）

用户测试文件 `TSET-ct-indoor_1_RSRP_1层_绝对坐标.png` 的元数据及任务 `12abf832-759d-4169-b503-ae79ae10baac` 显示：轴仍为 `[19.14,100.24] × [-69.76,-2.56]`，变体为空，没有 `coordBounds/renderPolicy`。修改完成后运行中的 Node 服务未重启，内存中仍是旧模块。对当前服务发送同一 dryRun 请求亦复现旧范围，确认不是 MATLAB 忽略新范围或前端显示问题。

核实无运行中任务后，通过本项目实例令牌正常停止并重新启动 Web 服务。同一 dryRun 随后返回 `indoor-padding-v1`、`ip1_e57dff086e4adce7` 及 `[15.085,104.295] × [-73.815,1.495]`，对应每侧 4.055 米留白。应使用正常本机权限启动服务，受限进程不能写入工作区外的 LAB 结果目录。

真实任务 `7971cace-8658-4e1e-9915-55836acfc7bf` 已完成（1/1），实际 MATLAB AXES 与上述范围一致。新图另存为 `TSET-ct-indoor_1_RSRP_1层_绝对坐标_ip1-e57dff086e4adce7.png`，已打开检查：数据区域四侧有白底留白，原图与源文件保留，输入依赖签名与旧图一致。原文件中个别墙线延伸出数据范围，仍可能接触扩展后的图框；按既定范围不做墙线裁切或按墙线包围盒扩张。本次复核确认真实案例出图及显示效果，未重新执行该案例完整统计分析。

改动保留在本地工作区，不自动安装桌面包，不覆盖已有成果。Web 服务重启并刷新浏览器后可使用新代码；新建绘图应用留白，历史记录保持原有显示口径。
