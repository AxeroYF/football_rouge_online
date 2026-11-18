import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createEngineBundle} from '../versus/v4-rollout/bundle.js';
import {dependencyHashes} from './v4-source-hashes.mjs';
const acceptedPath='outputs/v4-real-teams-20261117/local-acceptance.json';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const accepted=read(acceptedPath);assert.equal(accepted.passed,true);assert.equal(accepted.productionEnabled,false);
const directory='outputs/v4-accepted-local-20261118';assert.ok(!fs.existsSync(directory),'Refuse replacing an accepted source archive');
const sourceFiles={},evidence={...accepted.proofFiles,[acceptedPath]:hash(acceptedPath)};
for(const [file,expected] of Object.entries(accepted.proofFiles)){
  assert.equal(hash(file),expected,file);const report=read(file);
  Object.assign(sourceFiles,report.dependencyHashes??{});
  for(const [name,value] of Object.entries(report.sourceHashes??{}))sourceFiles[`versus/v4/${name}`]=value;
}
Object.assign(sourceFiles,dependencyHashes(['scripts/record-v4-local-handoff.mjs','scripts/verify-v4-local-acceptance.mjs']));
const suite=read('outputs/v4-real-teams-20261117/local-suite-verification.json'),runnerDirectory=path.dirname(suite.runnerReport);
for(const name of fs.readdirSync(runnerDirectory)){const file=path.join(runnerDirectory,name);if(fs.statSync(file).isFile())evidence[path.relative(process.cwd(),file).replaceAll('\\','/')]=hash(file);}
for(const [file,expected] of Object.entries(sourceFiles))assert.equal(hash(file),expected,file);
fs.mkdirSync(directory);
const engine=await createEngineBundle(path.join(directory,'engine'),{sourceRoot:process.cwd(),engineVersion:accepted.version,files:dependencyHashes(['versus/v4/engine.js'])});
assert.equal(engine.sourceDigest,accepted.engineSourceDigest);
for(const [kind,files] of [['source',sourceFiles],['evidence',evidence]])for(const [file,expected] of Object.entries(files)){
  const target=path.resolve(directory,kind,file),relative=path.relative(path.resolve(directory,kind),target);assert.ok(!relative.startsWith('..')&&!path.isAbsolute(relative));
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target);assert.equal(hash(target),expected);
}
const manifest={version:accepted.version,scope:'Accepted local source and evidence; not production deployment',engineSourceDigest:engine.sourceDigest,sourceFiles,evidence};
fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2));
const note='34-V4-LOCAL-ACCEPTANCE-20261118.txt';
fs.writeFileSync(path.join('handoff',note),`V4 本地联合验收 · 2026-11-18\n\n已验收：${accepted.version}，候选14；正式V3.3、预测V1/24样本及真实存档保持不变。\n\n验收入口：${acceptedPath}\n源码与证据冻结：${directory}/manifest.json\n锁定引擎包：${directory}/engine，完整依赖指纹 ${engine.sourceDigest}\n\n136项V4测试、16项旧引擎、48矩阵、22场景、真实90/120分钟、核心演示页及真实/合成流式桌面/手机验证通过。\n真实训练240/留出480完整比赛，合成训练256/留出512完整比赛；两类各128训练/256留出短片段，全部统计门槛通过。\n真实留出：2.7646球/场、传球75.2855%、接球失误7.4715%、六球以上10.2083%。合成留出：1.9570球/场、传球81.3156%、零进球20.8984%、六球以上4.4922%。\n公平性256场主队胜负份额49.0234%，16组名称替换后物理状态逐项一致。96场战术单因素方向通过，预设无极端失衡警报。\n733球员、19特性与正式加载器隔离副本一致；当前真实球队不支持的天气/特性会明确阻断，不假装覆盖。\n影子赛季14轮112场、395次赛前轮换选人；积分/进球守恒，原始快照及存档不变。点球大战678次主罚命中74.1888%。\n\n流式录制有界缓冲、分视角压缩、服务端发布边界、回看/慢放/追赶/重连、身份裁剪已通过。\nWindows原子替换临时冲突有限重试；归档读取顺序化；恢复使用经过哈希验证的冻结引擎包与锁定输入，重演并核对已提交前缀，拒绝冲突且不覆盖历史。\n本地容量：2逻辑核、2GiB Job Object、10名观看者、2生产者、4场比赛，120秒全部完成；索引P95 67.54ms、片段P95 83.14ms、峰值RSS 269021184字节；所有门槛通过。此前60秒失败报告保留。不能外推为香港云主机验收。\n隔离结算已覆盖版本锁定、检查点一致、回退后新比赛使用旧引擎、幂等回执，以及提交前/后强制终止进程后恢复不重不漏。\n\n持续任务仍active：继续补齐默认关闭的宿主接入、球员级战报兼容与隔离正式结算回归。当前resultEnvelope仍settlementAllowed:false，正式联赛不能消费影子赛果。\n用户明确先本地、暂不连接云主机；云端验证与实际上线留待后续。无主动换人；未补手球/有利原则，不宣称完整足球规则实现。\n\n历史过程与未通过报告见33，禁止把旧候选报告当作当前版本证据。\n`);
const latest=read('handoff/LATEST.json');latest.updatedAt=new Date().toISOString();latest.previousV4Acceptance={version:latest.v4Prototype.version,acceptance:latest.v4Prototype.acceptance};
latest.v4Prototype={version:accepted.version,standalone:true,productionEngineReplaced:false,syntheticOnly:false,sourceScope:'Synthetic lab or read-only real roster snapshots; formal settlement disabled',command:'npm run dev:v4-stream',url:'http://127.0.0.1:4315',coreTestsPassed:136,legacyRegressionTestsPassed:16,tacticalScenarioRuns:48,specializedScenariosPassed:22,acceptance:acceptedPath,sourceArchive:`${directory}/manifest.json`,engineSourceDigest:engine.sourceDigest,calibration:accepted.calibration,cloudVerified:false};
latest.latestImplementation=note;if(!latest.currentDocuments.includes(note))latest.currentDocuments.push(note);
Object.assign(latest.v4ContinuousDevelopment,{status:'active',lastAcceptedVersion:accepted.version,workingStage:'Local V4.8–V4.11 isolated acceptance passed; next default-off host wiring, player-level report compatibility and isolated canonical settlement verification',workingNotes:note,productionChanged:false});
fs.writeFileSync('handoff/LATEST.json',JSON.stringify(latest,null,2)+'\n');
console.log(JSON.stringify({accepted:accepted.version,directory,sourceFiles:Object.keys(sourceFiles).length,evidenceFiles:Object.keys(evidence).length,handoff:note,productionEnabled:false}));
