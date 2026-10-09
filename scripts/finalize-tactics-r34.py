import json,pathlib,hashlib,tarfile,shutil,re
root=pathlib.Path.cwd();out=root/'outputs/hot-update-20260921-r34';name='yellowdogs-hot-update-20260921-r34';bundle=out/name
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
log=(root/'outputs/r34-full-tests.log').read_text(encoding='utf-8-sig');counts=re.findall(r'^# pass (\d+)',log,re.M);assert len(counts)==3 and re.findall(r'^# fail (\d+)',log,re.M)==['0','0','0']
qa=read(out/'incremental-preflight.json');qa.update(tacticsReview=read(root/'outputs/tactics-performance-r34/report.json'),tacticsTests=41,testsPassed=sum(map(int,counts)),cardTests=11,visualSizes=[280,180,110],includesR32=True)
write(bundle/'QA.json',qa)
doc="# R34 战术板打开和自动保存优化\n\n2026-09-21。基于 R31 的累积包，包含 R32 重复全服保存修复、R33 球员卡特性显示。仅本地验证，未部署。无需重装客户端。\n\n## 定位及改动\n\n- 打开普通战术板原先也等待同盟联军接口；现在只在进入对应联军阵容时请求。显式打开留守编队也正确进入该编队。\n- 原来每次查询首发都会逐个球员重新扫描全仓库筛选代表卡，阵型分析又反复调用。现在首发一次索引，单次同步渲染内复用编队与三套阵型分析，渲染结束立即释放缓存，避免跨编辑保留过期阵容。\n- 体力刷新改用体力专用计算和球员索引，避免每名球员刷新时都做完整属性展示计算。\n- 个人、同盟联军和活动联军战术保存支持显式轻量响应。个人返回规范化战术及编队，联军返回对应战术视图和摘要；客户端合并到最新状态，保留地图对象引用。旧客户端继续收到完整 state。\n- 保持保存请求串行；保存期间继续编辑时，合并发送最新版本，不再额外标脏并等待一轮 650ms。保留正常输入防抖。重绘时正确保留正在保存/待保存提示。\n- 服务端仍执行原有校验和持久化，写盘失败恢复原战术及分组。未将保存成功提前到实际落盘之前，也没有全面取消全量同步存档。\n\n## 验证和限制\n\n- 全量测试 83 + 1157 + 161 = 1401 项通过；专项战术、API、阵容修复、研究导入 41 项通过。\n- 浏览器使用 2000 条重复持卡的合成仓库，给联军接口注入 1.2 秒延迟：旧版打开约 1338ms，新版约 87ms，普通阵容联军请求由 1 次降为 0。这是受控本地对照，不代表线上硬件实测。\n- 每次保存注入 900ms 延迟，先修改 66、保存中再改 67；最多一个请求在途，最终持久化为 67，两次响应均保留世界对象。\n- 真实已组建同盟联军打开及自动保存成功，世界对象未替换。三类轻量保存接口有认证上下文测试，个人保存失败回滚及旧返回接口兼容通过。\n- 旧的联军综合浏览器脚本因借调定位器过期，在战术板之前超时；以直接建立真实联军后进入战术板的验证补足本次范围，不声称旧脚本整套通过。\n- 证据：outputs/r34-full-tests.log、r34-targeted-tests.log、outputs/tactics-performance-r34/report.json 和 board.png。\n\n## 部署\n\n将包及校验文件上传至 /home/admin，分别执行：\n\n```bash\ncd /home/admin\n```\n\n```bash\nsha256sum -c yellowdogs-hot-update-20260921-r34.tar.gz.sha256\n```\n\n```bash\ntar -xzf yellowdogs-hot-update-20260921-r34.tar.gz\n```\n\n```bash\ncd yellowdogs-hot-update-20260921-r34\n```\n\n```bash\nsudo bash update.sh --check\n```\n\n```bash\nsudo bash update.sh apply\n```\n\n看到 Installed: 20260921-r34 后刷新游戏或重新打开客户端。安装器包含 R31 的低内存检查修复，保留配套代码和存档备份，健康失败自动回滚。不要手工只换旧代码回退。\n\n安装后可贴回以下日志，继续确认线上保存频率和主线程负载：\n\n```bash\nsudo journalctl -u yellowdogs-rougelite --since '5 minutes ago' --no-pager | grep -E 'campaign-runtime|campaign-memory|campaign-stall'\n```\n"
(root/'handoff/TACTICS_R34_20260921.md').write_text(doc,encoding='utf-8');(bundle/'DEPLOY.md').write_text(doc,encoding='utf-8')
m=read(bundle/'MANIFEST.json')
for f in m['files']:assert hashlib.sha256((root/f['path']).read_bytes()).hexdigest()==f['sha256']
(bundle/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(bundle).as_posix()+'\n' for p in sorted(bundle.rglob('*')) if p.is_file() and p.name!='SHA256SUMS'),encoding='utf-8')
a=out/(name+'.tar.gz')
with tarfile.open(a,'w:gz') as t:t.add(bundle,arcname=name)
sha=hashlib.sha256(a.read_bytes()).hexdigest();line=sha+'  '+a.name+'\n';pathlib.Path(str(a)+'.sha256').write_text(line,encoding='utf-8')
r=root/'releases/20260921-r34';r.mkdir()
for f in ['MANIFEST.json','QA.json']:shutil.copy2(bundle/f,r/f)
(r/'ARCHIVE.sha256').write_text(line,encoding='utf-8')
b=read(root/'releases/20260920-r31/BASELINE.json');b.update(version='20260921-r34',parent='20260920-r31',source='Cumulative R32/R33 and R34 tactics performance');mp={f['path']:f for f in b['files']}
for f in m['files']:mp[f['path']]={'path':f['path'],'sha256':f['sha256']}
b['files']=list(mp.values());write(r/'BASELINE.json',b)
c=read(root/'releases/CURRENT.json');c.update(latestPublished='20260921-r34',sourceState='R31 confirmed; R34 tactics plus R32/R33 cumulative fixes locally verified, deployment unconfirmed');c['releases'].append({'version':'20260921-r34','parent':'20260920-r31','bundleSha256':sha,'baselineFiles':len(mp),'changedFiles':len(m['files']),'deployment':'not-confirmed'});write(root/'releases/CURRENT.json',c)
for f in ['README.md','CURRENT_STATE.md','MANIFEST.md','NEW_CHAT_PROMPT.md']:
 p=root/'handoff'/f;p.write_text('> 最新：R34 战术板打开、渲染与自动保存优化，包含 R32/R33，基于 R31 的累积包。本地验证通过，未部署。见 [R34 说明](TACTICS_R34_20260921.md)。\n\n'+p.read_text(encoding='utf-8-sig'),encoding='utf-8')
with tarfile.open(a) as t:
 for ln in t.extractfile(name+'/SHA256SUMS').read().decode().splitlines():
  h,p=ln.split('  ',1);assert hashlib.sha256(t.extractfile(name+'/'+p).read()).hexdigest()==h
print(json.dumps({'sha256':sha,'files':len(m['files']),'tests':qa['testsPassed']}))
