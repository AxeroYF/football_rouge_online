# R38 联赛 AI 标志 · 2026-09-21

用户确认 R37 已部署。本包基于 R37，尚未远程部署。

联赛积分榜、赛程、个人榜球队名及直播主要球队标签使用 AI 徽标，不再显示〔豪门〕文字。通知和纯文本字段使用 [AI]。前端兼容已有赛事名称，不修改联赛存档、不重置赛程。

22 项相关回归及桌面/手机浏览器检查通过，四支 AI 球队标志正常；增量安装与回滚检查通过。

## 一行部署

将 tar.gz 和同名 .sha256 上传到 /home/admin 后执行：

```bash
cd /home/admin && sha256sum -c yellowdogs-hot-update-20260921-r38.tar.gz.sha256 && tar -xzf yellowdogs-hot-update-20260921-r38.tar.gz && cd yellowdogs-hot-update-20260921-r38 && sudo bash update.sh --check && sudo bash update.sh apply
```

成功后刷新游戏，无需重装客户端。命令通过 && 串联，校验或预检查失败即停止。保留更新器生成的匹配代码和存档备份。
