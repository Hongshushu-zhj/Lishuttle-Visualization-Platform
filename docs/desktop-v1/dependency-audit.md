# 依赖安全复核

## 1.0.0 正式构建复核（2026-11-01）

正式版与 RC3 的应用代码和依赖锁定版本相同。重新运行 `npm audit --omit=dev --json`：前端 0 项；后端 6 个中等级受影响包，0 高危、0 严重。原始报告在 `.desktop-test-data/formal-release-1.0.0/audit-backend.json` 和 `audit-frontend.json`。后端审计退出码为 1，未将其记为全通过。

这 6 项来自两条公告及其依赖传播：

- glob 的 AbortSignal 取消后仍遍历文件问题，GHSA-3g3m-2fjr-6pw4；当前 10.5.0。
- minimatch 的 globparts 放大拒绝服务问题，GHSA-g3hv-75wg-m249；当前依赖链含 9.0.9 和 5.1.9。
- archiver、archiver-utils、readdir-glob、zip-stream 的条目为上述依赖传播，不是另外四条独立公告。

实际调用核查：生产代码仅在 `backend/src/exporter.js` 调用 `archiver('zip')` 后以 `archive.file()` 添加明确的成功图片路径；没有将输入转换成 glob，也没有调用 `archive.glob()`、`archive.directory()` 或 `archiver-utils.file.expand()`。导出 API 从已有图片和历史结果中选择文件。库内 `file()` 调用 `_append`，不进入目录或通配匹配方法。

另外以测试专用加载拦截器阻止 glob、minimatch、readdir-glob 的函数或构造调用，使用带中文及方括号文件名的真实 PNG 运行生产 `createExporter().createZip()`，ZIP 成功且拦截次数 0，输出 `EXPORT_GLOB_PATH_NOT_REACHED`。证据为 `dependency-reachability.json`。这是当前导出路径的可达性证据，没有移除依赖或证明其其他 API 安全；静态审计仍保留 6 项。

本次保持已验收依赖组合，不在版本提升时强制升级 archiver 主要版本。后续若增加目录/通配打包，必须先处理相关依赖并复核；现有两条中等级公告列为已知限制，不再沿用 RC3 当日 0 项审计结果作为当前状态。

## RC3 历史复核（2026-10-31）

2026-10-31，npm 官方审计接口，生产依赖范围（omit=dev）。

初次审计发现 body-parser GHSA-27r3-jxmh-p828、qs GHSA-6pq8-jhm2-2vcw、source-map-js GHSA-68fv-2mgg-jv7q。分别锁定到 1.20.9、6.16.1、1.2.2。没有升级 Express、Vue 或 Electron 的主版本。

新增测试先在原依赖上失败，更新后通过；qs 的非函数 own toString/comma 序列化崩溃已实测重现并消失。66 项单测及七条原基线通过。后端 154 项生产依赖和前端 48 项生产依赖审计均返回 vulnerabilities.total=0。

glob 的旧版弃用提示仍存在，但当前生产依赖审计没有列出漏洞；不据此宣称不存在任何未知漏洞。开发工具链不随应用分发。

RC1/RC2 仅为本轮中间测试产物，不用于交付；最终候选改为 RC3，必须重新做实际产物及安装验证。
