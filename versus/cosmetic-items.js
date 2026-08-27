export const BADGE_GRADE_RATES = Object.freeze({ S:0.05, A:0.15, B:0.30, C:0.50 });
export const COUNTRY_BADGE_GRADE_RATES = BADGE_GRADE_RATES;
export const CLUB_BADGE_GRADE_RATES = BADGE_GRADE_RATES;
export const COUNTRY_BADGE_ASSET_VERSION = "20260822c001";
export const CLUB_BADGE_ASSET_VERSION = "20260822c002";
export const COSMETIC_BADGE_MINIMUM_LISTING_PRICE = 100;

export const COUNTRY_BADGE_PACK = Object.freeze({
  id:"country-badge-pack",
  name:"国家徽章包",
  price:1000,
  kind:"cosmetic",
  pool:"COUNTRY_BADGE",
  selectionMode:"choice",
  cosmeticType:"country-badge",
  gradeRates:COUNTRY_BADGE_GRADE_RATES,
  description:"随机展示3枚国家徽章并选择1枚永久收藏。单个候选位等级概率：S 5%、A 15%、B 30%、C 50%；中国徽章属于S级。",
});

export const CLUB_BADGE_PACK = Object.freeze({
  id:"club-badge-pack",
  name:"俱乐部徽章包",
  price:1200,
  kind:"cosmetic",
  pool:"CLUB_BADGE",
  selectionMode:"choice",
  cosmeticType:"club-badge",
  gradeRates:CLUB_BADGE_GRADE_RATES,
  description:"随机展示3枚俱乐部徽章并选择1枚永久收藏。单个候选位等级概率：S 5%、A 15%、B 30%、C 50%；稀有度按俱乐部历史成绩、知名度与影响力综合划分。",
});

const badge = (id, abbreviation, name, grade) => Object.freeze({
  id:`country-badge-${id}`,
  countryId:id,
  abbreviation,
  name:`${name}徽章`,
  countryName:name,
  displayName:name,
  category:"country",
  grade,
  kind:"country-badge",
  slot:"teamBadge",
  imageUrl:`/versus/assets/country-badges/${id}.webp?v=${COUNTRY_BADGE_ASSET_VERSION}`,
});

const clubBadge = (id, name, grade) => Object.freeze({
  id:`club-badge-${id}`,
  clubId:id,
  name:`${name}徽章`,
  clubName:name,
  displayName:name,
  category:"club",
  grade,
  kind:"club-badge",
  slot:"clubBadge",
  imageUrl:`/versus/assets/club-badges/${id}.webp?v=${CLUB_BADGE_ASSET_VERSION}`,
});

export const COUNTRY_BADGES = Object.freeze([
  badge("qatar", "QAT", "卡塔尔", "C"),
  badge("ecuador", "ECU", "厄瓜多尔", "B"),
  badge("senegal", "SEN", "塞内加尔", "A"),
  badge("netherlands", "NED", "荷兰", "S"),
  badge("england", "ENG", "英格兰", "S"),
  badge("iran", "IRN", "伊朗", "B"),
  badge("usa", "USA", "美国", "A"),
  badge("wales", "WAL", "威尔士", "C"),
  badge("argentina", "ARG", "阿根廷", "S"),
  badge("saudi-arabia", "KSA", "沙特阿拉伯", "C"),
  badge("mexico", "MEX", "墨西哥", "A"),
  badge("poland", "POL", "波兰", "B"),
  badge("france", "FRA", "法国", "S"),
  badge("australia", "AUS", "澳大利亚", "B"),
  badge("denmark", "DEN", "丹麦", "A"),
  badge("tunisia", "TUN", "突尼斯", "C"),
  badge("spain", "ESP", "西班牙", "S"),
  badge("costa-rica", "CRC", "哥斯达黎加", "C"),
  badge("germany", "GER", "德国", "S"),
  badge("japan", "JPN", "日本", "A"),
  badge("belgium", "BEL", "比利时", "A"),
  badge("canada", "CAN", "加拿大", "B"),
  badge("morocco", "MAR", "摩洛哥", "A"),
  badge("croatia", "CRO", "克罗地亚", "A"),
  badge("brazil", "BRA", "巴西", "S"),
  badge("serbia", "SRB", "塞尔维亚", "B"),
  badge("switzerland", "SUI", "瑞士", "A"),
  badge("cameroon", "CMR", "喀麦隆", "B"),
  badge("portugal", "POR", "葡萄牙", "S"),
  badge("ghana", "GHA", "加纳", "B"),
  badge("uruguay", "URU", "乌拉圭", "A"),
  badge("south-korea", "KOR", "韩国", "B"),
  // 中国是游戏内指定的 S 级徽章，不随现实国家队排名自动调整。
  badge("china", "CHN", "中国", "S"),
  badge("italy", "ITA", "意大利", "S"),
]);

export const COUNTRY_BADGE_BY_ID = Object.freeze(Object.fromEntries(COUNTRY_BADGES.map((item) => [item.id, item])));

export const CLUB_BADGES = Object.freeze([
  clubBadge("real-madrid", "皇家马德里", "S"),
  clubBadge("barcelona", "巴塞罗那", "S"),
  clubBadge("atletico-madrid", "马德里竞技", "A"),
  clubBadge("sevilla", "塞维利亚", "A"),
  clubBadge("valencia", "瓦伦西亚", "B"),
  clubBadge("athletic-club", "毕尔巴鄂竞技", "B"),
  clubBadge("manchester-united", "曼联", "S"),
  clubBadge("manchester-city", "曼城", "S"),
  clubBadge("liverpool", "利物浦", "S"),
  clubBadge("chelsea", "切尔西", "S"),
  clubBadge("arsenal", "阿森纳", "S"),
  clubBadge("tottenham-hotspur", "托特纳姆热刺", "A"),
  clubBadge("bayern-munich", "拜仁慕尼黑", "S"),
  clubBadge("borussia-dortmund", "多特蒙德", "A"),
  clubBadge("bayer-leverkusen", "勒沃库森", "A"),
  clubBadge("rb-leipzig", "RB莱比锡", "B"),
  clubBadge("juventus", "尤文图斯", "S"),
  clubBadge("ac-milan", "AC米兰", "S"),
  clubBadge("inter-milan", "国际米兰", "S"),
  clubBadge("napoli", "那不勒斯", "A"),
  clubBadge("as-roma", "罗马", "A"),
  clubBadge("lazio", "拉齐奥", "B"),
  clubBadge("paris-saint-germain", "巴黎圣日耳曼", "S"),
  clubBadge("marseille", "马赛", "A"),
  clubBadge("monaco", "摩纳哥", "B"),
  clubBadge("lyon", "里昂", "B"),
  clubBadge("ajax", "阿贾克斯", "A"),
  clubBadge("psv-eindhoven", "PSV埃因霍温", "B"),
  clubBadge("feyenoord", "费耶诺德", "B"),
  clubBadge("benfica", "本菲卡", "A"),
  clubBadge("porto", "波尔图", "A"),
  clubBadge("sporting-cp", "葡萄牙体育", "A"),
  clubBadge("celtic", "凯尔特人", "B"),
  clubBadge("rangers", "格拉斯哥流浪者", "B"),
  clubBadge("galatasaray", "加拉塔萨雷", "B"),
  clubBadge("fenerbahce", "费内巴切", "C"),
  clubBadge("club-brugge", "布鲁日", "C"),
  clubBadge("shakhtar-donetsk", "顿涅茨克矿工", "C"),
  clubBadge("dynamo-kyiv", "基辅迪纳摩", "C"),
  clubBadge("red-star-belgrade", "贝尔格莱德红星", "B"),
  clubBadge("newcastle-united", "纽卡斯尔联", "B"),
  clubBadge("aston-villa", "阿斯顿维拉", "B"),
  clubBadge("everton", "埃弗顿", "C"),
  clubBadge("west-ham-united", "西汉姆联", "B"),
  clubBadge("nottingham-forest", "诺丁汉森林", "B"),
  clubBadge("brighton", "布莱顿", "C"),
  clubBadge("wolverhampton-wanderers", "狼队", "C"),
  clubBadge("leicester-city", "莱斯特城", "B"),
  clubBadge("crystal-palace", "水晶宫", "C"),
  clubBadge("southampton", "南安普顿", "C"),
  clubBadge("leeds-united", "利兹联", "B"),
]);

export const CLUB_BADGE_BY_ID = Object.freeze(Object.fromEntries(CLUB_BADGES.map((item) => [item.id, item])));
export const COSMETIC_BADGES = Object.freeze([...COUNTRY_BADGES, ...CLUB_BADGES]);
export const COSMETIC_BADGE_BY_ID = Object.freeze(Object.fromEntries(COSMETIC_BADGES.map((item) => [item.id, item])));

function weightedGrade(rng, available, gradeRates = BADGE_GRADE_RATES) {
  const active = Object.entries(gradeRates).filter(([grade]) => available.some((item) => item.grade === grade));
  const total = active.reduce((sum, [grade]) => sum + gradeRates[grade], 0) || 1;
  let roll = Math.max(0, Math.min(0.999999999999, Number(rng()))) * total;
  for (const [grade] of active) {
    roll -= gradeRates[grade];
    if (roll < 0) return grade;
  }
  return active.at(-1)?.[0] ?? "C";
}

export function drawCountryBadgeChoices(rng = Math.random, count = 3) {
  return drawBadgeChoices(COUNTRY_BADGES, rng, count, COUNTRY_BADGE_GRADE_RATES);
}

export function drawClubBadgeChoices(rng = Math.random, count = 3) {
  return drawBadgeChoices(CLUB_BADGES, rng, count, CLUB_BADGE_GRADE_RATES);
}

export function drawCosmeticBadgeChoices(cosmeticType, rng = Math.random, count = 3) {
  return cosmeticType === "club-badge" ? drawClubBadgeChoices(rng, count) : drawCountryBadgeChoices(rng, count);
}

function drawBadgeChoices(catalog, rng, count, gradeRates) {
  const available = [...catalog];
  const result = [];
  while (result.length < count && available.length) {
    const grade = weightedGrade(rng, available, gradeRates);
    const gradeItems = available.filter((item) => item.grade === grade);
    const chosen = gradeItems[Math.floor(Math.max(0, Math.min(0.999999999999, Number(rng()))) * gradeItems.length)];
    result.push(chosen);
    available.splice(available.findIndex((item) => item.id === chosen.id), 1);
  }
  return result;
}
