// 中文译名池按征程阶段递进：英格兰非职业联赛 → 英甲/英乙 → 英冠 → 英超 → 欧洲顶级赛场。
// 名字只用于小范围原型中的随机生成，不把随机球员与某支俱乐部做固定绑定。
const NAME_TIERS = Object.freeze([
  Object.freeze({
    key: "community",
    label: "英格兰社区与非职业联赛",
    teams: Object.freeze([
      "巴尼特", "罗奇代尔", "奥尔德姆竞技", "约克城", "绍森德联", "哈利法克斯镇",
      "萨顿联", "森林绿流浪者", "波士顿联", "奥特林查姆", "哈特尔浦联", "伊斯特利",
      "盖茨黑德", "索利赫尔摩尔斯", "沃金", "奥尔德肖特镇", "布伦特里镇", "耶奥维尔镇",
    ]),
    players: Object.freeze([
      "哈里·普里查德", "瑞斯·布朗", "卡勒姆·斯特德", "杰克·杨", "泰勒·弗罗斯特", "本·科克",
      "乔治·桑德斯", "里根·奥格尔", "奥利·班克斯", "亚历克斯·里德", "比利·查德威克", "杰克·布里奇",
      "瑞安·克拉克", "汤姆·克劳福德", "乔·格雷", "卢克·沃特福尔", "杰米·斯托特", "乔希·凯利",
      "汤姆·惠兰", "杰克·亨特", "科里·惠特利", "山姆·奥斯本", "马克斯·克雷茨施马尔", "丹尼·科利",
      "奥利·斯科特", "康纳·马赫尼", "乔丹·亨特", "刘易斯·佩奇", "查理·库珀", "阿什利·查尔斯",
      "卡梅伦·考克斯", "马库斯·迪纳加", "杰克·库克", "卢克·扬", "乔·奎格利", "芬利·威尔金森",
    ]),
  }),
  Object.freeze({
    key: "efl",
    label: "英乙与英甲",
    teams: Object.freeze([
      "阿克灵顿斯坦利", "巴罗", "克鲁亚历山大", "切尔滕汉姆", "唐卡斯特流浪者", "吉林汉姆",
      "林肯城", "什鲁斯伯里镇", "维冈竞技", "斯托克港", "韦康比流浪者", "北安普顿镇",
      "彼得伯勒联", "曼斯菲尔德城", "埃克塞特城", "斯蒂夫尼奇", "布里斯托尔流浪者", "剑桥联",
    ]),
    players: Object.freeze([
      "乔治·劳埃德", "卢克·莫利纽", "约瑟夫·奥洛乌", "欧文·贝利", "哈里·克利夫顿", "乔丹·吉布森",
      "瑞安·克罗斯代尔", "埃利奥特·内维特", "康纳·马斯特森", "马特·史密斯", "杰克·马尔登", "艾萨克·奥拉奥费",
      "帕迪·马登", "刘易斯·贝特", "伊桑·埃尔哈洪", "凯尔·伍顿", "威尔·费里", "乔治·麦凯克伦",
      "丹·肯普", "卢克·莱希", "汤姆·洛克耶", "杰克·泰勒", "约翰·马奎斯", "里基·杰德-琼斯",
      "马利克·马瑟西尔", "乔尔·兰德尔", "卡勒姆·麦克马纳曼", "萨姆·提克尔", "马修·史密斯", "戴尔·泰勒",
      "乔希·马奇", "汤姆·佩特", "埃利奥特·李", "詹姆斯·麦克林", "奥利弗·帕尔默", "马克斯·克利沃思",
    ]),
  }),
  Object.freeze({
    key: "championship",
    label: "英格兰冠军联赛",
    teams: Object.freeze([
      "米尔沃尔", "普雷斯顿北区", "布里斯托尔城", "诺维奇城", "西布朗", "米德尔斯堡",
      "考文垂城", "谢菲尔德联", "南安普顿", "莱斯特城", "伊普斯维奇", "斯托克城",
      "女王公园巡游者", "布莱克本流浪者", "赫尔城", "德比郡", "伯明翰城", "查尔顿竞技",
    ]),
    players: Object.freeze([
      "乔什·布朗希尔", "博尔哈·赛恩斯", "杰克·鲁多尼", "卡尔顿·莫里斯", "汤姆·坎农", "芬恩·阿扎兹",
      "卡勒姆·奥黑尔", "古斯塔沃·哈默", "杰森·莫伦比", "乔希·温达斯", "乔尔·皮罗", "伊利曼·恩迪亚耶",
      "萨姆·莫尔西", "杰克·克拉克", "乔纳森·罗", "安格斯·冈恩", "本·吉布森", "达拉·奥谢",
      "海登·哈克尼", "以赛亚·琼斯", "本·多克", "乔治·萨维尔", "邓肯·沃特莫尔", "乔·布莱恩",
      "布兰登·托马斯-阿桑特", "维克托·托普", "本·希夫", "卡勒姆·多伊尔", "威尔·斯莫尔伯恩", "刘易斯·贝克",
      "安德烈·维迪加尔", "巴里·班南", "杰德·华莱士", "亚当·阿姆斯特朗", "泰勒·哈伍德-贝利斯", "乔·罗斯韦尔",
    ]),
  }),
  Object.freeze({
    key: "premier",
    label: "英格兰超级联赛",
    teams: Object.freeze([
      "布伦特福德", "水晶宫", "富勒姆", "布莱顿", "阿斯顿维拉", "纽卡斯尔联",
      "托特纳姆热刺", "切尔西", "曼联", "埃弗顿", "西汉姆联", "伯恩茅斯",
      "诺丁汉森林", "狼队", "利兹联", "桑德兰", "伯恩利", "利物浦",
    ]),
    players: Object.freeze([
      "布赖恩·姆伯莫", "埃贝雷奇·埃泽", "亚历山大·伊萨克", "布鲁诺·吉马良斯", "摩根·罗杰斯", "科尔·帕尔默",
      "恩佐·费尔南德斯", "德克兰·赖斯", "布卡约·萨卡", "马丁·厄德高", "亚历克西斯·麦卡利斯特", "多米尼克·索博斯洛伊",
      "穆罕默德·萨拉赫", "科迪·加克波", "瑞安·赫拉芬贝赫", "奥利·沃特金斯", "尤里·蒂勒曼斯", "雅各布·拉姆塞",
      "安东尼·戈登", "桑德罗·托纳利", "马克·格伊", "亚当·沃顿", "让-菲利普·马特塔", "德怀特·麦克尼尔",
      "贾罗德·鲍恩", "穆罕默德·库杜斯", "安托万·塞门约", "米洛斯·科尔克兹", "若昂·佩德罗", "三笘薰",
      "卡洛斯·巴莱巴", "安德烈·奥纳纳", "科比·梅努", "布鲁诺·费尔南德斯", "米基·范德芬", "帕普·萨尔",
    ]),
  }),
  Object.freeze({
    key: "elite",
    label: "欧洲顶级俱乐部",
    teams: Object.freeze([
      "阿森纳", "利物浦", "曼城", "皇家马德里", "巴塞罗那", "拜仁慕尼黑",
      "巴黎圣日耳曼", "国际米兰", "尤文图斯", "马德里竞技", "勒沃库森", "多特蒙德",
      "那不勒斯", "亚特兰大", "摩纳哥", "本菲卡", "葡萄牙体育", "马赛",
    ]),
    players: Object.freeze([
      "维尼修斯·儒尼奥尔", "裘德·贝林厄姆", "费德里科·巴尔韦德", "罗德里戈·戈斯", "奥雷利安·楚阿梅尼", "爱德华多·卡马文加",
      "拉明·亚马尔", "佩德里·冈萨雷斯", "加维·帕埃斯", "拉菲尼亚·迪亚斯", "达尼·奥尔莫", "保罗·库巴西",
      "哈里·凯恩", "迈克尔·奥利塞", "贾马尔·穆西亚拉", "约书亚·基米希", "阿方索·戴维斯", "亚历山大·帕夫洛维奇",
      "维蒂尼亚·费雷拉", "奥斯曼·登贝莱", "科维恰·克瓦拉茨赫利亚", "布拉德利·巴尔科拉", "沃伦·扎伊尔-埃梅里", "努诺·门德斯",
      "劳塔罗·马丁内斯", "亚历山德罗·巴斯托尼", "尼科洛·巴雷拉", "马库斯·图拉姆", "哈坎·恰尔汗奥卢", "费德里科·迪马尔科",
      "弗洛里安·维尔茨", "杰里米·弗林蓬", "格拉尼特·扎卡", "朱利安·布兰特", "谢尔胡·吉拉西", "卡里姆·阿德耶米",
    ]),
  }),
]);

export function nameTierIndex(stage = 1) {
  const numericStage = Number.isFinite(Number(stage)) ? Number(stage) : 1;
  return Math.min(NAME_TIERS.length - 1, Math.max(0, Math.floor((numericStage - 1) / 10)));
}

export function nameTier(stage = 1) {
  return NAME_TIERS[nameTierIndex(stage)];
}

function drawUnused(pool, rng, usedNames) {
  const used = usedNames instanceof Set ? usedNames : new Set(usedNames ?? []);
  const available = pool.filter((name) => !used.has(name));
  const source = available.length ? available : pool;
  return source[Math.floor(rng() * source.length)];
}

function translatedNameParts(tier) {
  const givenNames = new Set();
  const familyNames = new Set();
  for (const fullName of tier.players) {
    const [givenName, ...familyNameParts] = fullName.split("·");
    if (givenName) givenNames.add(givenName);
    if (familyNameParts.length) familyNames.add(familyNameParts.join("·"));
  }
  return { givenNames: [...givenNames], familyNames: [...familyNames] };
}

const COMBINED_PLAYER_NAMES = new Map(NAME_TIERS.map((tier) => {
  const { givenNames, familyNames } = translatedNameParts(tier);
  const combinations = [];
  for (const givenName of givenNames) {
    for (const familyName of familyNames) combinations.push(`${givenName}·${familyName}`);
  }
  return [tier.key, Object.freeze(combinations)];
}));

export function localizedPlayerNameCapacity(stage = 1) {
  return COMBINED_PLAYER_NAMES.get(nameTier(stage).key)?.length ?? 0;
}

export const LOCALIZED_PLAYER_NAME_CAPACITY = Object.freeze({
  perTier: Object.freeze(Object.fromEntries(NAME_TIERS.map((tier, index) => [tier.key, localizedPlayerNameCapacity(index * 10 + 1)]))),
  total: NAME_TIERS.reduce((sum, tier, index) => sum + localizedPlayerNameCapacity(index * 10 + 1), 0),
});

export function randomLocalizedTeamName(stage = 1, rng = Math.random, usedNames = []) {
  return drawUnused(nameTier(stage).teams, rng, usedNames);
}

export function randomLocalizedPlayerName(stage = 1, rng = Math.random, usedNames = []) {
  const tier = nameTier(stage);
  return drawUnused(COMBINED_PLAYER_NAMES.get(tier.key) ?? tier.players, rng, usedNames);
}

export const LOCALIZED_NAME_TIERS = NAME_TIERS;
