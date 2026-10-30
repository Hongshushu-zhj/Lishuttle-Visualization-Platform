# Desktop V1 验收矩阵

状态只使用 PASS / FAIL / 未执行。构建成功不能代替安装后验收。

| 阶段 | 检查 | 状态 | 证据 |
|---|---|---|---|
| 基线 | 临时合成样本、统计断言、原专项 | PASS | baseline.md，baseline-results.json |
| 基线 | 真实 MATLAB R2022a 数值及微型出图 | PASS | MATLAB_COMPATIBILITY_OK，exit 0 |
| A | utilityProcess 启动、释放端口、失败反馈、单实例 | 未执行 | 待桌面原型 |
| A | unpacked 真实 worker、MATLAB、PNG、ZIP 保存 | 未执行 | 待产物 smoke |
| A | 普通用户无 Node/源码的 NSIS 安装 | 未执行 | 需要隔离 Windows 验收环境 |
| B | 渠道隔离、设置、迁移、环境检测、首次引导 | 未执行 | 按 A 关口后推进 |
| C | 取消/超时、部分失败、重启恢复、输出策略 | 未执行 | 按计划推进 |
| C | 室内外、多任务、对比、调色、分析、三种导出 | 未执行 | 自动及人工回归 |
| D | 安装、升级、卸载、共存、离线、错误恢复 | 未执行 | 最终安装包验收 |

阶段 A 未通过前不推进设置页等后续任务，不将候选产物标为正式版本。
