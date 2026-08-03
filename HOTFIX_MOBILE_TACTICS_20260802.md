# S4 手机端战术界面热更新（2026-08-02）

## 更新内容

- 战术滑杆拖动采用轻量状态同步，停止连续执行完整表单采集。
- 场上球员和替补球员拖动使用逐帧合并与目标区域缓存。
- 触屏设备停止运行桌面悬浮提示跟随逻辑，并降低磁贴绘制负担。
- 手机端替补席保持三列，改为独立限高滚动。
- 手机端细节战术按“开局 / 平局、领先、落后”分页展示。
- 同时适配手机竖屏与横屏，不影响桌面端三栏布局。

## 文件范围

- `versus/public/app.js`
- `versus/public/styles.css`

本包不包含玩家账号、联赛存档、卡片数据、比赛数据和环境变量文件。

## Ubuntu 更新命令

假设压缩包上传至 `/home/admin/`，项目目录为 `/opt/football-s4`：

```bash
cd /opt/football-s4

sudo cp -a versus/public/app.js versus/public/app.js.bak-mobile-20260802
sudo cp -a versus/public/styles.css versus/public/styles.css.bak-mobile-20260802

sudo tar -xzf /home/admin/football-ydl-s4-mobile-tactics-hotfix-20260802.tar.gz -C /opt/football-s4

sudo systemctl restart football-s4
sudo systemctl status football-s4 --no-pager
curl -fsS -I http://127.0.0.1:4318/versus/
```

浏览器静态资源由服务端以 `no-store` 返回，更新后重新打开页面即可获取新文件；手机浏览器如仍保留旧页面，关闭页面后重新进入。

## 回滚

```bash
cd /opt/football-s4
sudo cp -a versus/public/app.js.bak-mobile-20260802 versus/public/app.js
sudo cp -a versus/public/styles.css.bak-mobile-20260802 versus/public/styles.css
sudo systemctl restart football-s4
```

## 本地验证

- `node --check versus/public/app.js`
- `node --test test/s4-assets.test.js`：86/86 通过
- `git diff --check`：通过
