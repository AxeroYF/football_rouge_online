import json,pathlib,hashlib,tarfile,shutil,re
root=pathlib.Path.cwd();out=root/'outputs/hot-update-20260921-r35';name='yellowdogs-hot-update-20260921-r35';bundle=out/name
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,value):p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
log=(root/'outputs/daily-league-full-tests-final.log').read_text(encoding='utf-8-sig');counts=re.findall(r'^# pass (\d+)',log,re.M)
assert len(counts)==3 and re.findall(r'^# fail (\d+)',log,re.M)==['0','0','0']
target=(root/'outputs/daily-league-service-tests.log').read_text(encoding='utf-8-sig');assert re.findall(r'^# fail (\d+)',target,re.M)==['0']
season=read(root/'outputs/daily-league-review/season-report.json');browser=read(root/'outputs/daily-league-review/browser-report.json');assert browser['passed']
qa=read(out/'incremental-preflight.json');assert qa['passed'];assert read(out/'intermediate-upgrades.json')['passed']
qa.update(testsPassed=sum(map(int,counts)),leagueTests=int(re.findall(r'^# pass (\d+)',target,re.M)[0]),seasonReview=season,browserReview=browser,intermediateUpgrades=read(out/'intermediate-upgrades.json'),remoteDeployed=False,
          limitations=['Local synthetic season, not a production capacity guarantee','Windows service hooks mocked','Initial full run hit Windows TEMP EPERM; isolated final run passed','Initial season audit exposed matchStats mapping; fixed and retested'])
write(bundle/'QA.json',qa)
doc='''# R35 每日联赛与电视台 · 2026-09-21

本地交付，未远程部署。R31基础累积包，包含R32/R33/R34；支持从R31、R32、R33、R34升级，无需重装客户端。

## 玩法

- 六名玩家：皇马、小黄、Aui、ZH、Axero、罗哥；四支豪门：皇马、巴萨、拜仁、曼城，复用豪门挑战阵容，追加〔豪门〕标记。
- 10队双循环，每日18轮90场；每队18场、9主9客。北京时间10:00首轮，每30分钟一轮，18:30末轮开赛。
- 使用每场开赛时留守首发、战术及实际体力，伤停按位置替补；联赛消耗写回双方留守球员。被入侵时防守依然使用满体力副本，不回填真实体力。
- 固定报名名单仅保存在服务端，前端仅展示实际参赛球队；标题栏与通知/服务器玩家统一，精简重复文案。
- 联赛积分榜在服务器玩家左侧展开；电视台在顶部编队右侧，提供直播、我的日程、当日历史战绩。
- 最终榜单与当日战报完赛后保留，次日09:50清理并生成新届；未结算旧届优先恢复，发奖落盘后才能清理。
- 排名奖励：第1–10名金币100000/92000/85000/78000/72000/66000/61000/57000/53000/50000；传奇礼包15/14/13/12/11/10/9/9/8/8。豪门不领奖、不顺延。
- 门票：主场观众=min(容量,球迷总数×50%)，每人0.1金币，再应用现有奇观加成；开赛锁定、完赛到账。开赛前弃权无票房。
- 胜3平1负0；同分比较净胜球、进球数，仍相同按稳定球队ID排序。赛果、票房和排名奖励进入通知栏。

## 性能与验证

最多5场运行对象，按小时间片逐场推进，普通推进最多每30秒请求检查点；开赛、完赛与奖励立即持久化。战报压缩，仅进入具体场次时解压；列表不携带完整比赛。新届替换旧赛程、统计、战报和运行对象，通知最多24条，奖励仅保留最近日期标记。

验证结果及性能数据见同包QA.json。全量、联赛专项、完整赛季、桌面和横屏浏览器检查、R31–R34升级及回滚均为本地隔离验证。没有操作线上账号数据或服务；不承诺线上长期无OOM或无504。

## 部署

上传tar.gz和同名.sha256至/home/admin，每条分别执行：

```bash
cd /home/admin
```

```bash
sha256sum -c yellowdogs-hot-update-20260921-r35.tar.gz.sha256
```

```bash
tar -xzf yellowdogs-hot-update-20260921-r35.tar.gz
```

```bash
cd yellowdogs-hot-update-20260921-r35
```

```bash
sudo bash update.sh --check
```

```bash
sudo bash update.sh apply
```

看到Installed: 20260921-r35后刷新游戏。保留更新器生成的匹配代码与存档备份，回退使用更新器，不手工只换旧代码。首次运行会精确匹配六个登录昵称；账号缺失或未建队时联赛入口仅显示等待球队就绪，不展示缺失账号名单，不擅自选其他玩家。若首次安装已过10:00，会分批补开当日已到时间的轮次。
'''
(bundle/'DEPLOY.md').write_text(doc,encoding='utf-8');(root/'handoff/DAILY_LEAGUE_R35_20260921.md').write_text(doc,encoding='utf-8')
m=read(bundle/'MANIFEST.json')
for item in m['files']:assert hashlib.sha256((root/item['path']).read_bytes()).hexdigest()==item['sha256'],item['path']
(bundle/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(bundle).as_posix()+'\n' for p in sorted(bundle.rglob('*')) if p.is_file() and p.name!='SHA256SUMS'),encoding='utf-8')
a=out/(name+'.tar.gz');assert not a.exists()
with tarfile.open(a,'w:gz') as t:t.add(bundle,arcname=name)
sha=hashlib.sha256(a.read_bytes()).hexdigest();line=sha+'  '+a.name+'\n';pathlib.Path(str(a)+'.sha256').write_text(line,encoding='utf-8')
r=root/'releases/20260921-r35';r.mkdir()
for file in ['MANIFEST.json','QA.json']:shutil.copy2(bundle/file,r/file)
(r/'ARCHIVE.sha256').write_text(line,encoding='utf-8')
b=read(root/'releases/20260920-r31/BASELINE.json');b.update(version='20260921-r35',parent='20260920-r31',source='Daily league and television; cumulative R32-R34');mp={f['path']:f for f in b['files']}
for f in m['files']:mp[f['path']]={'path':f['path'],'sha256':f['sha256']}
b['files']=list(mp.values());write(r/'BASELINE.json',b)
c=read(root/'releases/CURRENT.json');c.update(latestPublished='20260921-r35',sourceState='R31 last confirmed; R35 daily league locally verified, deployment unconfirmed');c['releases'].append({'version':'20260921-r35','parent':'20260920-r31','bundleSha256':sha,'baselineFiles':len(mp),'changedFiles':len(m['files']),'deployment':'not-confirmed'});write(root/'releases/CURRENT.json',c)
archive=root/'handoff/archive/before-r35-handoff-20260921';archive.mkdir()
for file in ['README.md','CURRENT_STATE.md','MANIFEST.md','NEW_CHAT_PROMPT.md','README_UPDATE.md','CHANGED_FILES.txt']:shutil.copy2(root/'handoff'/file,archive/file)
summary=f'''# 当前有效状态 · R35 · 2026-09-21

工作树D:/Project/game_test/.worktrees/Rougelite，分支codex/rougelite。大量既有未提交修改，不得reset/clean或覆盖。用户自行部署，无SSH、提交、推送或PR。

最新交付R35 / 20260921-r35，本地验证，未确认部署；最后确认线上R31。R35包含R32重复保存修复、R33卡片特性、R34战术板优化及每日联赛。不要把旧规划的9队或16轮作为最终规则。

六名玩家加四支豪门，共10队18轮90场。每天10:00–18:30开赛；完赛保留结果，次日09:50清理重置。详细规则、奖励与逐条部署指令见[每日联赛R35](DAILY_LEAGUE_R35_20260921.md)。

包：outputs/hot-update-20260921-r35/{name}.tar.gz；SHA256：{sha}。支持R31/R32/R33/R34，无需重装客户端，已交付包不可覆盖重打。

验证：全量{qa['testsPassed']}项、联赛专项{qa['leagueTests']}项、完整90场赛季流程、浏览器积分/赛程/直播/关闭轮询及横屏、安装与回滚。完整赛季模拟使用合成账号，实际模拟{season['realMatches']}场、按规则开赛前弃权{season['forfeits']}场。检查点/评分另有最终专项回归。首次全量TEMP EPERM隔离重跑通过；首次赛季发现个人matchStats字段映射错误，已修复并重测。不可宣称线上长期无OOM或所有504解决。

下一步等待用户部署反馈，确认六名登录昵称匹配和10:00开赛。若仍卡顿，按保存频率/事件循环/RSS/本机healthz分辨原因；不直接放宽超时和内存上限。Windows0.1.4、安卓v4/0.3.0继续使用，不自行恢复其他移动端开发。

此前R34详细背景见archive/before-r35-handoff-20260921/CURRENT_STATE.md。历史专题仅反映成文时状态。无必要不重复全量测试或重打包。
'''
(root/'handoff/CURRENT_STATE.md').write_text(summary,encoding='utf-8')
(root/'handoff/README.md').write_text('# Rougelite 对话交接 · R35\n\n最新交付R35每日联赛与电视台；部署未确认，最后确认线上R31。\n\n依次阅读[当前状态](CURRENT_STATE.md)、[R35规则与部署](DAILY_LEAGUE_R35_20260921.md)、[发布记录](../releases/CURRENT.json)。历史入口保存在archive/before-r35-handoff-20260921/。\n',encoding='utf-8')
(root/'handoff/NEW_CHAT_PROMPT.md').write_text(summary+'\n只使用必要本地工具，不主动启动子代理。默认沙箱helper可能失败，必要时走require_escalated流程。服务器命令每条独立bash代码块。真实账号、存档和密钥不得发布。\n',encoding='utf-8')
p=root/'handoff/MANIFEST.md';p.write_text('# 最新交付 · R35\n\n- [每日联赛与电视台R35](DAILY_LEAGUE_R35_20260921.md)\n- [实施规则记录](DAILY_LEAGUE_DESIGN_20260921.md)\n\n以下是历史专题索引，版本状态以CURRENT_STATE.md为准。\n\n'+p.read_text(encoding='utf-8'),encoding='utf-8')
(root/'handoff/README_UPDATE.md').write_text('R35每日联赛交付完成，本地验证打包，未部署、未提交推送。旧入口已归档。完整规则、证据、限制和部署命令见DAILY_LEAGUE_R35_20260921.md。\n',encoding='utf-8')
(root/'handoff/CHANGED_FILES.txt').write_text('\n'.join(f['path'] for f in m['files'])+'\n',encoding='utf-8')
p=root/'handoff/DAILY_LEAGUE_DESIGN_20260921.md';s=p.read_text(encoding='utf-8');s=s.replace('状态：本地实施中，未打包、未部署。当前发布仍为R34，最后确认部署R31。','状态：已完成本地实施和R35打包，未部署。最终交付与验证以DAILY_LEAGUE_R35_20260921.md及CURRENT_STATE.md为准。');p.write_text(s,encoding='utf-8')
with tarfile.open(a) as t:
 for ln in t.extractfile(name+'/SHA256SUMS').read().decode().splitlines():
  h,p=ln.split('  ',1);assert hashlib.sha256(t.extractfile(name+'/'+p).read()).hexdigest()==h
print(json.dumps({'sha256':sha,'files':len(m['files']),'tests':qa['testsPassed'],'leagueTests':qa['leagueTests']},ensure_ascii=False))
