import { normalizePlayerSchema } from "../game/public/schema.js";
import { LEGEND_PROFILES } from "../game/public/legends.js";
import { applyTopPlayerProfile, TOP_PLAYER_PROFILES } from "./top-player-profiles.js";

export const VERSUS_LINES = Object.freeze({
  GK: Object.freeze({ label: "门将", roles: ["GK"] }),
  DEF: Object.freeze({ label: "后场", roles: ["CB", "LB", "RB"] }),
  MID: Object.freeze({ label: "中场", roles: ["DM", "AM", "LM", "RM"] }),
  ATT: Object.freeze({ label: "前场", roles: ["ST", "LW", "RW"] }),
});

export const VERSUS_PLAYER_GRADE_WEIGHTS = Object.freeze({ S: 0.18, A: 0.55, B: 1, C: 1.25 });
const VERSUS_LEGEND_NAMES = new Set(LEGEND_PROFILES.map((profile) => profile.name));
const ARGENTINA_PLAYER_NAMES = new Set([
  "马丁内斯", "鲁利", "罗梅罗", "利桑德罗·马丁内斯", "麦卡利斯特",
  "恩佐", "帕雷德斯", "加纳乔", "阿尔瓦雷斯", "迪巴拉", "梅西",
]);

export function versusPlayerGrade(name, overall) {
  if (VERSUS_LEGEND_NAMES.has(name)) return "S";
  if (overall >= 89) return "A";
  if (overall >= 83) return "B";
  return "C";
}

const RAW_PLAYERS = {
  GK: `
阿利松|GK|89|right
埃德森|GK|88|left
库尔图瓦|GK|90|left
奥布拉克|GK|88|right
特尔施特根|GK|89|right
多纳鲁马|GK|89|right
迈尼昂|GK|87|right
诺伊尔|GK|88|right
马丁内斯|GK|87|right
索默|GK|86|right
拉亚|GK|86|right
奥纳纳|GK|84|right
科贝尔|GK|86|right
迪奥戈·科斯塔|GK|86|right
卢宁|GK|83|right
凯莱赫|GK|82|right
维卡里奥|GK|84|right
波普|GK|84|right
皮克福德|GK|85|left
亨德森|GK|82|right
拉姆斯代尔|GK|82|right
莱诺|GK|84|right
若泽·萨|GK|82|right
桑切斯|GK|81|right
阿雷奥拉|GK|81|right
特拉福德|GK|78|right
马马尔达什维利|GK|85|left
西莱森|GK|81|right
弗莱肯|GK|81|right
维尔布鲁根|GK|82|right
德赫亚|GK|86|right
纳瓦斯|GK|84|right
什琴斯尼|GK|86|right
布冯|GK|91|right
卡西利亚斯|GK|92|left
切赫|GK|91|left
范德萨|GK|91|right
卡恩|GK|92|right
舒梅切尔|GK|91|right
巴尔德斯|GK|87|right
迪达|GK|88|left
塞萨尔|GK|88|left
巴特兹|GK|85|left
莱曼|GK|87|right
雷纳|GK|85|right
坎波斯|GK|86|right
伊基塔|GK|84|right
曾加|GK|89|right
佐夫|GK|91|right
雅辛|GK|94|right
普罗维德尔|GK|83|right
梅雷特|GK|83|left
斯科鲁普斯基|GK|82|right
卡尔内塞基|GK|82|right
佩林|GK|80|right
帕特里西奥|GK|82|left
斯维拉尔|GK|81|right
穆索|GK|82|right
法尔科内|GK|80|right
拉杜|GK|78|right
雷米罗|GK|84|right
乌奈·西蒙|GK|86|right
凯帕|GK|82|right
索里亚|GK|82|right
鲁利|GK|82|right
佩尼亚|GK|79|right
德米特罗维奇|GK|81|left
巴塔利亚|GK|80|right
古拉奇|GK|83|right
鲍曼|GK|83|right
特拉普|GK|84|right
泽特尔|GK|80|right
努贝尔|GK|83|right
赫拉德茨基|GK|84|right
霍恩|GK|79|left
穆勒|GK|78|right
施沃洛夫|GK|80|right
卡斯特尔斯|GK|84|left
比佐特|GK|82|right
曼丹达|GK|83|right
桑巴|GK|84|right
拉丰|GK|82|right
洛佩斯|GK|82|left
舍瓦利耶|GK|84|right
布拉斯维奇|GK|80|right
本托|GK|83|right
韦弗顿|GK|83|right
卡西奥|GK|82|right
罗西|GK|81|right
阿尔玛尼|GK|82|right
马尔凯辛|GK|83|right
奥乔亚|GK|83|right
霍华德|GK|86|right
弗里德尔|GK|85|right
凯勒|GK|84|right
博诺|GK|86|left
穆尼尔|GK|80|right
瓦尼亚·米林科维奇-萨维奇|GK|83|right
塔法雷尔|GK|88|right
奇拉维特|GK|88|left
卢卡·齐达内|GK|80|right|法国|格拉纳达
阿尔瓦罗·瓦莱斯|GK|82|right|西班牙|皇家贝蒂斯
菲利普·约根森|GK|82|right|丹麦|切尔西
马德斯·赫尔曼森|GK|82|right|丹麦|莱斯特城
卡米尔·格拉巴拉|GK|84|right|波兰|沃尔夫斯堡
阿图尔·博鲁茨|GK|84|right|波兰|传奇球员
巴尔托沃梅伊·德龙戈夫斯基|GK|82|right|波兰|帕纳辛奈科斯
普雷德拉格·拉伊科维奇|GK|83|right|塞尔维亚|吉达联合
伊万·普罗维德尔|GK|84|right|意大利|拉齐奥
马尔科·卡尔内塞基|GK|84|right|意大利|亚特兰大
米歇尔·福尔姆|GK|83|right|荷兰|传奇球员
斯科特·卡森|GK|79|right|英格兰|曼城
安东尼·洛佩斯|GK|84|left|葡萄牙|南特
耶罗恩·佐特|GK|81|right|荷兰|阿尔克马尔
马修·瑞安|GK|82|right|澳大利亚|朗斯
丹尼尔·巴赫曼|GK|80|right|奥地利|沃特福德
伊沃·格尔比奇|GK|80|right|克罗地亚|里泽体育
阿尔冯斯·阿雷奥拉|GK|83|right|法国|西汉姆联
保罗·伯纳多尼|GK|80|right|法国|伊韦尔东
莱奥·雅尔丁|GK|81|right|巴西|瓦斯科达伽马
马克·弗莱肯|GK|83|right|荷兰|勒沃库森
罗宾·罗夫斯|GK|80|right|荷兰|奈梅亨
纪尧姆·雷斯特|GK|82|left|法国|图卢兹
詹姆斯·特拉福德|GK|83|right|英格兰|曼城
铃木彩艳|GK|84|right|日本|帕尔马
戈登·班克斯|GK|92|right|英格兰|传奇球员
彼得·希尔顿|GK|90|right|英格兰|传奇球员
大卫·希曼|GK|89|right|英格兰|传奇球员
帕特·詹宁斯|GK|89|right|北爱尔兰|传奇球员
米歇尔·普雷德霍姆|GK|91|right|比利时|传奇球员
让-马里·普法夫|GK|90|right|比利时|传奇球员
詹卢卡·帕柳卡|GK|90|right|意大利|传奇球员
安杰洛·佩鲁齐|GK|89|right|意大利|传奇球员
弗朗切斯科·托尔多|GK|90|right|意大利|传奇球员
克里斯蒂安·阿比亚蒂|GK|87|right|意大利|传奇球员
安东尼·苏比萨雷塔|GK|90|right|西班牙|传奇球员
路易斯·阿尔科纳达|GK|89|right|西班牙|传奇球员
里卡多·萨莫拉|GK|92|right|西班牙|传奇球员
里纳特·达萨耶夫|GK|91|right|俄罗斯|传奇球员
内维尔·索撒尔|GK|89|right|威尔士|传奇球员
耶日·杜德克|GK|86|right|波兰|传奇球员
布鲁斯·格罗贝拉|GK|87|right|津巴布韦|传奇球员
谢伊·吉文|GK|87|right|爱尔兰|传奇球员
乌戈·洛里斯|GK|89|left|法国|传奇球员
格雷戈里·库佩|GK|87|right|法国|传奇球员
塞尔希奥·戈耶切亚|GK|88|right|阿根廷|传奇球员
王大雷|GK|80|right|中国|山东泰山
颜骏凌|GK|80|right|中国|上海海港
赵贤祐|GK|82|right|韩国|蔚山HD
中村航辅|GK|81|right|日本|波尔蒂芒人`,
  DEF: `
范戴克|CB|90|right
鲁本·迪亚斯|CB|89|right
萨利巴|CB|88|right
吕迪格|CB|88|right
阿劳霍|CB|87|right
巴斯托尼|CB|88|left
马尔基尼奥斯|CB|87|right
米利唐|CB|86|right
加布里埃尔|CB|87|left
德利赫特|CB|86|right
科纳特|CB|86|right
金玟哉|CB|85|right
格瓦迪奥尔|CB|87|left
于帕梅卡诺|CB|84|right
塔普索巴|CB|85|right
布雷默|CB|86|right
阿切尔比|CB|84|left
帕瓦尔|CB|85|right
罗梅罗|CB|86|right
利桑德罗·马丁内斯|CB|85|left
斯通斯|CB|86|right
阿克|CB|85|left
阿坎吉|CB|85|right
托莫里|CB|84|right
施洛特贝克|CB|85|left
塔赫|CB|86|right
约罗|CB|82|right
布兰斯韦特|CB|82|left
安东尼奥·席尔瓦|CB|83|right
伊纳西奥|CB|84|left
拉波尔特|CB|86|left
佩佩|CB|86|right
蒂亚戈·席尔瓦|CB|88|right
基耶利尼|CB|89|left
博努奇|CB|87|right
巴尔扎利|CB|87|right
拉莫斯|CB|91|right
皮克|CB|89|right
普约尔|CB|90|right
卢卡斯·埃尔南德斯|CB|85|left
费迪南德|CB|90|right
特里|CB|90|right
维迪奇|CB|90|right
卡瓦略|CB|88|right
坎贝尔|CB|88|right
亚当斯|CB|89|right
内斯塔|CB|92|right
卡纳瓦罗|CB|92|right
马尔蒂尼|CB|94|left
巴雷西|CB|94|right
贝肯鲍尔|CB|95|right
卢西奥|CB|89|right
萨穆埃尔|CB|88|left
戈丁|CB|89|right
孔帕尼|CB|89|right
阿尔德韦雷尔德|CB|86|right
维尔通亨|CB|86|left
库利巴利|CB|87|right
胡梅尔斯|CB|88|right
博阿滕|CB|87|right
阿什拉夫|RB|87|right
卡瓦哈尔|RB|87|right
亚历山大-阿诺德|RB|88|right
沃克|RB|86|right
弗林蓬|RB|86|right
坎塞洛|RB|87|right
里斯·詹姆斯|RB|85|right
本·怀特|RB|85|right
达洛特|RB|83|right
孔德|RB|86|right
邓弗里斯|RB|85|right
迪洛伦佐|RB|84|right
特里皮尔|RB|84|right
利夫拉门托|RB|82|right
拉姆|RB|91|right
卡福|RB|93|right
萨内蒂|RB|92|right
阿尔维斯|RB|92|right
麦孔|RB|89|right
罗伯逊|LB|86|left
特奥·埃尔南德斯|LB|87|left
阿方索·戴维斯|LB|87|left
努诺·门德斯|LB|86|left
格里马尔多|LB|87|left
迪马尔科|LB|86|left
门迪|LB|84|left
卢克·肖|LB|84|left
库库雷利亚|LB|84|left
乌多基|LB|83|left
米格尔·古铁雷斯|LB|83|left
卡洛斯·奥古斯托|LB|82|left
阿什利·科尔|LB|91|left
埃弗拉|LB|89|left
马塞洛|LB|92|left
罗伯特·卡洛斯|LB|93|left
阿比达尔|LB|87|left
赞布罗塔|LB|89|both
布翁焦尔诺|CB|84|left
德塞利|CB|91|right
费兰·门迪|LB|84|left
列维·科尔威尔|CB|85|left|英格兰|切尔西
贾拉德·布兰斯韦特|CB|84|left|英格兰|埃弗顿
奥斯曼·迪奥曼德|CB|84|right|科特迪瓦|葡萄牙体育
托马斯·阿劳霍|CB|83|right|葡萄牙|本菲卡
乔治奥·斯卡尔维尼|CB|84|right|意大利|亚特兰大
奥马尔·索莱|CB|82|right|法国|乌迪内斯
凯文·丹索|CB|84|right|奥地利|托特纳姆热刺
马克西姆·埃斯泰夫|CB|81|left|法国|伯恩利
康斯坦丁诺斯·库利耶拉基斯|CB|82|left|希腊|沃尔夫斯堡
雅雷尔·夸安萨|CB|82|right|英格兰|勒沃库森
米洛斯·科尔克兹|LB|84|left|匈牙利|利物浦
帕特里克·多尔古|LB|83|left|丹麦|曼联
卢卡·内茨|LB|81|left|德国|门兴格拉德巴赫
马克西米利安·米特尔施泰特|LB|83|left|德国|斯图加特
大卫·莫勒·沃尔费|LB|82|left|挪威|阿尔克马尔
马洛·古斯托|RB|84|right|法国|切尔西
蒂诺·利夫拉门托|RB|84|right|英格兰|纽卡斯尔联
扬·库托|RB|83|right|巴西|多特蒙德
韦斯利·弗兰萨|RB|82|right|巴西|罗马
范德森|RB|84|right|巴西|摩纳哥
威尔弗雷德·辛戈|RB|83|right|科特迪瓦|摩纳哥
乔·斯卡利|RB|81|right|美国|门兴格拉德巴赫
伊万·弗雷斯内达|RB|81|right|西班牙|葡萄牙体育
阿尔瑙·马丁内斯|RB|83|right|西班牙|赫罗纳
尤金·蒙茨|CB|80|right|德国|圣保利
利利安·图拉姆|RB|92|right|法国|传奇球员
洛朗·布兰科|CB|91|right|法国|传奇球员
拉斐尔·瓦拉内|CB|89|right|法国|传奇球员
雅普·斯塔姆|CB|92|right|荷兰|传奇球员
罗纳德·科曼|CB|92|right|荷兰|传奇球员
费尔南多·耶罗|CB|91|right|西班牙|传奇球员
加埃塔诺·西雷阿|CB|93|right|意大利|传奇球员
克劳迪奥·詹蒂莱|CB|90|right|意大利|传奇球员
亚历山德罗·科斯塔库塔|CB|90|right|意大利|传奇球员
朱塞佩·贝尔戈米|RB|91|right|意大利|传奇球员
安德烈亚斯·布雷默|LB|91|both|德国|传奇球员
卡洛斯·阿尔贝托|RB|93|right|巴西|传奇球员
尼尔顿·桑托斯|LB|93|left|巴西|传奇球员
贾钦托·法切蒂|LB|92|left|意大利|传奇球员
保罗·布莱特纳|LB|91|left|德国|传奇球员
丹尼·布林德|CB|89|left|荷兰|传奇球员
弗兰克·德波尔|CB|90|left|荷兰|传奇球员
马里奥·耶佩斯|CB|87|right|哥伦比亚|传奇球员
伊万·科尔多巴|CB|89|right|哥伦比亚|传奇球员
卡洛斯·加马拉|CB|89|right|巴拉圭|传奇球员
马丁·德米凯利斯|CB|87|right|阿根廷|传奇球员
布拉尼斯拉夫·伊万诺维奇|RB|88|right|塞尔维亚|传奇球员
莱顿·贝恩斯|LB|87|left|英格兰|传奇球员
巴勃罗·萨巴莱塔|RB|87|right|阿根廷|传奇球员
塞萨尔·阿斯皮利奎塔|RB|87|right|西班牙|传奇球员`,
  MID: `
罗德里|DM|91|right
赖斯|DM|88|right
楚阿梅尼|DM|86|right
卡塞米罗|DM|87|right
基米希|DM|88|right
帕利尼亚|DM|85|right
吉马良斯|DM|86|right
凯塞多|DM|85|right
祖比门迪|DM|85|right
乌加特|DM|83|right
拉比奥|DM|84|left
若昂·内维斯|DM|84|right
坎特|DM|89|right
布斯克茨|DM|91|right
马克莱莱|DM|91|right
维埃拉|DM|92|right
罗伊·基恩|DM|90|right
加图索|DM|87|right
哈维·阿隆索|DM|90|right
皮尔洛|DM|92|right
德布劳内|AM|92|right
贝林厄姆|AM|91|right
厄德高|AM|89|left
穆西亚拉|AM|89|right
维尔茨|AM|90|right
帕尔默|AM|88|left
布鲁诺·费尔南德斯|AM|88|right
福登|AM|90|left
麦卡利斯特|AM|87|right
佩德里|AM|88|right
加维|AM|85|right
奥尔莫|AM|86|right
西蒙斯|AM|86|right
埃泽|AM|84|right
麦迪逊|AM|85|right
萨维尼奥|AM|83|left
库杜斯|AM|84|left
切尔基|AM|83|left
沃德-普劳斯|AM|83|right
埃里克森|AM|84|both
巴尔韦德|RM|89|right
卡马文加|LM|87|left
莫德里奇|AM|91|right
克罗斯|DM|92|right
京多安|AM|87|right
蒂亚戈|AM|88|right
贝尔纳多·席尔瓦|RM|89|left
科瓦契奇|AM|86|right
德容|DM|88|right
巴雷拉|RM|88|right
恰尔汗奥卢|DM|87|right
托纳利|DM|86|right
洛卡特利|DM|84|right
弗拉泰西|AM|83|right
扎卡|DM|86|left
维蒂尼亚|AM|87|right
法比安·鲁伊斯|AM|85|left
扎伊尔-埃梅里|AM|84|right
埃梅里|AM|82|right
恩佐|AM|85|right
帕雷德斯|DM|83|right
帕奎塔|AM|85|left
乔林顿|LM|83|right
道格拉斯·路易斯|DM|84|right
蒂勒曼斯|AM|84|right
格拉文贝赫|DM|84|right
索博斯洛伊|AM|85|right
琼斯|AM|82|right
梅里诺|AM|85|left
奥亚萨瓦尔|LM|84|left
哈维|AM|94|right
伊涅斯塔|AM|94|right
齐达内|AM|95|both
卡卡|AM|93|right
罗纳尔迪尼奥|AM|94|right
里瓦尔多|AM|92|left
斯科尔斯|AM|91|right
杰拉德|AM|92|right
兰帕德|AM|91|right
贝克汉姆|RM|91|right
吉格斯|LM|91|left
菲戈|RM|93|right
内德维德|LM|92|both
西多夫|AM|91|right
戴维斯|DM|89|left
里克尔梅|AM|91|right
艾马尔|AM|89|right
德科|AM|89|right
鲁伊·科斯塔|AM|90|right
巴拉克|AM|90|right
马特乌斯|DM|94|right
古利特|AM|94|right
里杰卡尔德|DM|93|right
济科|AM|94|right
苏格拉底|AM|92|right
普拉蒂尼|AM|94|right
博格巴|AM|88|right
亚亚·图雷|DM|91|right
法布雷加斯|AM|90|right
大卫·席尔瓦|AM|91|left
亚当·沃顿|DM|84|left|英格兰|水晶宫
卡洛斯·巴莱巴|DM|84|left|喀麦隆|布莱顿
安杰洛·斯蒂勒|DM|85|left|德国|斯图加特
阿莱克斯·斯科特|AM|82|right|英格兰|伯恩茅斯
阿奇·格雷|DM|83|right|英格兰|托特纳姆热刺
卢卡斯·贝里瓦尔|DM|84|right|瑞典|托特纳姆热刺
沃伦·扎伊尔-埃梅里|DM|87|right|法国|巴黎圣日耳曼
莫滕·尤尔曼德|DM|86|right|丹麦|葡萄牙体育
雨果·拉尔松|DM|84|right|瑞典|法兰克福
亚历山大·帕夫洛维奇|DM|84|right|德国|拜仁慕尼黑
汤姆·比朔夫|AM|82|left|德国|拜仁慕尼黑
克里斯·里格|AM|81|left|英格兰|桑德兰
弗兰科·马斯坦托诺|AM|84|left|阿根廷|皇家马德里
尼科·帕斯|AM|85|left|阿根廷|科莫
肯德里·派斯|AM|83|left|厄瓜多尔|斯特拉斯堡
克劳迪奥·埃切韦里|AM|83|right|阿根廷|曼城
伊桑·恩瓦内里|AM|84|left|英格兰|阿森纳
阿尤布·布阿迪|DM|82|right|法国|里尔
塞缪尔·里奇|DM|84|left|意大利|都灵
马蒂亚斯·斯万贝里|RM|82|right|瑞典|沃尔夫斯堡
奥斯卡·格洛赫|AM|83|right|以色列|萨尔茨堡红牛
安德烈·桑托斯|DM|83|left|巴西|切尔西
恩佐·米约|AM|83|right|法国|斯图加特
洛夫罗·马耶尔|AM|84|left|克罗地亚|沃尔夫斯堡
马丁·巴图里纳|AM|84|right|克罗地亚|科莫
博比·查尔顿|AM|94|right|英格兰|传奇球员
雷蒙·科帕|AM|93|right|法国|传奇球员
迪迪|DM|94|right|巴西|传奇球员
热尔松|DM|92|left|巴西|传奇球员
法尔考|DM|92|right|巴西|传奇球员
通尼尼奥·塞雷佐|DM|90|right|巴西|传奇球员
胡安·塞巴斯蒂安·贝隆|DM|90|right|阿根廷|传奇球员
费尔南多·雷东多|DM|92|left|阿根廷|传奇球员
迭戈·西蒙尼|DM|88|right|阿根廷|传奇球员
何塞普·瓜迪奥拉|DM|89|right|西班牙|传奇球员
路易斯·苏亚雷斯·米拉蒙特斯|AM|93|right|西班牙|传奇球员
米歇尔·普拉蒂尼|AM|95|right|法国|传奇球员
阿兰·吉雷瑟|AM|90|right|法国|传奇球员
让·蒂加纳|DM|90|right|法国|传奇球员
米夏埃尔·巴拉克|AM|91|right|德国|传奇球员
施特凡·埃芬博格|DM|89|right|德国|传奇球员
德扬·斯坦科维奇|DM|88|right|塞尔维亚|传奇球员
罗伯特·普罗辛内茨基|AM|89|right|克罗地亚|传奇球员
兹沃尼米尔·博班|AM|90|right|克罗地亚|传奇球员
图加伊·克里莫格鲁|DM|87|right|土耳其|传奇球员
中田英寿|AM|88|right|日本|传奇球员
朴智星|RM|87|right|韩国|传奇球员
哈维尔·马斯切拉诺|DM|89|right|阿根廷|传奇球员
迈克尔·埃辛|DM|90|right|加纳|传奇球员
克劳德·马克莱莱|DM|92|right|法国|传奇球员`,
  ATT: `
姆巴佩|ST|93|right
哈兰德|ST|92|left
维尼修斯|LW|92|right
萨拉赫|RW|91|left
凯恩|ST|91|right
劳塔罗|ST|89|right
莱万多夫斯基|ST|90|right
奥斯梅恩|ST|89|right
格列兹曼|ST|89|left
萨卡|RW|89|left
亚马尔|RW|89|left
罗德里戈|RW|87|right
克瓦拉茨赫利亚|LW|88|right
登贝莱|RW|87|both
拉菲尼亚|RW|87|left
路易斯·迪亚斯|LW|86|right
加克波|LW|85|right
努涅斯|ST|84|right
若塔|ST|85|right
迪亚比|RW|84|left
马丁内利|LW|85|right
热苏斯|ST|84|right
哈弗茨|ST|85|left
特罗萨德|LW|84|right
孙兴慜|LW|88|both
理查利森|ST|83|right
库卢塞夫斯基|RW|84|left
伊萨克|ST|87|right
戈登|LW|84|right
沃特金斯|ST|86|right
鲍文|RW|85|left
托尼|ST|85|right
索兰克|ST|84|right
霍伊伦|ST|82|left
加纳乔|LW|83|right
拉什福德|LW|84|right
齐尔克泽|ST|81|right
阿尔瓦雷斯|ST|87|right
菲利克斯|ST|85|right
莫拉塔|ST|84|right
尼科·威廉姆斯|LW|86|right
姆贝乌莫|RW|84|left
久保建英|RW|85|left
多夫比克|ST|84|left
索尔洛特|ST|84|left
恩德里克|ST|82|left
吉拉西|ST|85|right
奥蓬达|ST|85|right
博尼费斯|ST|85|right
马尔穆什|LW|85|right
萨内|RW|86|left
科曼|LW|85|right
格纳布里|RW|84|right
奥利塞|RW|86|left
阿德耶米|LW|83|left
马伦|RW|83|right
堂安律|RW|83|left
小图拉姆|ST|86|right
弗拉霍维奇|ST|85|left
卢卡库|ST|86|left
莱奥|LW|88|right
普利西奇|RW|85|right
基耶萨|RW|85|right
迪巴拉|ST|87|left
因莫比莱|ST|84|right
卢克曼|LW|86|right
贝拉尔迪|RW|84|left
穆阿尼|ST|84|right
巴尔科拉|LW|84|right
贡萨洛·拉莫斯|ST|83|right
戴维|ST|84|right
拉卡泽特|ST|84|right
本耶德尔|ST|83|right
C罗|ST|94|right
梅西|RW|96|left
内马尔|LW|93|right
苏亚雷斯|ST|92|right
本泽马|ST|92|right
贝尔|RW|91|left
阿扎尔|LW|91|right
里贝里|LW|91|right
罗本|RW|92|left
伊布拉希莫维奇|ST|91|right
阿圭罗|ST|92|right
鲁尼|ST|92|right
亨利|ST|94|right
博格坎普|ST|92|right
德罗巴|ST|91|right
托雷斯|ST|90|right
埃托奥|ST|92|right
大罗|ST|96|right
罗马里奥|ST|94|right
巴蒂斯图塔|ST|92|right
舍甫琴科|ST|92|right
范巴斯滕|ST|95|right
克鲁伊夫|ST|96|right
马拉多纳|ST|97|left
贝利|ST|97|right
加林查|RW|95|right
尤西比奥|ST|95|right
本杰明·谢什科|ST|86|right|斯洛文尼亚|曼联
雨果·埃基蒂克|ST|85|right|法国|利物浦
尼克·沃尔特马德|ST|83|right|德国|斯图加特
萨穆·阿格霍瓦|ST|84|right|西班牙|波尔图
埃万·弗格森|ST|83|right|爱尔兰|罗马
乔纳森·戴维|ST|86|right|加拿大|尤文图斯
圣地亚哥·希门尼斯|ST|85|left|墨西哥|AC米兰
利亚姆·德拉普|ST|84|right|英格兰|切尔西
康拉德·哈德|ST|82|left|丹麦|葡萄牙体育
伊戈尔·蒂亚戈|ST|83|right|巴西|布伦特福德
杰米·拜诺-吉滕斯|LW|84|right|英格兰|切尔西
安东尼奥·努萨|LW|84|right|挪威|RB莱比锡
马利克·福法纳|LW|83|right|比利时|里昂
克里斯托斯·佐利斯|LW|83|right|希腊|布鲁日
朱利安·杜兰维尔|LW|82|right|比利时|多特蒙德
罗杰·费尔南德斯|LW|81|right|葡萄牙|布拉加
奥斯卡·鲍勃|RW|83|left|挪威|曼城
扬库巴·明特|RW|83|left|冈比亚|布莱顿
约翰·巴卡约科|RW|84|left|比利时|RB莱比锡
鲁尼·巴尔德吉|RW|82|left|瑞典|巴塞罗那
埃斯特旺|RW|85|left|巴西|切尔西
乔瓦尼·昆达|RW|84|left|葡萄牙|葡萄牙体育
弗朗西斯科·孔塞桑|RW|85|left|葡萄牙|尤文图斯
阿卜杜勒卡迪尔·厄米尔|RW|82|left|土耳其|诺维奇
马格内斯·阿克利乌什|RW|85|left|法国|摩纳哥
费伦茨·普斯卡什|ST|97|left|匈牙利|传奇球员
阿尔弗雷多·迪斯蒂法诺|ST|97|right|阿根廷|传奇球员
盖德·穆勒|ST|96|right|德国|传奇球员
罗伯托·巴乔|ST|94|right|意大利|传奇球员
亚历山德罗·德尔·皮耶罗|ST|93|right|意大利|传奇球员
弗朗切斯科·托蒂|ST|94|right|意大利|传奇球员
乔治·维阿|ST|93|right|利比里亚|传奇球员
米罗斯拉夫·克洛泽|ST|91|right|德国|传奇球员
大卫·比利亚|ST|92|right|西班牙|传奇球员
劳尔·冈萨雷斯|ST|93|left|西班牙|传奇球员
雨果·桑切斯|ST|93|left|墨西哥|传奇球员
肯佩斯|ST|93|left|阿根廷|传奇球员
保罗·罗西|ST|92|right|意大利|传奇球员
奥马尔·西沃里|ST|93|left|阿根廷|传奇球员
丹尼斯·劳|ST|92|right|苏格兰|传奇球员
乔治·贝斯特|RW|94|right|北爱尔兰|传奇球员
斯坦利·马修斯|RW|93|right|英格兰|传奇球员
托斯唐|ST|92|left|巴西|传奇球员
雅伊济尼奥|RW|93|right|巴西|传奇球员
里奥内尔·斯卡洛尼|RW|85|right|阿根廷|传奇球员
克劳迪奥·卡尼吉亚|ST|90|right|阿根廷|传奇球员
恩佐·弗朗西斯科利|ST|91|right|乌拉圭|传奇球员
迭戈·弗兰|ST|91|right|乌拉圭|传奇球员
马塞洛·萨拉斯|ST|90|left|智利|传奇球员
伊万·萨莫拉诺|ST|90|right|智利|传奇球员`,
};

const ROLE_PROFILES = Object.freeze({
  GK: {
    passing: 58, firstTouch: 55, dribbling: 28, crossing: 18, finishing: 10, longShots: 14, heading: 25, setPieces: 24,
    tackling: 20, marking: 18, positioning: 86, vision: 55, decisions: 80, composure: 78, offBall: 20, discipline: 76,
    pace: 48, acceleration: 50, strength: 76, stamina: 62, agility: 70, jumping: 82, workRate: 55, aggression: 36,
    goalkeeping: 92, reflexes: 92,
  },
  CB: {
    passing: 65, firstTouch: 62, dribbling: 43, crossing: 38, finishing: 34, longShots: 40, heading: 86, setPieces: 42,
    tackling: 91, marking: 91, positioning: 90, vision: 57, decisions: 82, composure: 78, offBall: 43, discipline: 72,
    pace: 68, acceleration: 65, strength: 86, stamina: 78, agility: 61, jumping: 86, workRate: 80, aggression: 75,
    goalkeeping: 10, reflexes: 10,
  },
  LB: {
    passing: 75, firstTouch: 73, dribbling: 72, crossing: 82, finishing: 48, longShots: 58, heading: 58, setPieces: 57,
    tackling: 78, marking: 77, positioning: 76, vision: 69, decisions: 72, composure: 72, offBall: 73, discipline: 69,
    pace: 86, acceleration: 85, strength: 69, stamina: 86, agility: 82, jumping: 65, workRate: 86, aggression: 67,
    goalkeeping: 10, reflexes: 10,
  },
  RB: {
    passing: 75, firstTouch: 73, dribbling: 72, crossing: 82, finishing: 48, longShots: 58, heading: 58, setPieces: 57,
    tackling: 78, marking: 77, positioning: 76, vision: 69, decisions: 72, composure: 72, offBall: 73, discipline: 69,
    pace: 86, acceleration: 85, strength: 69, stamina: 86, agility: 82, jumping: 65, workRate: 86, aggression: 67,
    goalkeeping: 10, reflexes: 10,
  },
  DM: {
    passing: 84, firstTouch: 79, dribbling: 68, crossing: 62, finishing: 51, longShots: 66, heading: 70, setPieces: 64,
    tackling: 84, marking: 81, positioning: 84, vision: 79, decisions: 82, composure: 82, offBall: 67, discipline: 74,
    pace: 70, acceleration: 68, strength: 78, stamina: 86, agility: 69, jumping: 72, workRate: 87, aggression: 72,
    goalkeeping: 10, reflexes: 10,
  },
  AM: {
    passing: 91, firstTouch: 89, dribbling: 85, crossing: 78, finishing: 78, longShots: 80, heading: 52, setPieces: 81,
    tackling: 48, marking: 43, positioning: 58, vision: 91, decisions: 86, composure: 87, offBall: 84, discipline: 67,
    pace: 76, acceleration: 79, strength: 61, stamina: 76, agility: 84, jumping: 55, workRate: 73, aggression: 48,
    goalkeeping: 10, reflexes: 10,
  },
  LM: {
    passing: 86, firstTouch: 84, dribbling: 84, crossing: 88, finishing: 71, longShots: 73, heading: 52, setPieces: 76,
    tackling: 58, marking: 54, positioning: 62, vision: 82, decisions: 79, composure: 79, offBall: 82, discipline: 68,
    pace: 82, acceleration: 83, strength: 62, stamina: 83, agility: 84, jumping: 57, workRate: 82, aggression: 52,
    goalkeeping: 10, reflexes: 10,
  },
  RM: {
    passing: 86, firstTouch: 84, dribbling: 84, crossing: 88, finishing: 71, longShots: 73, heading: 52, setPieces: 76,
    tackling: 58, marking: 54, positioning: 62, vision: 82, decisions: 79, composure: 79, offBall: 82, discipline: 68,
    pace: 82, acceleration: 83, strength: 62, stamina: 83, agility: 84, jumping: 57, workRate: 82, aggression: 52,
    goalkeeping: 10, reflexes: 10,
  },
  ST: {
    passing: 72, firstTouch: 84, dribbling: 81, crossing: 61, finishing: 93, longShots: 82, heading: 78, setPieces: 70,
    tackling: 30, marking: 28, positioning: 49, vision: 69, decisions: 82, composure: 89, offBall: 91, discipline: 65,
    pace: 83, acceleration: 84, strength: 78, stamina: 74, agility: 79, jumping: 75, workRate: 72, aggression: 63,
    goalkeeping: 8, reflexes: 8,
  },
  LW: {
    passing: 79, firstTouch: 87, dribbling: 91, crossing: 82, finishing: 84, longShots: 78, heading: 58, setPieces: 73,
    tackling: 34, marking: 31, positioning: 48, vision: 79, decisions: 79, composure: 83, offBall: 86, discipline: 67,
    pace: 91, acceleration: 92, strength: 63, stamina: 77, agility: 91, jumping: 60, workRate: 72, aggression: 48,
    goalkeeping: 8, reflexes: 8,
  },
  RW: {
    passing: 79, firstTouch: 87, dribbling: 91, crossing: 82, finishing: 84, longShots: 78, heading: 58, setPieces: 73,
    tackling: 34, marking: 31, positioning: 48, vision: 79, decisions: 79, composure: 83, offBall: 86, discipline: 67,
    pace: 91, acceleration: 92, strength: 63, stamina: 77, agility: 91, jumping: 60, workRate: 72, aggression: 48,
    goalkeeping: 8, reflexes: 8,
  },
});

function scaleProfile(role, overall) {
  const profile = ROLE_PROFILES[role];
  const delta = overall - 86;
  return Object.fromEntries(Object.entries(profile).map(([key, value]) => [
    key,
    Math.max(1, Math.min(99, Math.round(value + delta * (["goalkeeping", "reflexes"].includes(key) && role !== "GK" ? 0.15 : 0.72)))),
  ]));
}

function secondaryRoleFor(role, preferredFoot, index) {
  const alternatives = {
    GK: [],
    CB: ["DM", preferredFoot === "left" ? "LB" : "RB"],
    LB: ["LM", "CB"],
    RB: ["RM", "CB"],
    DM: ["CB", "AM"],
    AM: ["DM", "ST"],
    LM: ["LW", "DM"],
    RM: ["RW", "DM"],
    ST: [preferredFoot === "left" ? "RW" : "LW", "AM"],
    LW: ["LM", "ST"],
    RW: ["RM", "ST"],
  };
  const choices = alternatives[role] ?? [];
  return choices.length ? choices[index % choices.length] : null;
}

function databaseHeight(name, role, listedHeight) {
  const explicit = Number(listedHeight);
  if (Number.isFinite(explicit) && explicit >= 155 && explicit <= 205) return Math.round(explicit);
  const baseline = { GK:190, CB:187, LB:178, RB:178, DM:182, AM:178, LM:177, RM:177, ST:184, LW:176, RW:176 }[role] ?? 180;
  let hash = 0;
  for (const character of name) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return Math.max(165, Math.min(202, baseline + (hash % 9) - 4));
}

function parsePlayer(line, pool, index) {
  const [name, role, overallText, preferredFoot, listedNationality, listedClub, listedHeight] = line.split("|");
  const overall = Number(overallText);
  const individualized = applyTopPlayerProfile(name, overall, scaleProfile(role, overall));
  const profile = individualized.profile;
  const attributes = individualized.attributes;
  const nationality = profile?.nationality || listedNationality || (ARGENTINA_PLAYER_NAMES.has(name) ? "阿根廷" : "未登记");
  const club = profile?.club || listedClub || (VERSUS_LEGEND_NAMES.has(name) ? "传奇球员" : "未登记俱乐部");
  const player = normalizePlayerSchema({
    id: `real-${pool.toLowerCase()}-${String(index + 1).padStart(3, "0")}`,
    name,
    role,
    secondaryRole: secondaryRoleFor(role, preferredFoot, index),
    preferredFoot,
    heightCm: profile?.heightCm ?? databaseHeight(name, role, listedHeight),
    attributes,
    state: { fitness: 100, form: 50, morale: 70 },
    development: { age: 27, potential: overall },
    source: "internal-real-player-pool",
    nationality,
    club,
  }, { index });
  return Object.freeze({
    ...player,
    nationality,
    club,
    pool,
    overall,
    grade: versusPlayerGrade(name, overall),
    signature: profile?.signature ?? null,
    archetype: profile?.archetype ?? null,
    individualized: Boolean(profile),
    traits: [],
  });
}

export const REAL_PLAYER_POOLS = Object.freeze(Object.fromEntries(Object.entries(RAW_PLAYERS).map(([pool, text]) => {
  const players = text.trim().split("\n").map((line, index) => parsePlayer(line.trim(), pool, index));
  if (players.length !== 150) throw new Error(`${pool} player pool must contain exactly 150 players, received ${players.length}`);
  return [pool, Object.freeze(players)];
})));

export const REAL_PLAYERS = Object.freeze(Object.values(REAL_PLAYER_POOLS).flat());
export const REAL_PLAYER_BY_ID = Object.freeze(Object.fromEntries(REAL_PLAYERS.map((player) => [player.id, player])));
export const INDIVIDUALIZED_PLAYERS = Object.freeze(
  REAL_PLAYERS.filter((player) => player.individualized).sort((left, right) => right.overall - left.overall || left.id.localeCompare(right.id)),
);
if (INDIVIDUALIZED_PLAYERS.length !== Object.keys(TOP_PLAYER_PROFILES).length || INDIVIDUALIZED_PLAYERS.length !== 100) {
  throw new Error(`top player profiles must resolve to exactly 100 players, received ${INDIVIDUALIZED_PLAYERS.length}`);
}
