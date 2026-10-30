# Task 6：任务生命周期与退出

2026-10-31。任务摘要按 jobId 原子保存，创建时快照 MATLAB/超时设置及逐图输出位置。统一 queued/running/cancelling/done/partial/failed/cancelled/timed_out/interrupted；区分成功、失败和取消数量，完整逐图原因。排队取消不启动进程；运行取消等待 supervisor 确认清理；无法确认时不释放槽位，不假报成功。状态保存失败取消活动进程并阻止新任务。

源码界面有统一任务状态卡和任务记录抽屉，所有终态停止轮询，失败层新建任务重试，保留已成功图片和原对比坐标范围。重启将未终结记录标中断，不自动重跑、不按旧 PID 清理。退出覆盖绘图、排队和检测；选择留在应用保留窗口；取消并退出等待服务、检测、队列及本次 MATLAB 所属进程清理，清理失败保留应用和错误。

Electron 与 utilityProcess 增加专用父进程寿命通道，主进程异常退出时后端立即停止写状态，原生守护进程完成 MATLAB 清理，再由新实例恢复记录。真实崩溃测试必须终止 `app.evaluate(() => process.pid)` 返回的实际主进程；本机 Electron 启动包装进程 PID 与实际主进程不同，不能用 Playwright app.process().pid 代替。

证据：6 项专门任务流程测试、实际 Windows 进程树回归、全部 Node/前端模型测试 46/46 通过；真实 Electron 覆盖取消退出与强制结束主进程后重启，验证 result.json cleanupConfirmed=true、无 active.json、旧记录 interrupted、只保留原一次执行。utilityProcess 内 R2022a 三图、PNG/ZIP 五项验收再次 PASS；原七条基线 exit 0。

输出快照的解析和原子 PNG 发布继续由 Task 7 完成，不能将本任务当作最终安装包验收。
