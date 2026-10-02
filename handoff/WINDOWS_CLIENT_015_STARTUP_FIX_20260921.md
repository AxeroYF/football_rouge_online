# Windows 0.1.5 启动阻塞修复 · 2026-09-21

用户报告本地客户端停在资源准备 campaign-broadcast.js。安装版为 0.1.4，代码与仓库一致。只读检查线上首页和脚本均为 200，脚本内容匹配其版本哈希；用户缓存中该脚本也已完整下载。

独立 Electron 复现记录只剩 static.cloudflareinsights.com/beacon.min.js 的统计脚本请求未完成。启动器等待 loadURL 完成才显示游戏窗口，非游戏必需的延迟统计脚本拖住页面加载。对照实验仅跳过该脚本，约 3 秒完成加载并显示登录页。不是 campaign-broadcast.js 损坏或联赛计算堵塞。

0.1.5 在客户端请求层跳过该精确统计脚本路径，不改变游戏 API、资源校验或服务器。未知大小的脚本改为显示已下载 KB，避免 0.0 / 0.0 MB 误导。

验证：16 项缓存/清单测试通过；模拟连接失败后重试成功；模拟统计脚本阻塞通过。最终打包程序真实线上入口加载成功；包内版本 0.1.5 和修复源码哈希一致。用户原客户端、登录信息、缓存和账号未修改，未部署服务器。

安装器：outputs/windows-client-0.1.5/YellowDogs-Setup-0.1.5-x64.exe
SHA256：5c22e013307fc8414f5af9e7e9f60269be7b43a7f876a62685d9740a885c2ef5

用法：退出旧客户端，运行新安装器覆盖安装到原目录，保留登录及资源缓存。无需清缓存，无需服务器更新。尚未替用户安装。

证据：outputs/client-loading-audit/electron-stack3.json（唯一未完成统计请求）、electron-fixed.json（对照恢复）、packaged-live-015/live-result.json、packaged-analytics-015/analytics-result.json。安装器校验与 QA.json 位于安装包同目录。
