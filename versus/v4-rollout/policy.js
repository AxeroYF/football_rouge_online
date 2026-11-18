// Host-owned configuration. No request, URL or player setting may enable V4.
export function selectMatchEngine({policy={},fixture,coverage={blockers:[]},accepted=false,pinned=null}){
  if(!fixture?.id||!['league','cup','season-final','friendly'].includes(fixture.competition))throw new Error('赛事选择输入无效');
  if(pinned){if(pinned.fixtureId!==fixture.id)throw new Error('锁定比赛标识不一致');return {...pinned,reason:'已开始的比赛继续使用锁定版本'};}
  if(!['off','shadow','canary'].includes(policy.mode??'off'))throw new Error('V4 切换模式无效');
  const legacy={fixtureId:fixture.id,primary:'legacy',shadow:false,reason:'默认沿用正式旧引擎'};
  if((policy.mode??'off')==='off')return legacy;
  if(!accepted)return {...legacy,reason:'候选版本尚未验收，保留旧引擎'};
  if(!Array.isArray(coverage.blockers)||coverage.blockers.length)return {...legacy,reason:'存在未覆盖比赛能力，保留旧引擎'};
  if(policy.mode==='shadow')return {...legacy,shadow:true,reason:'旧引擎出正式结果，V4 仅在隔离状态中比较'};
  if(!Array.isArray(policy.fixtureAllowlist)||!policy.fixtureAllowlist.includes(fixture.id)||!Array.isArray(policy.competitions)||!policy.competitions.includes(fixture.competition))return {...legacy,reason:'本场不在服务端灰度名单'};
  return {fixtureId:fixture.id,primary:'v4',shadow:false,reason:'候选已验收且本场在服务端灰度名单'};
}
