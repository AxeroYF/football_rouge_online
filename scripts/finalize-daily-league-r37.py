import pathlib,json,hashlib,tarfile,shutil,re
root=pathlib.Path(__file__).resolve().parent.parent
out=root/'outputs/hot-update-20260921-r37';name='yellowdogs-hot-update-20260921-r37';bundle=out/name
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
qa=read(out/'incremental-preflight.json');assert qa['passed']
log=(root/'outputs/daily-league-r37-tests.log').read_text(encoding='utf-8-sig');assert re.findall(r'^# fail (\d+)',log,re.M)==['0']
assert read(out/'intermediate-upgrades.json')['passed']
qa.update(testsPassed=int(re.search(r'^# pass (\d+)',log,re.M)[1]),intermediateUpgrades=read(out/'intermediate-upgrades.json'),remoteDeployed=False)
write(bundle/'QA.json',qa)
doc='# R37 联赛用户名修正 · 2026-09-21\n\n固定报名用户名由 Aui 修正为 AuI，按用户最新确认精确匹配。此前大小写错误会遗漏该玩家并阻止赛程生成。修正仅在服务端，不修改玩家账号或存档。\n\n本包支持从 R35、R36 升级，包含 R36 的观众名单、LIVE 角标和赛前积分榜改进。相对 R36 仅一行服务端配置变更。已发布 R35/R36 包未覆盖。最后明确确认部署版本仍为 R35，本包未远程部署。\n\n验证：18 项联赛测试通过；另验证配置包含 AuI、排除 Aui、六名玩家与四支豪门共 10 队、无缺失报名账号。R35 基线安装/回滚，以及 R36 升级/回滚均通过。使用本地合成账号，未访问线上存档；此次不重复 UI 或完整赛季测试。\n\n升级后刷新，尚未生成赛程时会即时显示已匹配球队。服务器在每日 09:50 后按既有调度生成赛程；安装已过开赛时间时会按原逻辑补开已到时间的轮次，不手动重置已有联赛。\n\n## 部署\n\n上传 tar.gz 与同名 .sha256 至 /home/admin，分别执行：\n\n```bash\ncd /home/admin\n```\n\n```bash\nsha256sum -c yellowdogs-hot-update-20260921-r37.tar.gz.sha256\n```\n\n```bash\ntar -xzf yellowdogs-hot-update-20260921-r37.tar.gz\n```\n\n```bash\ncd yellowdogs-hot-update-20260921-r37\n```\n\n```bash\nsudo bash update.sh --check\n```\n\n```bash\nsudo bash update.sh apply\n```\n\n看到 Installed: 20260921-r37 后刷新游戏，无需重装客户端。保留更新器生成的匹配代码和存档备份。\n'
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
r=root/'releases/20260921-r37';r.mkdir()
for file in ['MANIFEST.json','QA.json']:shutil.copy2(bundle/file,r/file)
(r/'ARCHIVE.sha256').write_text(line,encoding='utf-8')
b=read(root/'releases/20260921-r35/BASELINE.json');b.update(version='20260921-r37',parent='20260921-r35',source='Correct AuI username, cumulative R36')
mp={f['path']:f for f in b['files']}
for f in m['files']:mp[f['path']]={'path':f['path'],'sha256':f['sha256']}
b['files']=list(mp.values());write(r/'BASELINE.json',b)
c=read(root/'releases/CURRENT.json');assert c['lastUserConfirmedDeployed']=='20260921-r35'
c.update(latestPublished='20260921-r37',sourceState='R35 deployment user-confirmed; R37 locally verified, deployment unconfirmed')
c['releases'].append({'version':'20260921-r37','parent':'20260921-r35','bundleSha256':sha,'baselineFiles':len(mp),'changedFiles':len(m['files']),'deployment':'not-confirmed'});write(root/'releases/CURRENT.json',c)
archive=root/'handoff/archive/before-r37-handoff-20260921';archive.mkdir()
for file in ['README.md','CURRENT_STATE.md','MANIFEST.md','NEW_CHAT_PROMPT.md','README_UPDATE.md','CHANGED_FILES.txt']:shutil.copy2(root/'handoff'/file,archive/file)
(root/'handoff/DAILY_LEAGUE_R37_20260921.md').write_text(doc,encoding='utf-8')
summary=f'# 当前有效状态 · R37 · 2026-09-21\n\n工作树 D:/Project/game_test/.worktrees/Rougelite，分支 codex/rougelite。大量既有未提交修改须保留，不 reset/clean。不做 SSH、提交或推送，不主动启动子代理。\n\n用户最新更正：联赛用户名必须是 AuI，不能使用 Aui。服务端名单已修正，报名仍按精确匹配；界面显示账号实际球队名。其他五名玩家及四支豪门不变。\n\nR37 最新本地交付，未确认部署。以 R35 为基线并包含 R36，支持从 R35/R36 升级。最后明确确认部署 R35；用户截图有 R36 赛前榜，但未据此擅自写入部署确认。\n\n18 项联赛测试、精确 AuI 十队匹配检查、R35 与 R36 安装回滚通过。本次相对 R36 仅一行服务器配置，未重复浏览器/全量/赛季压测。R36 的 59 项回归及界面证据保留。\n\n包：outputs/hot-update-20260921-r37/{name}.tar.gz\nSHA256：{sha}\n\n部署指令见 DAILY_LEAGUE_R37_20260921.md。每日 09:50 生成/重置、10:00–18:30 开赛逻辑未变。旧联赛规则和 R36 界面说明保留在对应历史文档。\n\n下一步等待用户部署反馈。已交付包不得覆盖重打，后续另起版本。Windows 0.1.4、安卓 v4 只需刷新。\n'
(root/'handoff/CURRENT_STATE.md').write_text(summary,encoding='utf-8')
(root/'handoff/NEW_CHAT_PROMPT.md').write_text(summary+'\n先读当前状态及 R37 说明。默认沙箱 helper 可能失败，必要时使用 require_escalated。真实账号存档和密钥不得发布。\n',encoding='utf-8')
(root/'handoff/README.md').write_text('# Rougelite 交接 · R37\n\nR35 用户确认已部署；R37 本地交付，尚未确认部署。\n\n依次阅读 [当前状态](CURRENT_STATE.md)、[R37 说明](DAILY_LEAGUE_R37_20260921.md)、[发布记录](../releases/CURRENT.json)。用户名已修正为 AuI，支持从 R35/R36 升级。原联赛规则见 [R35](DAILY_LEAGUE_R35_20260921.md)。\n',encoding='utf-8')
p=root/'handoff/MANIFEST.md';p.write_text('# 最新交付 R37\n\n- [R37 电视台与积分榜](DAILY_LEAGUE_R37_20260921.md)\n\n以下历史索引，部署状态以 CURRENT_STATE.md 为准。\n\n'+p.read_text(encoding='utf-8'),encoding='utf-8')
(root/'handoff/README_UPDATE.md').write_text('R35 已确认部署；R37 用户名 AuI 修正（包含 R36）本地交付，未远程部署。旧入口已归档。\n',encoding='utf-8')
(root/'handoff/CHANGED_FILES.txt').write_text('\n'.join(f['path'] for f in m['files'])+'\n',encoding='utf-8')
print(json.dumps({'sha256':sha,'files':len(m['files']),'tests':qa['testsPassed'],'bytes':a.stat().st_size},ensure_ascii=False))
