# RC3 依赖安全复核

2026-10-31，npm 官方审计接口，生产依赖范围（omit=dev）。

初次审计发现 body-parser GHSA-27r3-jxmh-p828、qs GHSA-6pq8-jhm2-2vcw、source-map-js GHSA-68fv-2mgg-jv7q。分别锁定到 1.20.9、6.16.1、1.2.2。没有升级 Express、Vue 或 Electron 的主版本。

新增测试先在原依赖上失败，更新后通过；qs 的非函数 own toString/comma 序列化崩溃已实测重现并消失。66 项单测及七条原基线通过。后端 154 项生产依赖和前端 48 项生产依赖审计均返回 vulnerabilities.total=0。

glob 的旧版弃用提示仍存在，但当前生产依赖审计没有列出漏洞；不据此宣称不存在任何未知漏洞。开发工具链不随应用分发。

RC1/RC2 仅为本轮中间测试产物，不用于交付；最终候选改为 RC3，必须重新做实际产物及安装验证。
