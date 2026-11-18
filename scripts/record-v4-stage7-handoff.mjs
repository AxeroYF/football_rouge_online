import fs from 'node:fs';
import path from 'node:path';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const evidence=read('outputs/v4-capabilities-20261117/acceptance.json');if(!evidence.passed)throw new Error('Missing acceptance');
const file='handoff/LATEST.json',latest=read(file),doc='32-V4-CAPABILITIES-20261117.txt',root='outputs/v4-capabilities-20261117';
latest.updatedAt=new Date().toISOString();latest.latestImplementation=doc;if(!latest.currentDocuments.includes(doc))latest.currentDocuments.push(doc);
Object.assign(latest.v4Prototype,{version:evidence.version,coreTestsPassed:97,legacyRegressionTestsPassed:16,specializedScenariosPassed:22,
  browserVerification:`${root}/verification.json`,preservationVerification:`${root}/preservation.json`,acceptance:`${root}/acceptance.json`,
  calibration:{trainingRunsPerDuration:128,independentValidationRunsPerDuration:256,durationsSeconds:[600,5400],engineeringGatesPassed:true,realLeagueFit:false,validation90:evidence.calibration.validation5400.summary}});
latest.v4ContinuousDevelopment.workingStage='V4.8 real-team adapters; V4.5–V4.7 accepted; V4.9 read-only protocol foundation implemented';
latest.v4ContinuousDevelopment.lastAcceptedVersion=evidence.version;
latest.pending=latest.pending.filter(s=>!s.startsWith('V4 two halves'));latest.pending.push('V4 real-player behavior mapping, real-team calibration, live publication service, shadow seasons, cloud capacity and controlled rollout remain in progress');
fs.writeFileSync(file,JSON.stringify(latest,null,2)+'\n');
const banner='最新进度（2026-11-17，V4.7已验收）\n详见32-V4-CAPABILITIES-20261117.txt；prototype.7通过97项V4、16项旧引擎、22场景、各时长128训练+256独立留出及八项哈希保护。用户持续开发目标active，当前继续V4.8只读真实球队映射。以下旧进度仅作历史记录。\n\n';
for(const name of ['00-START-HERE.txt','01-PROJECT-HANDOFF.txt','02-NEXT-CHAT-PROMPT.txt','03-VERIFICATION.txt','04-FILE-MAP.txt','30-V4-CONTINUOUS-ROADMAP-20261117.txt']){
  const target=path.join('handoff',name),old=fs.readFileSync(target,'utf8');if(!old.startsWith(banner))fs.writeFileSync(target,banner+old);
}
const backup='outputs/v4-before-stage8-20261117';if(fs.existsSync(backup))throw new Error('Stage 8 backup already exists; do not overwrite');
fs.mkdirSync(path.join(backup,'test'),{recursive:true});fs.cpSync('versus/v4',path.join(backup,'v4'),{recursive:true});fs.cpSync('versus/v4-stream',path.join(backup,'v4-stream'),{recursive:true});
for(const name of fs.readdirSync('test').filter(f=>/^engine-v4.*\.test\.js$/.test(f)))fs.copyFileSync(path.join('test',name),path.join(backup,'test',name));
fs.copyFileSync(path.join(root,'acceptance.json'),path.join(backup,'accepted-stage7.json'));fs.copyFileSync('outputs/v4-before-stage5-20261117/protected-hashes.json',path.join(backup,'protected-hashes.json'));
console.log(JSON.stringify({version:evidence.version,handoff:doc,backup}));
