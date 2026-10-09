import pathlib,json,hashlib,tarfile,shutil,re
root=pathlib.Path(__file__).resolve().parent.parent
out=root/'outputs/hot-update-20260921-r36';name='yellowdogs-hot-update-20260921-r36';bundle=out/name
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
qa=read(out/'incremental-preflight.json');assert qa['passed']
log=(root/'outputs/daily-league-r36-tests-final.log').read_text(encoding='utf-8-sig');assert re.findall(r'^# fail (\d+)',log,re.M)==['0']
browser=read(root/'outputs/daily-league-r36-review/browser-report.json');assert browser['passed']
qa.update(testsPassed=int(re.search(r'^# pass (\d+)',log,re.M)[1]),browserReview=browser,remoteDeployed=False)
write(bundle/'QA.json',qa)
doc='''# R36 电视台观众与赛前积分榜 · 2026-09-21

用户已确认 R35 部署成功。本包基于 R35，仅更新六个运行文件；未远程部署，无需重装客户端，不覆盖已交付的 R35 包。

## 变更

- 对照 S4 确认 R35 缺少观众会话：本版电视台每场直播和比赛画面均显示正在观看的玩家姓名、人数；以登录账号为准，不接受客户端伪造姓名。
- 同账号多窗口按一人统计；关闭退出，断网/后台停止心跳后 30 秒过期。最多保留每账号 8 个观赛会话，仅存在服务内存，不写存档、不推进比赛；复用原有每 2 秒直播请求。
- 电视台入口随现有公共状态刷新显示 LIVE（通常约 5 秒）；电视台标题同样显示直播标记，全部比赛结束后取消。电视台列表仍每 10 秒刷新，无新增后台轮询。
- 没有生成赛事时，服务端实时匹配既定参赛玩家与四支豪门，返回零数据积分榜；不提前生成赛程，不在前端硬编码报名名单。未建队或无法唯一匹配的账号不捏造球队。已有上一届结果仍按既定规则保留至次日 09:50。
- 积分榜保留深绿样式，增强本人行与积分辨识度、固定表头和积分列，小屏横向滚动；较窄桌面使用完整窗口，避免挤入过窄侧栏。手机直播也显示观众信息。
- 联赛直播标题纠正为“每日联赛”，不再显示“地块争夺赛”。其他比赛使用原来的标题和工具栏。

## 验证

59 项针对性回归通过，覆盖赛前零数据、真实账号观众/鉴权/跨窗口去重/退出/超时/内存上限/不存档、不推进比赛，以及共享直播、窗口标准、状态增量。

浏览器检查通过：10 队赛前榜、90 场赛程、5 场直播、两名观众名单、关闭停止轮询、LIVE 开关、桌面/横屏/手机竖屏；证据在 outputs/daily-league-r36-review/。R35→R36 安装、校验拒绝、重入、显式回滚和健康失败自动回滚通过。服务启停为本地模拟，不是线上并发压测。

## 部署

上传更新包及同名 .sha256 到 /home/admin，逐条执行：

```bash
cd /home/admin
```

```bash
sha256sum -c yellowdogs-hot-update-20260921-r36.tar.gz.sha256
```

```bash
tar -xzf yellowdogs-hot-update-20260921-r36.tar.gz
```

```bash
cd yellowdogs-hot-update-20260921-r36
```

```bash
sudo bash update.sh --check
```

```bash
sudo bash update.sh apply
```

看到 Installed: 20260921-r36 后刷新游戏。保留更新器创建的匹配代码/存档备份；需要回退时使用更新器，不单独替换旧代码。
'''
(bundle/'DEPLOY.md').write_text(doc,encoding='utf-8')
m=read(bundle/'MANIFEST.json')
for f in m['files']:assert hashlib.sha256((root/f['path']).read_bytes()).hexdigest()==f['sha256']
(bundle/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(bundle).as_posix()+'\n' for p in sorted(bundle.rglob('*')) if p.is_file() and p.name!='SHA256SUMS'),encoding='utf-8')
a=out/(name+'.tar.gz');assert not a.exists()
with tarfile.open(a,'w:gz') as t:t.add(bundle,arcname=name)
sha=hashlib.sha256(a.read_bytes()).hexdigest();line=sha+'  '+a.name+'\n';pathlib.Path(str(a)+'.sha256').write_text(line,encoding='utf-8')
with tarfile.open(a) as t:
 for ln in t.extractfile(name+'/SHA256SUMS').read().decode().splitlines():
  h,p=ln.split('  ',1);assert hashlib.sha256(t.extractfile(name+'/'+p).read()).hexdigest()==h
r=root/'releases/20260921-r36';r.mkdir()
for file in ['MANIFEST.json','QA.json']:shutil.copy2(bundle/file,r/file)
(r/'ARCHIVE.sha256').write_text(line,encoding='utf-8')
b=read(root/'releases/20260921-r35/BASELINE.json');b.update(version='20260921-r36',parent='20260921-r35',source='TV spectators, LIVE badge and pre-schedule standings')
mp={f['path']:f for f in b['files']}
for f in m['files']:mp[f['path']]={'path':f['path'],'sha256':f['sha256']}
b['files']=list(mp.values());write(r/'BASELINE.json',b)
c=read(root/'releases/CURRENT.json');assert c['lastUserConfirmedDeployed']=='20260921-r35'
c.update(latestPublished='20260921-r36',sourceState='R35 deployment user-confirmed; R36 locally verified, deployment unconfirmed')
c['releases'].append({'version':'20260921-r36','parent':'20260921-r35','bundleSha256':sha,'baselineFiles':len(mp),'changedFiles':len(m['files']),'deployment':'not-confirmed'});write(root/'releases/CURRENT.json',c)
archive=root/'handoff/archive/before-r36-handoff-20260921';archive.mkdir()
for file in ['README.md','CURRENT_STATE.md','MANIFEST.md','NEW_CHAT_PROMPT.md','README_UPDATE.md','CHANGED_FILES.txt']:shutil.copy2(root/'handoff'/file,archive/file)
(root/'handoff/DAILY_LEAGUE_R36_20260921.md').write_text(doc,encoding='utf-8')
summary=f'''# 当前有效状态 · R36 · 2026-09-21

工作树 D:/Project/game_test/.worktrees/Rougelite，分支 codex/rougelite。保留既有大量未提交修改，不得 reset/clean 或覆盖。用户自行部署，不做 SSH、提交、推送或 PR；不主动启动子代理。

用户明确确认 R35 已部署。最新交付 R36（未确认部署），以已部署 R35 为基础，六个运行文件，零新增依赖。R35 的每日联赛规则、体力/票房/奇观、09:50 重置保持原样。

R36 增加电视台/直播在线观众、LIVE 角标、未生成赛程时的零数据积分榜和响应式可读性。固定玩家名单仅服务端配置。完整规则与独立命令块见 [R36 说明](DAILY_LEAGUE_R36_20260921.md)，原联赛见 [R35 说明](DAILY_LEAGUE_R35_20260921.md)。

验证：59 项针对性回归；桌面/横屏/竖屏浏览器；R35 安装及回滚，全部通过。本次无新增完整赛季或线上压测。观众只在内存，复用 2 秒直播心跳，30 秒过期；顶部角标复用公共状态刷新。已保留 R35 90 场赛季证据，不可将本地数据当线上性能保证。

交付包 outputs/hot-update-20260921-r36/{name}.tar.gz

SHA256：{sha}

下一步等待用户部署 R36 反馈。已交付包不可覆盖重打；后续修改另起版本。Windows 0.1.4、安卓 v4 客户端继续使用，只需刷新。
'''
(root/'handoff/CURRENT_STATE.md').write_text(summary,encoding='utf-8')
(root/'handoff/NEW_CHAT_PROMPT.md').write_text(summary+'\n先读当前状态及 R36 说明。默认沙箱 helper 可能失败，必要时使用 require_escalated。真实账号存档和密钥不得发布。\n',encoding='utf-8')
(root/'handoff/README.md').write_text('# Rougelite 交接 · R36\n\nR35 用户确认已部署；R36 本地交付，尚未确认部署。\n\n依次阅读 [当前状态](CURRENT_STATE.md)、[R36 说明](DAILY_LEAGUE_R36_20260921.md)、[发布记录](../releases/CURRENT.json)。原联赛规则见 [R35](DAILY_LEAGUE_R35_20260921.md)。\n',encoding='utf-8')
p=root/'handoff/MANIFEST.md';p.write_text('# 最新交付 R36\n\n- [R36 电视台与积分榜](DAILY_LEAGUE_R36_20260921.md)\n\n以下历史索引，部署状态以 CURRENT_STATE.md 为准。\n\n'+p.read_text(encoding='utf-8'),encoding='utf-8')
(root/'handoff/README_UPDATE.md').write_text('R35 已确认部署；R36 观众名单、LIVE 角标、赛前榜及可读性补丁本地交付，未远程部署。旧入口已归档。\n',encoding='utf-8')
(root/'handoff/CHANGED_FILES.txt').write_text('\n'.join(f['path'] for f in m['files'])+'\n',encoding='utf-8')
print(json.dumps({'sha256':sha,'files':len(m['files']),'tests':qa['testsPassed'],'bytes':a.stat().st_size},ensure_ascii=False))
