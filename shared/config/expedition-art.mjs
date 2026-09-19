export const EXPEDITION_ART_VERSION='20260908-expedition-vehicles-v1';
export const EXPEDITION_STYLES=Object.freeze([
 {id:'airplane',name:'飞机',title:'云端远征',accent:'#4EABB8',palette:['#E7EEE7','#3B929F','#D1B568'],signature:'后掠双翼 · 双涡扇发动机 · 蓝白涂装',pose:'双翼展开，起落架落地'},
 {id:'excavator',name:'挖掘机',title:'开拓先锋',accent:'#E1AE3F',palette:['#E1AE3F','#343E3E','#8CABB0'],signature:'工程黄车身 · 液压动臂 · 宽履带',pose:'动臂向前抬起，铲斗收拢'},
 {id:'bus',name:'大巴车',title:'全队出征',accent:'#569B80',palette:['#E8E5CF','#367E68','#344E56'],signature:'绿白双色 · 全景车窗 · 巡航车身',pose:'长轴客车，车顶配有空调机组'},
 {id:'sports-car',name:'跑车',title:'极速巡游',accent:'#CF5749',palette:['#C8483C','#26393E','#E4C885'],signature:'低矮宽体 · 红色车漆 · 双道拉花',pose:'前倾车身，尾翼与运动轮毂'},
 {id:'tank',name:'坦克',title:'钢铁先锋',accent:'#899266',palette:['#798460','#343E38','#D5AC65'],signature:'橄榄绿装甲 · 旋转炮塔 · 重型履带',pose:'炮塔朝前，履带稳稳落地'},
]);
export const LEGACY_EXPEDITION_STYLES=Object.freeze({default:'airplane',messi:'airplane',ronaldo:'excavator',mbappe:'bus',yamal:'sports-car',haaland:'tank'});
export function expeditionStyle(id){return EXPEDITION_STYLES.find(s=>s.id===(LEGACY_EXPEDITION_STYLES[id]??id))??EXPEDITION_STYLES[0];}
export function isExpeditionStyle(id){return typeof id==='string'&&(Object.hasOwn(LEGACY_EXPEDITION_STYLES,id)||EXPEDITION_STYLES.some(s=>s.id===id));}
export function expeditionArtIcon(id){return './assets/expedition-units/icons/'+expeditionStyle(id).id+'.png?v='+EXPEDITION_ART_VERSION;}
export function expeditionArtCatalog(){return EXPEDITION_STYLES.map(s=>({...s,icon:expeditionArtIcon(s.id)}));}
