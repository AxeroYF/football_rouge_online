// Read raw save only. Never start CampaignService or mutate the data file.
import fs from 'node:fs';
const file=process.argv[2];if(!file)throw Error('用法：node report-downtime-recovery.mjs /var/lib/yellowdogs-rougelite/campaign-accounts.json');
const saved=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const id='downtime-20260914-20260918-half-v1',record=saved.world?.economyRecoveries?.[id];
if(!record){console.error('没有找到R10自动扣除完成记录，请检查服务日志。');process.exitCode=1;}
else{console.log('R10自动扣除已完成：'+new Date(record.appliedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}));
 console.log('玩家 | 实扣金币 | 实扣石油 | 实扣球迷');for(const r of record.players)console.log(`${r.teamName} | ${r.deducted.gold} | ${r.deducted.oil} | ${r.deducted.fans}`);
 console.log('合计：'+JSON.stringify(record.totals));if(record.missingAccountIds?.length)console.log('未找到的历史账号：'+record.missingAccountIds.join('，'));
 const waived=record.players.filter(r=>Object.values(r.waived??{}).some(v=>v>0));if(waived.length)console.log('余额不足已扣至0、不再追扣：'+waived.map(r=>r.teamName).join('，'));
}
