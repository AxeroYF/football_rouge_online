# 地图加载优化 · 2026-09-06

当前状态：本地代码已完成并验证，**没有生成运行包或热更新包，没有连接或修改公网服务器，没有操作真实存档**。服务器 106.54.12.175 已由用户部署 V0.1 并开始测试，本轮优化尚未上线。

用户新增约定：之后的改动只有在用户明确要求打包时才制作热更新包或运行包；日常修复只修改、验证并记录本地代码。

## 问题与修复

1. index.html 原先预加载 7 个无版本地图 URL，实际加载器又请求带 ?v= 的 URL，形成重复下载。移除这些错误的预加载；完成登录/建队后，campaign-entry 提前启动地图数据请求，与 app 使用同一个 Promise 和解析结果。未登录、未完成建队不抢先下载整幅地图。失败请求会从缓存移除，可以重试。
2. 数据加载和 Three 模块导入原先串行，现在并行。构建陆地时同时请求高程和自然数据；高程 JSON 与 BIN 使用已知本地文件名并行请求，不再等待清单才能下载 BIN。保留加载取消和错误清理。
3. 原高程 BIN 总计 6,386,490 字节，Nginx 原配置未压缩该类型。服务端为固定公开地图资产提供 gzip，16MB 压缩结果 LRU 缓存、最多 2 个压缩任务、单文件最多 12MB；相同文件的并发冷请求共用一次压缩。没有增加依赖，不要求修改 Nginx。
4. 国家数据原来包含 242 个世界国家/地区，实际地图只使用欧洲与南美的 64 个。新增 campaign-countries.geojson，仅移除原渲染筛选本就排除的区域；保留 64 个 Feature 的全部属性、原始几何坐标和精度。文件从 3,083,490 字节降到 737,186 字节，原自然地理源文件保留。
5. 16 个固定地图资源使用真实 SHA256 内容版本。服务器对照实际文件内容确认版本匹配后设置一年 immutable 缓存；普通/旧版本 URL 重新验证，文件变化会重新压缩。保留 gzip 协商、Vary、按编码区分的 ETag、HEAD 和 304 响应头。动态账号、世界状态、后台及球员库数据不进入此长期缓存。

没有简化地形坐标、删减自然效果或改变迷雾/世界逻辑，没有增加界面说明小字。

## 验证

- 完整 npm run check：**574 项通过（68 + 437 + 69）**。
- 新增 9 项地图加载回归：几何精确一致、内容版本、登录预热去重、失败重试、元数据/BIN 并行、压缩缓存并发/容量/失效、HTTP 无损传输/协商/HEAD/304/修改后失效/私有路径拒绝等。
- Ubuntu WSL、发行包同款 Linux Node 24.20.0：地图及运行时相关 **16 项通过**。使用临时目录与随机 loopback 端口，不涉及开发服务或存档。
- scripts/measure-map-loading.mjs 对当前源码启动独立静态服务器，对 16 个地图文件检查真实 HTTP 响应，解压后全部匹配原始 SHA256；16 次条件请求均为 304，响应体为 0。
- 不属于浏览器视觉/耗时验收，也不是目标服务器压力测试。

| 地图数据传输口径 | 字节 |
| --- | ---: |
| 原 Nginx gzip level 2 配置，暂不计重复预加载（估算） | 12,876,846 |
| 额外 7 个重复预加载（估算） | 5,828,185 |
| 原配置合计（估算） | 18,705,031 |
| 优化后 16 个文件的实际 HTTP 响应体 | 5,764,417 |
| 原三个高程 BIN | 6,386,490 |
| 同三个高程 BIN 实际 gzip 响应体 | 646,511 |

上述地图资源体积下降约 55.2%；包含重复预加载口径则下降约 69.2%。数据统计包含可选自然环境文件，不含整个页面的 JS、CSS、卡画和登录 API。旧版数字按源码请求地址及已部署 Nginx 配置建模；没有声称测得公网进入地图的实际秒数。

报告：
- outputs/map-loading-review/transfer-report.json
- outputs/map-loading-full-check.log
- outputs/map-loading-linux-check.log
- outputs/map-loading-regression.log

## 后续维护与发布

- 更改国家源文件或 16 个地图资源后执行：npm run build:map-assets。
- 生成步骤只更新本地地图衍生数据及内容版本清单，**不制作发布包**。
- npm run check 会验证清单是否与文件一致，避免忘记更新内容版本。
- 本轮包括前端和服务端改动。未来得到用户打包授权时，需一起带上新文件，更新后重启 yellowdogs，再刷新页面。
- 核心新文件：assets/data/campaign-countries.geojson、shared/config/map-assets.mjs、server/http/static-asset-cache.mjs。
- 核心修改：index.html、campaign-entry.js、app.js、client/map/campaign-map-data.js、client/map-three/{campaign-layer,relief-field,environment,atlas-nature-model}.js、server/http/static-handler.mjs。
- 不重新导入 S4 账号种子、不覆盖线上存档、不重新执行首次安装脚本。本轮未修改此前 releases/v0.1-20260906-r2。
