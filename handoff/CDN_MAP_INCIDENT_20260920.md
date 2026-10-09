# 20260920 地图下载停滞与客户端连接恢复

用户确认 R15 部署；公网带宽套餐 200 Mbps。
源站本机地形 GET：200，12,346,028 bytes / 1.829497 秒。
服务器经 Cloudflare GET gzip：30 秒仅 3,669,557 / 4,822,370 bytes，超时。
桌面侧公网 GET：200，20 秒仅 18,708 / 4,822,370 bytes，超时；另有连接超时。
实际哈希 URL HEAD：gzip、immutable 31536000、cf-cache-status DYNAMIC、HKG。
证实静态地图未进入 Cloudflare 边缘缓存；尚不能仅凭此证明所有链路故障都由缓存造成。

Cloudflare 控制台选择域名 → Caching → Cache Rules → 创建自定义规则；表达式：

```
(http.host eq "yellowdogsleague.online" and (starts_with(http.request.uri.path, "/versus/assets/data/") or starts_with(http.request.uri.path, "/assets/data/") or starts_with(http.request.uri.path, "/versus/shared/config/") or starts_with(http.request.uri.path, "/shared/config/")) and http.request.uri.query contains "v=sha256-")
```

Cache eligibility: Eligible for cache。
Edge TTL: 使用存在的源站 Cache-Control；不存在时 bypass（若界面提供该选项）。
Browser TTL: Respect origin。
Cache key: 保留默认查询参数，不忽略 v；不要全站 Cache Everything，不要缓存 API/登录/交易。
本规则排除了 /versus/ 页面和 API，且仅匹配公开静态目录中的内容版本 URL。
若存在后置 Bypass 规则覆盖，需要检查顺序。配置后重复 GET 同一哈希 URL，检查 cf-cache-status（首次可能 MISS，后续 HIT）及下载耗时；HEAD 不代表完整传输成功。首次填充失败则可能仍不能 HIT，仍需诊断回源；HIT 后仍慢则排查边缘到客户端链路。未实际操作 Cloudflare 配置。

客户端 0.1.2：失败旧窗口清理，重新点击真正重载，30 秒连接等待上限，重复点击合并；10 单元测试及打包 Electron 失败重试、本地地图读取验证通过。未验证真实账号对局，未宣称修复公网传输瓶颈。前次客户端仅测资源中心与缓存，未测真实导航恢复，已补测。

用户已部署静态缓存规则。部署后桌面实测第一次 GET：HTTP 200、cf-cache-status MISS（LAX）、4,822,370 bytes / 36.083531 秒；解压后 SHA256 与地图哈希 e6937b6c4dafb0cb7b6e207d6f8026a412a4cdbde0d6e52bb4d63fac7ca8f46e 一致。第二次 GET 45 秒超时，无响应头；因此尚未确认 HIT，外网链路仍不稳定，不能宣称问题已解决。
