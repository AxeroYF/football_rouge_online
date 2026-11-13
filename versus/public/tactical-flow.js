export const TACTICAL_FLOW_GROUPS=Object.freeze({
  lossTransition:{label:"丢球应对",choices:{balanced:"就近施压",counterPress:"短时反抢",regroup:"立即回撤"},
    description:"反抢争取快速夺回，消耗更大且可能被突破；回撤优先恢复队形。"},
  restDefense:{label:"进攻留守",choices:{balanced:"均衡留守",conservative:"加强保护",adventurous:"增加前插"},
    description:"加强保护增加留守与补位；增加前插提供接应，也会暴露反击空间。"},
  clockManagement:{label:"时间管理",choices:{normal:"正常节奏",slow:"耐心控制",quick:"争取时间"},
    description:"耐心控制真实消耗比赛时间；争取时间加快处理，也提高执行难度。"},
});
export function tacticalFlowFields(source={},fallback={}) {
  return Object.fromEntries(Object.entries(TACTICAL_FLOW_GROUPS).map(([key,group])=>{
    const value=source[key]??fallback[key]??(key==='clockManagement'?'normal':'balanced');
    if(!Object.hasOwn(group.choices,value))throw new Error(`无效的${group.label}`);
    return [key,value];
  }));
}
export const restDefenseCount=value=>({adventurous:2,balanced:3,conservative:4})[value]??3;
