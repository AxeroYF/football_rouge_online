export const FACILITY_ART_VERSION = '20260909-headquarters-v3';
export const LEVEL_NAMES = ['基础站点','配套扩建','完整院区','专业升级','旗舰地标'];
const CORE_FACILITY_ART = Object.freeze([
 {type:'club-headquarters',name:'俱乐部总部',accent:'#276B77',palette:['#276B77','#EDEAD8','#D7B15E'],signature:'青蓝玻璃摩天大楼 · 金色竖向框架 · 阶梯式塔冠',levels:['玻璃办公塔与总部入口广场','增高办公塔、侧翼与入口雨棚','阶梯双塔、玻璃幕墙与连廊','高层主塔、双翼裙楼与屋顶花园','旗舰摩天楼、金色塔冠与空中连桥']},
 {type:'main-stadium',name:'主体育场',accent:'#235ABD',palette:['#235ABD','#EDEAD8','#658B47'],signature:'宝蓝马蹄看台 · 椭圆场碗 · 白色悬挑冠棚',levels:['紧凑马蹄看台、蓝色外墙和双塔入口','补齐南看台、照明与计分牌','二层看台、连续外立面与入口门楼','双侧白色悬挑棚与媒体包厢','完整冠棚、结构肋与金色屋顶环']},
 {type:'scout-center',name:'球探中心',accent:'#6746A3',palette:['#6746A3','#D7B15E','#E8D9BB'],signature:'紫色八角观测塔 · 大型双筒镜 · 罗盘前庭',levels:['八角观测所、大型双筒镜与罗盘入口','紫顶档案翼与地图展台','环形观察阳台、侧翼与交通连廊','情报分析翼、碟形天线与庭院','高层总部、金色地球仪与双翼院区']},
 {type:'port',name:'港口',accent:'#253F65',palette:['#253F65','#DAA127','#279DAA','#EDEAD8'],signature:'深蓝仓库 · 黄白灯塔 · U 形泊位与船只',levels:['黄白灯塔、蓝顶仓库、U 形木港与泊船','岸吊、第二泊位与航标','石码头、货箱仓储与双起重架','弧顶客运厅、长泊位与大型船只','双层航站楼、高灯塔与港口门架']},
 {type:'training-center',name:'训练中心',accent:'#CA5A28',palette:['#CA5A28','#EDEAD8','#658B47'],signature:'赭橙环形跑道 · 侧置拱形训练馆 · 器材阵列',levels:['完整橙色跑道、草坪与拱顶训练馆','计时门、照明和器材训练区','加高训练馆、体测楼与看台棚','体测楼二层、太阳能顶与训练平台','高层教练观察台、连桥与完整训练基地']},
 {type:'medical-center',name:'医疗中心',accent:'#216957',palette:['#216957','#EDEAD8','#327F99'],signature:'白色十字楼体 · 深绿十字屋顶 · 独立急救车道',levels:['完整十字诊所、深绿屋顶与急救入口','救护车、住院侧楼和有盖落客区','二层十字诊疗楼与双侧病房','玻璃诊疗厅、空中连廊与院区','高层诊疗塔、绿色停机坪与双翼医院']},
 {type:'recovery-center',name:'体能恢复中心',accent:'#198F9A',palette:['#198F9A','#54C5CA','#E8D9BB'],signature:'青蓝圆形水院 · 新月凉廊 · 阶梯温泉',levels:['大圆池、新月形水疗馆与白色柱廊','双层水池、侧池与日光平台','铜青圆顶、完整后院与休憩凉廊','玻璃康复翼、景观桥和水疗平台','双弧遮棚、中央穹顶与喷泉水院']},
 {type:'club-shop',name:'俱乐部商店',accent:'#DAA127',palette:['#DAA127','#863B45','#EDEAD8'],signature:'金黄连排屋顶 · 酒红商业街 · 巨型球衣招牌',levels:['L 形商街、黄白棚、橱窗与球衣招牌','侧街摊位、拱廊与铺装广场','二层连排商店、挑台和金色门楼','玻璃展销馆、露台与徽章','双翼旗舰商场、金色穹顶与纪念球']},
]);
// Terrain-dependent economic facilities, using the same five-level model family.
export const INDUSTRY_ACADEMY_ART = Object.freeze([
 {type:'university',name:'大学',accent:'#395B70',palette:['#395B70','#EDEAD8','#D7B15E'],signature:'蓝灰学院屋顶 · 白石柱廊 · 金色时钟塔',levels:['钟楼讲堂、入口柱廊与书卷标识','图书馆侧翼、庭院长椅与校园门柱','双翼学院、抬高钟楼与中庭绿地','科研楼、玻璃连廊与铜青观测穹顶','旗舰大学、双层钟楼塔冠与完整研究院区'],newFacility:true},
 {type:'factory',name:'工厂',accent:'#AC5941',palette:['#AC5941','#62787A','#DAA127'],signature:'砖红锯齿厂房 · 分节烟囱 · 金色起重设备',levels:['锯齿屋顶车间、砖烟囱与装卸平台','仓储侧房、料罐与传送带','双生产车间、双烟囱与储料系统','高架起重门机、装配机械臂与连通管线','完整工业园、双层物流桥与大型生产配套'],newFacility:true},
]);
const EXISTING_FACILITY_ART=Object.freeze([...CORE_FACILITY_ART,...INDUSTRY_ACADEMY_ART,{type:'oil-well',name:'油井',accent:'#62787A',palette:['#253F65','#62787A','#DAA127'],signature:'游梁式抽油机 · A 形支架 · 弧形驴头',levels:['单等级抽油机、配重传动、储油罐与管线'],newFacility:true}]);
export const AIRPORT_ART=Object.freeze({type:'airport',name:'机场',accent:'#256BA4',palette:['#256BA4','#EDEAD8','#454E53','#327F99'],signature:'宽阔长跑道 · 高耸八角塔台 · 小型航站楼 · 领土色涂装',levels:['单等级机场：以宽跑道和高塔台为主体，配小型航站楼及停机坪'],newFacility:true,planned:false,customizable:true});
export const FACILITY_ART=Object.freeze([...EXISTING_FACILITY_ART,AIRPORT_ART]);
export const FACILITY_MODEL_ART=FACILITY_ART;
export const UNIT_ART = Object.freeze([
 {type:'expedition',name:'远征战棋',accent:'#AC263D',palette:['#AC263D','#D7B15E','#EDEAD8'],signature:'深红盾形棋座、金边大旗、三人红白远征队'},
 {type:'scout',name:'球探',accent:'#5F7B60',palette:['#5F7B60','#DAA127','#E8D9BB'],signature:'砂金罗盘棋座、绿斗篷宽檐帽、大地图与双筒镜'},
]);
export const FACILITY_ASSET_ITEMS=Object.freeze([...FACILITY_MODEL_ART.flatMap(f=>f.levels.map((change,i)=>({assetId:f.type+'-lv'+(i+1),type:f.type,name:f.name,kind:'facility',newFacility:f.newFacility===true,planned:f.planned===true,customizable:f.customizable===true,level:i+1,change,signature:f.signature,accent:f.accent,palette:f.palette}))),...UNIT_ART.map(u=>({...u,assetId:u.type,kind:'unit',level:null,change:u.signature}))]);
export function facilityArtIcon(type,level=1){
 if(!FACILITY_ART.some(f=>f.type===type))return null;
 const n=Math.max(1,Math.min(FACILITY_ART.find(f=>f.type===type).levels.length,Math.trunc(Number(level)||1)));
 return '/assets/facilities/icons/'+type+'-lv'+n+'.png?v='+FACILITY_ART_VERSION;
}
export function unitArtIcon(type){return UNIT_ART.some(u=>u.type===type)?'./assets/facilities/icons/'+type+'.png?v='+FACILITY_ART_VERSION:null;}
