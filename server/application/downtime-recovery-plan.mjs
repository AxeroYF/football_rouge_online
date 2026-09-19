// Deployment-specific account IDs and deductions belong in private runtime data.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const DOWNTIME_RECOVERY_PLAN_ID = 'downtime-20260914-20260918-half-v1';
export function readDowntimeRecoveryPlan(file, {optional = false} = {}) {
  if (optional && !fs.existsSync(file)) return {planId:DOWNTIME_RECOVERY_PLAN_ID,players:[],totals:{gold:0,oil:0,fans:0}};
  const plan=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  if(plan.planId!==DOWNTIME_RECOVERY_PLAN_ID||!Array.isArray(plan.players))throw Error('Invalid private downtime recovery plan');
  const ids=new Set();
  for(const row of plan.players){
    if(typeof row.accountId!=='string'||!row.accountId||ids.has(row.accountId)||!['gold','oil','fans'].every(k=>Number.isSafeInteger(row.proposed?.[k])&&row.proposed[k]>=0))throw Error('Invalid private downtime recovery row');
    ids.add(row.accountId);
  }
  return plan;
}
const dataDirectory=process.env.DATA_DIR||fileURLToPath(new URL('../../data/',import.meta.url));
const configured=process.env.DOWNTIME_RECOVERY_PLAN_PATH;
export const DOWNTIME_RECOVERY_PLAN=readDowntimeRecoveryPlan(configured||path.join(dataDirectory,'downtime-recovery-plan.json'),{optional:!configured});
