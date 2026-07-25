const ability = (id, name, summary) => Object.freeze({ id, name, summary });

export const LEGEND_ABILITIES_BY_NAME = Object.freeze({
  "库尔图瓦": ability("high-wall", "高墙", "面对远射和传中抢点时扑救更稳定，并降低扑救脱手形成二次进攻的概率。"),
  "贝肯鲍尔": ability("libero", "自由人", "出任中卫或后腰时增强后场出球和防守转换；三中卫、控球或均衡体系中效果更完整。"),
  "莫德里奇": ability("midfield-metronome", "中场节拍器", "在中路多排或菱形中场中提高持球推进和抗压能力，降低中场组织被破坏的概率。"),
  "克罗斯": ability("precision-dispatch", "精准调度", "在密集短传或长传冲吊体系中提高中场控制，并增加直塞、转移和远射进攻的形成概率。"),
  "齐达内": ability("master-control", "大师控场", "位于中路前腰或中场区域时增强摆脱和最后一传，球队落后时效果小幅提升。"),
  "罗纳尔迪尼奥": ability("magician", "魔术师", "位于前腰或边路进攻区域时显著增强盘带突破和机会创造，但会轻微降低球队整体防守覆盖。"),
  "贝克汉姆": ability("bending-cross", "圆月弯刀", "位于右路或中场时提高传中和定位球输送质量；禁区内存在强力接应点时效果最佳。"),
  "姆巴佩": ability("depth-burst", "纵深爆破", "面对高位防线时提高反击、身后跑动和快速终结能力；面对低位防守时收益明显降低。"),
  "哈兰德": ability("box-finisher", "禁区终结者", "提高传中和倒三角进攻中的抢点、对抗与终结质量，但不会自行提高球队的机会创造能力。"),
  "C罗": ability("decisive-force", "决胜者", "提高传中进攻中的争顶与终结能力；比赛后段战平或落后时额外增强跑位和终结。"),
  "梅西": ability("right-side-core", "右侧核心", "位于右侧或中路进攻区域时增强持球推进、直塞和内切配合；右路缺少防守宽度时会留下轻微转换风险。"),
  "大罗": ability("phenomenon", "外星人", "作为前锋时显著增强单对单突破和快速终结，体能低于设定红线后效果会快速衰减。"),
  "马拉多纳": ability("king-zone", "球王领域", "位于中路进攻区域时增强持球推进并更容易制造犯规；严格裁判下收益更高，但丢失球权后的转换风险略增。"),
  "贝利": ability("complete-core", "全能核心", "出任前锋或前腰时增强相邻中前场的配合效率；攻守平衡体系中获得最完整的攻防转换收益。"),
});

export const LEGEND_ABILITIES = Object.freeze(Object.values(LEGEND_ABILITIES_BY_NAME));

export function legendAbilityForName(name) {
  return LEGEND_ABILITIES_BY_NAME[name] ?? null;
}

export function legendAbilitySummary(player) {
  return player?.legendAbility?.summary ?? legendAbilityForName(player?.name)?.summary ?? null;
}
