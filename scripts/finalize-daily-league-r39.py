import pathlib,json,hashlib,tarfile,shutil,re
root=pathlib.Path(__file__).resolve().parent.parent
out=root/'outputs/hot-update-20260921-r39';name='yellowdogs-hot-update-20260921-r39';bundle=out/name
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
qa=read(out/'incremental-preflight.json');assert qa['passed']
log=(root/'outputs/daily-league-r39-tests.log').read_text(encoding='utf-8-sig');assert re.findall(r'^# fail (\d+)',log,re.M)==['0']
assert read(out/'intermediate-upgrades.json')['passed']
qa.update(testsPassed=int(re.search(r'^# pass (\d+)',log,re.M)[1]),intermediateUpgrades=read(out/'intermediate-upgrades.json'),remoteDeployed=False)
write(bundle/'QA.json',qa)
doc='# R39 联赛主场门票修复 · 2026-09-21\n\n根因：联赛票房只查总部地块的 main-stadium，而正式比赛场地从全部己方领地查找已启用球场。用户确认 AuI 的体育场和总部不在同一地块，匹配该缺陷。\n\n修复：直接使用 sponsorMatchVenue 返回的 seatingCapacity，保证票房和实际比赛场地一致；保持 50% 球迷需求、容量上限、0.1 金币单价及伯纳乌加成。总部失守后不再误用敌方球场。升级中的已启用球场仍按当前已完成等级计算。\n\n效果从更新后新开赛的比赛生效。已经开赛的票房在开赛时锁定，已结算比赛不自动补发：旧数据未保存准确的开赛球迷数，不能用当前值反推欠款。若需补偿须另核对历史数据。不会重置当前联赛、比分或奖励。\n\n验证：两个回归场景修复前均失败，修复后通过；联赛、赞助和奇观共 71 项测试通过。模拟总部外球场、10000 球迷，正确得到 5000 观众和 500 金币。R37、R38 安装与回滚通过。未操作线上账号或存档。\n\n本包以 R37 为基线，包含 R38 AI 标志，支持 R37/R38 升级；无需更新 Windows 客户端。0.1.5 客户端启动修复为此前独立交付，详情见 WINDOWS_CLIENT_015_STARTUP_FIX_20260921.md。\n\n## 一行部署\n\n上传 tar.gz 与同名 .sha256 至 /home/admin 后执行：\n\n```bash\ncd /home/admin && sha256sum -c yellowdogs-hot-update-20260921-r39.tar.gz.sha256 && tar -xzf yellowdogs-hot-update-20260921-r39.tar.gz && cd yellowdogs-hot-update-20260921-r39 && sudo bash update.sh --check && sudo bash update.sh apply\n```\n\n看到 Installed: 20260921-r39 后刷新游戏。保留更新器生成的代码/存档匹配备份。\n'
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
r=root/'releases/20260921-r39';r.mkdir()
for file in ['MANIFEST.json','QA.json']:shutil.copy2(bundle/file,r/file)
(r/'ARCHIVE.sha256').write_text(line,encoding='utf-8')
b=read(root/'releases/20260921-r37/BASELINE.json');b.update(version='20260921-r39',parent='20260921-r37',source='League ticket venue fix; cumulative R38')
mp={f['path']:f for f in b['files']}
for f in m['files']:mp[f['path']]={'path':f['path'],'sha256':f['sha256']}
b['files']=list(mp.values());write(r/'BASELINE.json',b)
c=read(root/'releases/CURRENT.json');assert c['lastUserConfirmedDeployed']=='20260921-r37'
c.update(latestPublished='20260921-r39',sourceState='R37 deployment user-confirmed; R39 locally verified, deployment unconfirmed')
c['releases'].append({'version':'20260921-r39','parent':'20260921-r37','bundleSha256':sha,'baselineFiles':len(mp),'changedFiles':len(m['files']),'deployment':'not-confirmed'});write(root/'releases/CURRENT.json',c)
archive=root/'handoff/archive/before-r39-handoff-20260921';archive.mkdir()
for file in ['README.md','CURRENT_STATE.md','MANIFEST.md','NEW_CHAT_PROMPT.md','README_UPDATE.md','CHANGED_FILES.txt']:shutil.copy2(root/'handoff'/file,archive/file)
(root/'handoff/DAILY_LEAGUE_R39_20260921.md').write_text(doc,encoding='utf-8')
summary=f'# 当前有效状态 · R39 · 2026-09-21\n\n工作树 D:/Project/game_test/.worktrees/Rougelite，分支 codex/rougelite。保留既有未提交修改，不 reset/clean、不 SSH/提交/推送，不主动启动子代理。\n\n最后明确确认部署 R37，R39 最新本地交付未确认部署；基于 R37，包含 R38 AI 徽标，支持 R37/R38 升级。\n\n用户确认 AuI 体育场在总部以外地块。联赛旧票房只查总部导致容量为零，已改用实际比赛场地容量。71 项联赛/赞助/奇观回归通过，新增两场景修复前失败、修复后通过。安装回滚演练通过。\n\n修复更新后新开赛票房；已开赛保留锁定值，已结算不擅自补发（缺少历史开赛球迷数）。无需重置联赛。具体说明和一行部署命令见 DAILY_LEAGUE_R39_20260921.md。\n\n包：outputs/hot-update-20260921-r39/{name}.tar.gz\nSHA256：{sha}\n\nWindows 0.1.5 已独立交付但未确认安装，修复第三方统计脚本阻塞启动；不清缓存，详见 WINDOWS_CLIENT_015_STARTUP_FIX_20260921.md。本次无需重装客户端。\n\n用户要求部署命令必须一行 && 串联。等待用户部署反馈，不覆盖已交付包。\n'
(root/'handoff/CURRENT_STATE.md').write_text(summary,encoding='utf-8')
(root/'handoff/NEW_CHAT_PROMPT.md').write_text(summary+'\n先读当前状态及 R39 说明。默认沙箱 helper 可能失败，必要时使用 require_escalated。真实账号存档和密钥不得发布。\n',encoding='utf-8')
(root/'handoff/README.md').write_text('# Rougelite 交接 · R39\n\nR37 用户确认已部署；R39 本地交付，尚未确认部署。\n\n依次阅读 [当前状态](CURRENT_STATE.md)、[R39 说明](DAILY_LEAGUE_R39_20260921.md)、[发布记录](../releases/CURRENT.json)。原联赛规则见 [R37](DAILY_LEAGUE_R37_20260921.md)。\n',encoding='utf-8')
p=root/'handoff/MANIFEST.md';p.write_text('# 最新交付 R39\n\n- [R39 主场门票修复](DAILY_LEAGUE_R39_20260921.md)\n\n以下历史索引，部署状态以 CURRENT_STATE.md 为准。\n\n'+p.read_text(encoding='utf-8'),encoding='utf-8')
(root/'handoff/README_UPDATE.md').write_text('R37 已确认部署；R39 主场门票修复及一行部署说明本地交付，未远程部署。旧入口已归档。\n',encoding='utf-8')
(root/'handoff/CHANGED_FILES.txt').write_text('\n'.join(f['path'] for f in m['files'])+'\n',encoding='utf-8')
print(json.dumps({'sha256':sha,'files':len(m['files']),'tests':qa['testsPassed'],'bytes':a.stat().st_size},ensure_ascii=False))
