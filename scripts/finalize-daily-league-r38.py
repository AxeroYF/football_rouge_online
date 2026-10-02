import pathlib,json,hashlib,tarfile,shutil,re
root=pathlib.Path(__file__).resolve().parent.parent
out=root/'outputs/hot-update-20260921-r38';name='yellowdogs-hot-update-20260921-r38';bundle=out/name
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
qa=read(out/'incremental-preflight.json');assert qa['passed']
log=(root/'outputs/daily-league-r38-tests.log').read_text(encoding='utf-8-sig');assert re.findall(r'^# fail (\d+)',log,re.M)==['0']
browser=read(root/'outputs/daily-league-r38-review/browser-report.json');assert browser['passed']
qa.update(testsPassed=int(re.search(r'^# pass (\d+)',log,re.M)[1]),browserReview=browser,remoteDeployed=False)
write(bundle/'QA.json',qa)
doc='# R38 联赛 AI 标志 · 2026-09-21\n\n用户确认 R37 已部署。本包基于 R37，尚未远程部署。\n\n联赛积分榜、赛程、个人榜球队名及直播主要球队标签使用 AI 徽标，不再显示〔豪门〕文字。通知和纯文本字段使用 [AI]。前端兼容已有赛事名称，不修改联赛存档、不重置赛程。\n\n22 项相关回归及桌面/手机浏览器检查通过，四支 AI 球队标志正常；增量安装与回滚检查通过。\n\n## 一行部署\n\n将 tar.gz 和同名 .sha256 上传到 /home/admin 后执行：\n\n```bash\ncd /home/admin && sha256sum -c yellowdogs-hot-update-20260921-r38.tar.gz.sha256 && tar -xzf yellowdogs-hot-update-20260921-r38.tar.gz && cd yellowdogs-hot-update-20260921-r38 && sudo bash update.sh --check && sudo bash update.sh apply\n```\n\n成功后刷新游戏，无需重装客户端。命令通过 && 串联，校验或预检查失败即停止。保留更新器生成的匹配代码和存档备份。\n'
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
r=root/'releases/20260921-r38';r.mkdir()
for file in ['MANIFEST.json','QA.json']:shutil.copy2(bundle/file,r/file)
(r/'ARCHIVE.sha256').write_text(line,encoding='utf-8')
b=read(root/'releases/20260921-r37/BASELINE.json');b.update(version='20260921-r38',parent='20260921-r37',source='League AI badges')
mp={f['path']:f for f in b['files']}
for f in m['files']:mp[f['path']]={'path':f['path'],'sha256':f['sha256']}
b['files']=list(mp.values());write(r/'BASELINE.json',b)
c=read(root/'releases/CURRENT.json');assert c['lastUserConfirmedDeployed']=='20260921-r37'
c.update(latestPublished='20260921-r38',sourceState='R37 deployment user-confirmed; R38 locally verified, deployment unconfirmed')
c['releases'].append({'version':'20260921-r38','parent':'20260921-r37','bundleSha256':sha,'baselineFiles':len(mp),'changedFiles':len(m['files']),'deployment':'not-confirmed'});write(root/'releases/CURRENT.json',c)
archive=root/'handoff/archive/before-r38-handoff-20260921';archive.mkdir()
for file in ['README.md','CURRENT_STATE.md','MANIFEST.md','NEW_CHAT_PROMPT.md','README_UPDATE.md','CHANGED_FILES.txt']:shutil.copy2(root/'handoff'/file,archive/file)
(root/'handoff/DAILY_LEAGUE_R38_20260921.md').write_text(doc,encoding='utf-8')
summary=f'# 当前有效状态 · R38 · 2026-09-21\n\n工作树 D:/Project/game_test/.worktrees/Rougelite，分支 codex/rougelite。保留大量既有未提交修改，不 reset/clean，不主动启动子代理，不 SSH/提交/推送。\n\n用户确认 R37 已部署；最新本地交付 R38，尚未确认部署。联赛 AuI 用户名正确。R38 将〔豪门〕改为 AI 徽标，兼容已有赛事，不修改存档。\n\n用户最新要求：部署说明使用一行式命令（&& 连接校验、解压、预检、安装），不再使用旧的逐条命令要求。\n\n22 项相关测试及浏览器检查、R37→R38 安装回滚通过；无线上压测。详情见 DAILY_LEAGUE_R38_20260921.md。\n\n包：outputs/hot-update-20260921-r38/{name}.tar.gz\nSHA256：{sha}\n\n等待用户部署反馈；已交付包不覆盖重打。此前联赛规则保留，10 队、每日 09:50 重置、10:00–18:30 开赛。\n'
(root/'handoff/CURRENT_STATE.md').write_text(summary,encoding='utf-8')
(root/'handoff/NEW_CHAT_PROMPT.md').write_text(summary+'\n先读当前状态及 R38 说明。默认沙箱 helper 可能失败，必要时使用 require_escalated。真实账号存档和密钥不得发布。\n',encoding='utf-8')
(root/'handoff/README.md').write_text('# Rougelite 交接 · R38\n\nR37 用户确认已部署；R38 本地交付，尚未确认部署。\n\n依次阅读 [当前状态](CURRENT_STATE.md)、[R38 说明](DAILY_LEAGUE_R38_20260921.md)、[发布记录](../releases/CURRENT.json)。原联赛规则见 [R37](DAILY_LEAGUE_R37_20260921.md)。\n',encoding='utf-8')
p=root/'handoff/MANIFEST.md';p.write_text('# 最新交付 R38\n\n- [R38 AI 标志](DAILY_LEAGUE_R38_20260921.md)\n\n以下历史索引，部署状态以 CURRENT_STATE.md 为准。\n\n'+p.read_text(encoding='utf-8'),encoding='utf-8')
(root/'handoff/README_UPDATE.md').write_text('R37 已确认部署；R38 AI 标志及一行部署说明本地交付，未远程部署。旧入口已归档。\n',encoding='utf-8')
(root/'handoff/CHANGED_FILES.txt').write_text('\n'.join(f['path'] for f in m['files'])+'\n',encoding='utf-8')
print(json.dumps({'sha256':sha,'files':len(m['files']),'tests':qa['testsPassed'],'bytes':a.stat().st_size},ensure_ascii=False))
