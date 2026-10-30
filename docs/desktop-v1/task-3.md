# Task 3：用户数据、配置和偏好隔离

状态：实现及针对性回归通过。执行目录为 antenna-draw-desktop，分支 feature/desktop-v1，继续使用既有隔离 worktree。

- runtimePaths 统一解析 stable/dev 用户目录和只读资源目录，拒绝相对路径及将数据写入安装资源。
- settings.json 与 preferences.json 分开保存；有限数值、指标、范围、分档、schema 严格校验，MATLAB 并发固定为 1。
- 同目录临时文件、fsync、原子替换及上一有效备份；坏配置保留原件并恢复，较新 schema 停止写入，包括增加未知字段的未来 schema。
- sources.json 使用原子保存；主动导入只读取所选旧项目的配置及显式源路径，离线源保留登记，不移动 DEM。可选偏好只读取用户显式提供的导出文件。
- 前端挂载前从服务加载偏好，异步保存成功后才更新 reactive 状态并显示成功；失败保留旧有效值。排队合并保存，避免同时修改不同指标互相覆盖。
- 源码 CLI、惰性兼容服务也使用 dev 用户根，不再自动读取旧 backend/config.json；旧文件仅通过主动导入使用。
- 基线 runner 为每条命令提供临时数据根；修复默认目录迁移后测试意外尝试写用户 exports 的问题，不改变业务行为。

验证：backend/tests 与 desktop node:test 共 16/16；frontend 模型共 10/10；Electron 集成 4/4，新增真实界面保存色标、关闭、随机端口重启、从文件恢复断言；frontend build 退出 0；原七条基线命令全部退出 0。

Electron 测试使用临时用户目录和正常宿主权限，sandbox 未关闭。没有修改真实源注册表，未重建或替换用户当前 alpha.2 安装包。NSIS 覆盖升级与真实 stable/dev 同机运行矩阵按 Task 9 执行，最终安装包端到端仍按 Task 10 验收；本任务的单元测试不冒充该两项发布验收。
