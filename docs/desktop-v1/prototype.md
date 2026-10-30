# 阶段 A 技术原型

这是开发候选 `1.0.0-alpha.1`，不是正式 Desktop V1。应用标识 `com.antennadraw.desktop.dev`；正式稳定版不使用该安装包。

## 开发者复现

根目录执行 `npm ci`，然后分别在 backend 和 frontend 执行 `npm ci`。构建网页后可运行 `npm run test:desktop`。`npm run desktop:dev` 自动安装两个子项目的锁定依赖并构建网页；打包入口 `desktop:pack` / `desktop:dist` 同样负责这些步骤。安装后的应用不执行 npm、不需要外部 Node。

```powershell
npm run desktop:pack
node scripts/desktop-smoke.cjs --artifact release/win-unpacked --matlab '真实 MATLAB 完整路径'
npm run desktop:dist
npm run verify:package
```

桌面集成测试需要正常 Windows 桌面进程权限；受限沙箱可能阻止 Chromium 启动，不能通过关闭 Electron sandbox 解决。本次集成测试在普通本机执行环境保持 sandbox/contextIsolation 开启，nodeIntegration 关闭。

## 候选测试方式与范围

候选安装包在忽略的 `release/`。本地 smoke 必须显式传入真实 MATLAB 路径，不接受假 MATLAB 作为关口证明。运行时使用临时合成 DEM、独立数据和 MATLAB 偏好目录；测试后清理。`--no-node-path` 将应用 PATH 限制为 Windows 系统目录，`--report installed-smoke.json` 可保存安装目录复测证据。

这一阶段尚无图形化 MATLAB 配置。开发 smoke 通过仅 dev 渠道支持的 `ANTENNA_DESKTOP_MATLAB` 传入测试环境；用户版图形设置属于 Task 4～5。任务取消与退出等待属于 Task 6；本候选应在绘图结束后退出，不用于正式业务。

当前只证明本机安装和包内资源可用。独立无 Node、无源码、普通用户环境验收仍需完成，之后才能通过阶段 A。版本说明、升级、卸载与正式用户指南按后续任务交付。
