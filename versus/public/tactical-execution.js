// Shared, enum-only schema: UI, saved schemes, imports and engine use one vocabulary.
export const EXECUTION_GROUPS=Object.freeze({
  pressTrigger:{section:'press',label:'压迫触发',default:'balanced',choices:{balanced:'常规判断',backPass:'对方回传',wide:'边线接球',ownHalf:'进入本方半场'},description:'只在触发区域投入协同压迫；跑动和弱侧覆盖需要付出代价。'},
  pressAssignment:{section:'press',label:'压迫分工',default:'closeDown',choices:{closeDown:'一人上抢，一人保护',screen:'优先封锁传球线'},description:'上抢接近持球者；封线保护接应路线，但给持球者更多处理时间。'},
  defensiveFocus:{section:'press',label:'重点防守',default:'balanced',choices:{balanced:'均衡覆盖',creator:'限制组织者',striker:'限制中锋',wide:'限制边路'},description:'根据当前对手职责选择重点，盯防移动有距离限制，也会让出原区域。'},
  buildUpRoute:{section:'build',label:'后场出球区域',default:'balanced',choices:{balanced:'因地制宜',left:'左侧优先',center:'中路优先',right:'右侧优先'},description:'优先寻找该区域的可行接应，区域受压时由备用路线决定处理。'},
  buildUpOutlet:{section:'build',label:'优先接应点',default:'balanced',choices:{balanced:'自由接应',pivot:'后腰接应',target:'中锋支点'},description:'优先连接相应职责的可用球员；没有可达接应点时选择其他路线。'},
  pressureEscape:{section:'build',label:'受压备用路线',default:'hold',choices:{hold:'保持组织',switch:'转移弱侧',direct:'直接找前场'},description:'受压时转移需要更长处理时间；直接出球牺牲传递质量。'},
  setPieceRoutine:{section:'setPiece',label:'角球套路',default:'balanced',choices:{balanced:'均衡落点',near:'近点抢攻',far:'远点争顶',short:'短角球配合'},description:'近点重启动、远点重争顶；短角球先完成传接，再尝试创造机会。'},
  setPieceCommitment:{section:'setPiece',label:'角球人员投入',default:'balanced',choices:{balanced:'均衡分工',protect:'留守保护',attack:'增加抢点'},description:'抢点、二点与留守共享人员；投入越多，丢球后回防距离越长。'},
  planAfter:{section:'conditions',label:'比分预案最早启用',default:'0',choices:{'0':'任何时间','45':'45 分钟后','60':'60 分钟后','75':'75 分钟后','85':'85 分钟后'},description:'领先或落后预案需同时满足比分与时间；默认预案不受此项限制。'},
  rotationPolicy:{section:'conditions',label:'自动轮换条件',default:'off',choices:{off:'关闭主动轮换',fatigue:'优先替换低体力',booked:'优先保护黄牌',balanced:'体力与黄牌综合'},description:'优先黄牌，再按体力排序；仅换有合适替补的球员。伤退与门将应急优先。'},
  rotationAfter:{section:'conditions',label:'主动轮换开始时间',default:'60',choices:{'45':'45 分钟后','60':'60 分钟后','70':'70 分钟后','80':'80 分钟后'},description:'每次行动链开始检查，主动轮换间隔至少 5 个足球分钟。'},
  rotationFitness:{section:'conditions',label:'轮换体力阈值',default:'65',choices:{'55':'低于 55','65':'低于 65','75':'低于 75','85':'低于 85'},description:'体力条件要求替补至少多 5 点体力；全队最多换 5 人，换下者不得再入场。'},
});
export const EXECUTION_SECTIONS={build:'出球与接应',press:'压迫与针对性防守',setPiece:'定位球战术',conditions:'条件预案与轮换'};
export function tacticalExecutionFields(source={},fallback={}) {
  return Object.fromEntries(Object.entries(EXECUTION_GROUPS).map(([key,group])=>{
    const value=source[key]??fallback[key]??group.default;
    if(typeof value!=='string'||!Object.hasOwn(group.choices,value))throw new Error(`无效的${group.label}`);
    return [key,value];
  }));
}
