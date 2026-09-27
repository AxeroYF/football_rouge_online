# R33 球员卡特性显示

统一球员卡在强化标记下方显示最多两行特性名称，超过两个显示 +N，无特性不显示占位。长名称省略，完整信息保留在无障碍标签和球员详情。支持字符串名称、特性 ID、对象和嵌套 card 数据；仓库延迟渲染沿用同一组件。

特性来自已有数据，名称使用本地共享目录解析，没有逐卡网络请求、新增轮询或服务端写入。已更新浏览器模块和样式缓存版本。大、中、小卡截图见 outputs/card-traits-review/cards.png；11 项卡片测试与全量测试通过，升级和回滚演练通过。

基于 R31 的累积包，包含 R32 重复保存修复。尚未远程部署。无需重装 Windows 或安卓客户端，部署后重新打开游戏。

上传更新包及校验文件到 /home/admin，分别执行：

```bash
cd /home/admin
```

```bash
sha256sum -c yellowdogs-hot-update-20260920-r33.tar.gz.sha256
```

```bash
tar -xzf yellowdogs-hot-update-20260920-r33.tar.gz
```

```bash
cd yellowdogs-hot-update-20260920-r33
```

```bash
sudo bash update.sh --check
```

```bash
sudo bash update.sh apply
```

安装器保留配套代码与存档备份，健康失败自动回滚。此前 R32 保存次数诊断仍保留。
