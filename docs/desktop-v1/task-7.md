# Task 7：输出与下载

2026-10-31，feature/desktop-v1，合成数据与独立临时用户根。

- 两种输出策略统一使用 outputPaths；同名源由 source.id 隔离。路径片段、pred 输入树、junction 逃逸和最终文件越界均拒绝。
- MATLAB 写同目录临时 PNG；验证完整 chunk/CRC/解压流、输入指纹后替换，最后原子发布 meta。取消或坏 PNG 不发布半图。
- wx 跨进程输出锁，仅确认所属进程及 Node 发布清理完成后释放；只收到 MATLAB 原生退出证明不能回收。未知监管异常保留锁和并发阻断。
- 任务保存输出快照。设置改动、源登记删除后，历史图片及 ZIP 仍从原位置读取；任务记录提供下载及打开原目录入口。
- 下载先显示“准备/等待确认”，仅 Electron completed 报保存成功；cancelled 静默，interrupted 明确提示失败。

验证证据：

- output-paths、output-history、output-runner 专项 8/8；另有下载事件和服务生命周期测试。
- 真实 Electron/R2022a 两策略各绘图、PNG、ZIP；改变设置后历史 URL；CSV blob、Canvas PNG；取消和不可写目标，1/1 集成通过（50.8 秒）。
- 完整 PNG 校验兼容实际 R2022a 三图，原生技术验收全 PASS。
- 界面截图：`.desktop-test-data/screenshots/output-history.png`；不提交个人路径和图片二进制。
- 收尾全量：42/42 后端/桌面 node:test、13/13 前端模型、8/8 Electron、七条基线通过。
- 首次基线遇到随机端口被 fetch 拒绝（bad port）；重跑七条全通过。Task 8 将给桌面服务增加受限端口排除，避免同类启动偶发故障。

边界：不可写目标使用临时普通文件阻断目录创建；没有更改真实源目录 ACL。旧报告不替代最终候选安装验收。
