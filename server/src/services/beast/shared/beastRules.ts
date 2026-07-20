/**
 * 灵兽成长与属性计算共享规则
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：集中定义灵兽属性结算、经验注入、兽诀覆盖规则。
 *    作为灵兽服务与战斗快照的唯一纯函数入口。
 * 2. 不做什么：不直接读写数据库，不处理 HTTP 参数，不消费物品。
 *
 * 输入 / 输出：
 * - 输入：灵兽模板配置、等级、资质加成乘数、兽诀被动、品阶、化形状态。
 * - 输出：属性快照、经验注入计划、可覆盖兽诀列表。
 *
 * 数据流 / 状态流：
 * beastService / battle -> beastRules -> 返回纯计算结果 -> 调用方负责落库或构建 DTO。
 *
 * 关键边界条件与坑点：
 * 1) 灵兽等级可能因历史数据高于境界上限，培养入口必须按 maxLevel 截断。
 * 2) 打书只能覆盖后天兽诀，"当前只有天生兽诀"必须判定为不可覆盖。
 * 3) aptitudeBonus 为全局属性乘数，默认 1.0，培育可提升。
 */

import type { BeastBaseAttrConfig, BeastGrowthConfig } from '../beastConfigLoader.js';
import { getStarLevelMultiplier } from '../../shared/starLevelLoader.js';

// ==================== 常量 ====================

/**
 * 属性覆盖类型：Partial<BeastBaseAttrConfig>，用于后期定向培育覆盖模板属性。
 */
export type AttrOverride = Partial<BeastBaseAttrConfig>;

/**
 * 品阶加成倍率。
 */
const TIER_MULTIPLIERS: Record<string, number> = {
  huang: 1.0,
  xuan: 1.2,
  di: 1.5,
  tian: 2.0,
};

/**
 * 化形额外加成倍率。
 */
const TRANSFORM_MULTIPLIER = 1.1;

/**
 * 需要向下取整的属性。
 */
const INTEGER_ATTR_KEYS = new Set<string>([
  'max_hp', 'max_mp', 'atk', 'magic_atk', 'def', 'magic_def',
  'hp_regen', 'mp_regen',
]);

// ==================== 工具函数 ====================

const normalizeInteger = (value: unknown, minimum: number = 0): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return minimum;
  return Math.max(minimum, Math.floor(parsed));
};

const normalizeFiniteNumber = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
};

const cloneBaseAttrs = (baseAttrs: BeastBaseAttrConfig): Record<string, number> => ({
  max_hp: normalizeFiniteNumber(baseAttrs.max_hp),
  max_mp: normalizeFiniteNumber(baseAttrs.max_mp),
  atk: normalizeFiniteNumber(baseAttrs.atk),
  magic_atk: normalizeFiniteNumber(baseAttrs.magic_atk),
  def: normalizeFiniteNumber(baseAttrs.def),
  magic_def: normalizeFiniteNumber(baseAttrs.magic_def),
  spd: normalizeFiniteNumber(baseAttrs.spd),
  accuracy: normalizeFiniteNumber(baseAttrs.accuracy),
  dodge: normalizeFiniteNumber(baseAttrs.dodge),
  parry: normalizeFiniteNumber(baseAttrs.parry),
  crit_rate: normalizeFiniteNumber(baseAttrs.crit_rate),
  crit_dmg: normalizeFiniteNumber(baseAttrs.crit_dmg),
  crit_dmg_reduce: normalizeFiniteNumber(baseAttrs.crit_dmg_reduce),
  anti_crit: normalizeFiniteNumber(baseAttrs.anti_crit),
  dmg_bonus: normalizeFiniteNumber(baseAttrs.dmg_bonus),
  heal_bonus: normalizeFiniteNumber(baseAttrs.heal_bonus),
  heal_reduce: normalizeFiniteNumber(baseAttrs.heal_reduce),
  life_steal: normalizeFiniteNumber(baseAttrs.life_steal),
  cdr: normalizeFiniteNumber(baseAttrs.cdr),
  control_resist: normalizeFiniteNumber(baseAttrs.control_resist),
  metal_resist: normalizeFiniteNumber(baseAttrs.metal_resist),
  wood_resist: normalizeFiniteNumber(baseAttrs.wood_resist),
  water_resist: normalizeFiniteNumber(baseAttrs.water_resist),
  fire_resist: normalizeFiniteNumber(baseAttrs.fire_resist),
  earth_resist: normalizeFiniteNumber(baseAttrs.earth_resist),
  hp_regen: normalizeFiniteNumber(baseAttrs.hp_regen),
  mp_regen: normalizeFiniteNumber(baseAttrs.mp_regen),
});

// ==================== 升级经验计算 ====================

/**
 * 计算升到指定等级所需的单级经验。
 * 公式：base_exp × growth_rate^(targetLevel - 2)
 */
export const calcBeastUpgradeExpByTargetLevel = (
  targetLevel: number,
  config: BeastGrowthConfig,
): number => {
  const safeTargetLevel = Math.max(2, normalizeInteger(targetLevel));
  const levelOffset = Math.max(0, safeTargetLevel - 2);
  const rawCost =
    normalizeInteger(config.exp_base_exp) *
    Math.pow(normalizeFiniteNumber(config.exp_growth_rate), levelOffset);
  const normalizedCost = Math.floor(rawCost);
  if (normalizedCost <= 0) {
    throw new Error('灵兽升级配置异常：单级升级经验必须大于 0');
  }
  return normalizedCost;
};

// ==================== 经验注入计划 ====================

export interface BeastInjectPlan {
  spentExp: number;
  remainingCharacterExp: number;
  beforeLevel: number;
  afterLevel: number;
  beforeProgressExp: number;
  afterProgressExp: number;
  gainedLevels: number;
}

/**
 * 计算经验灌注升级计划。
 * 消耗角色经验，逐步升级灵兽直到经验不足或达到等级上限。
 */
export const resolveBeastInjectPlan = (params: {
  beforeLevel: number;
  beforeProgressExp: number;
  characterExp: number;
  injectExpBudget: number;
  config: BeastGrowthConfig;
  maxLevel?: number;
}): BeastInjectPlan => {
  const beforeLevel = Math.max(1, normalizeInteger(params.beforeLevel));
  const beforeProgressExp = normalizeInteger(params.beforeProgressExp);
  const characterExp = normalizeInteger(params.characterExp);
  const injectExpBudget = Math.min(
    characterExp,
    normalizeInteger(params.injectExpBudget),
  );
  const maxLevel =
    params.maxLevel === undefined
      ? Number.MAX_SAFE_INTEGER
      : Math.max(1, normalizeInteger(params.maxLevel));

  let currentLevel = beforeLevel;
  let currentProgressExp = beforeProgressExp;
  let remainingBudget = injectExpBudget;
  let gainedLevels = 0;

  const currentLevelCost = calcBeastUpgradeExpByTargetLevel(
    currentLevel + 1,
    params.config,
  );
  if (currentProgressExp >= currentLevelCost) {
    throw new Error('灵兽进度异常：当前等级经验已超过升级需求');
  }

  while (remainingBudget > 0) {
    if (currentLevel >= maxLevel) {
      currentProgressExp = 0;
      break;
    }

    const nextLevelCost = calcBeastUpgradeExpByTargetLevel(
      currentLevel + 1,
      params.config,
    );
    const requiredExp = Math.max(0, nextLevelCost - currentProgressExp);
    if (requiredExp <= 0) {
      currentLevel += 1;
      currentProgressExp = 0;
      gainedLevels += 1;
      continue;
    }

    if (remainingBudget >= requiredExp) {
      remainingBudget -= requiredExp;
      currentLevel += 1;
      currentProgressExp = 0;
      gainedLevels += 1;
      continue;
    }

    currentProgressExp += remainingBudget;
    remainingBudget = 0;
  }

  const spentExp = injectExpBudget - remainingBudget;
  return {
    spentExp,
    remainingCharacterExp: Math.max(0, characterExp - spentExp),
    beforeLevel,
    afterLevel: currentLevel,
    beforeProgressExp,
    afterProgressExp: currentProgressExp,
    gainedLevels,
  };
};

// ==================== 品阶与化形加成 ====================

/**
 * 获取品阶加成倍率。
 */
export const calcTierMultiplier = (beastTier: string): number => {
  return TIER_MULTIPLIERS[beastTier] ?? 1.0;
};

/**
 * 获取化形加成倍率。
 */
export const calcTransformMultiplier = (isTransformed: boolean): number => {
  return isTransformed ? TRANSFORM_MULTIPLIER : 1.0;
};

// ==================== 兽诀被动合并 ====================

export interface BeastTechniquePassiveConfig {
  key: string;
  value: number;
  type: 'flat' | 'percent' | 'multiply';
}

/**
 * 分类兽诀被动加成：固定 / 百分比 / 倍率。
 */
export const splitBeastTechniquePassives = (
  passives: Record<string, number>,
  passiveTypes: Map<string, string>,
): {
  flatAdditive: Record<string, number>;
  percentAdditive: Record<string, number>;
  percentMultiply: Record<string, number>;
} => {
  const flatAdditive: Record<string, number> = {};
  const percentAdditive: Record<string, number> = {};
  const percentMultiply: Record<string, number> = {};

  for (const [key, value] of Object.entries(passives)) {
    const type = passiveTypes.get(key) ?? 'flat';
    switch (type) {
      case 'percent':
        percentAdditive[key] = normalizeFiniteNumber(percentAdditive[key]) + normalizeFiniteNumber(value);
        break;
      case 'multiply':
        percentMultiply[key] = normalizeFiniteNumber(percentMultiply[key]) + normalizeFiniteNumber(value);
        break;
      default:
        flatAdditive[key] = normalizeFiniteNumber(flatAdditive[key]) + normalizeFiniteNumber(value);
        break;
    }
  }

  return { flatAdditive, percentAdditive, percentMultiply };
};

// ==================== 属性结算 ====================

/**
 * 计算灵兽最终属性。
 *
 * 计算流程：
 * 1. 基础属性（来自模板 base_attrs + base_attrs_override 覆盖增量）
 * 2. + 等级成长（(effectiveLevel-1) × (level_attr_gains 或 level_gains_override)）
 * 3. × aptitudeBonus（资质加成乘数）
 * 4. + 兽诀固定加成
 * 5. × (1 + 兽诀百分比加成) × 兽诀倍率加成
 * 6. × 品阶加成
 * 7. × 化形加成
 * 8. × 星级加成
 *
 * 关键设计：
 * - effectiveLevel = min(level, levelCap)，支持副本等级上限场景
 * - override 字段为覆盖增量，后期定向培育时写入，初始为空 {}
 */
export const calcBeastAttrs = (params: {
  baseAttrs: BeastBaseAttrConfig;
  level: number;
  effectiveLevel?: number;
  levelAttrGains?: Partial<BeastBaseAttrConfig>;
  aptitudeBonus: number;
  baseAttrsOverride?: AttrOverride;
  levelGainsOverride?: AttrOverride;
  passiveAttrs?: Record<string, number>;
  passiveTypes?: Map<string, string>;
  beastTier: string;
  starLevel: number;
  isTransformed: boolean;
  element?: string[];
}): Record<string, number> => {
  const base = cloneBaseAttrs(params.baseAttrs);
  const safeLevel = Math.max(1, normalizeInteger(params.level));
  const effectiveLevel = params.effectiveLevel !== undefined
    ? Math.max(1, Math.min(safeLevel, normalizeInteger(params.effectiveLevel)))
    : safeLevel;
  const gainedLevels = Math.max(0, effectiveLevel - 1);
  const aptitudeBonus = Math.max(0, normalizeFiniteNumber(params.aptitudeBonus));
  const baseAttrsOverride = params.baseAttrsOverride ?? {};
  const levelGainsOverride = params.levelGainsOverride ?? {};
  const passiveAttrs = params.passiveAttrs ?? {};
  const passiveTypes = params.passiveTypes ?? new Map<string, string>();

  // Step 1: 应用 base_attrs_override（覆盖增量加到模板基础属性上）
  for (const [key, value] of Object.entries(baseAttrsOverride)) {
    if (key in base) {
      base[key] = normalizeFiniteNumber(base[key]) + normalizeFiniteNumber(value);
    }
  }

  // Step 2: 等级成长（优先使用 level_gains_override，不存在则用模板 level_attr_gains）
  const gainsSource = Object.keys(levelGainsOverride).length > 0
    ? levelGainsOverride
    : (params.levelAttrGains ?? {});
  for (const [key, value] of Object.entries(gainsSource)) {
    const baseValue = normalizeFiniteNumber(base[key]);
    const levelGain = normalizeFiniteNumber(value);
    base[key] = baseValue + gainedLevels * levelGain;
  }

  // Step 3: 资质加成乘数
  if (aptitudeBonus !== 1.0) {
    for (const key of Object.keys(base)) {
      base[key] = normalizeFiniteNumber(base[key]) * aptitudeBonus;
    }
  }

  // Step 4-5: 兽诀被动加成
  const splitPassives = splitBeastTechniquePassives(passiveAttrs, passiveTypes);

  for (const [key, value] of Object.entries(splitPassives.flatAdditive)) {
    base[key] = normalizeFiniteNumber(base[key]) + normalizeFiniteNumber(value);
  }

  for (const [key, value] of Object.entries(splitPassives.percentAdditive)) {
    base[key] = normalizeFiniteNumber(base[key]) + normalizeFiniteNumber(value);
  }

  for (const [key, value] of Object.entries(splitPassives.percentMultiply)) {
    const baseValue = normalizeFiniteNumber(base[key]);
    base[key] = Math.max(0, baseValue * (1 + normalizeFiniteNumber(value)));
  }

  // Step 6: 品阶加成
  const tierMultiplier = calcTierMultiplier(params.beastTier);
  for (const key of Object.keys(base)) {
    base[key] = normalizeFiniteNumber(base[key]) * tierMultiplier;
  }

  // Step 7: 化形加成
  const transformMultiplier = calcTransformMultiplier(params.isTransformed);
  if (transformMultiplier !== 1.0) {
    for (const key of Object.keys(base)) {
      base[key] = normalizeFiniteNumber(base[key]) * transformMultiplier;
    }
  }

  // Step 8: 星级加成
  const starMultiplier = getStarLevelMultiplier(params.starLevel);
  if (starMultiplier !== 1.0) {
    for (const key of Object.keys(base)) {
      base[key] = normalizeFiniteNumber(base[key]) * starMultiplier;
    }
  }

  // 整数属性向下取整，概率属性限制范围
  for (const key of Object.keys(base)) {
    if (INTEGER_ATTR_KEYS.has(key)) {
      base[key] = Math.max(0, Math.floor(normalizeFiniteNumber(base[key])));
    }
  }

  // 概率类属性限制在 [0, 1]
  const probabilityKeys = [
    'accuracy', 'dodge', 'parry', 'crit_rate', 'anti_crit',
    'heal_reduce', 'life_steal', 'cdr',
    'control_resist', 'metal_resist', 'wood_resist',
    'water_resist', 'fire_resist', 'earth_resist',
  ];
  for (const key of probabilityKeys) {
    if (key in base) {
      base[key] = Math.max(0, Math.min(1, normalizeFiniteNumber(base[key])));
    }
  }

  // 暴击伤害最小值 1.0
  base['crit_dmg'] = Math.max(1.0, normalizeFiniteNumber(base['crit_dmg']));

  // 速度最小值 0.01
  base['spd'] = Math.max(0.01, normalizeFiniteNumber(base['spd']));

  return base;
};

// ==================== 兽诀覆盖规则 ====================

export interface BeastLearnedTechniqueState {
  techniqueId: string;
  isInnate: boolean;
}

/**
 * 列出可被覆盖的兽诀 ID（排除天生兽诀）。
 * 仅当槽位已满时返回，否则返回空数组（表示无需覆盖）。
 */
export const listReplaceableTechniqueIds = (
  techniques: BeastLearnedTechniqueState[],
  maxTechniqueSlots: number,
): string[] => {
  if (techniques.length < Math.max(0, normalizeInteger(maxTechniqueSlots))) {
    return [];
  }
  return techniques
    .filter((entry) => !entry.isInnate)
    .map((entry) => entry.techniqueId);
};

/**
 * 计算灵兽战力评分（用于排行榜）。
 */
export const calcBeastScore = (attrs: Record<string, number>, level: number): number => {
  const maxHp = normalizeFiniteNumber(attrs['max_hp']);
  const atk = normalizeFiniteNumber(attrs['atk']);
  const magicAtk = normalizeFiniteNumber(attrs['magic_atk']);
  const def = normalizeFiniteNumber(attrs['def']);
  const magicDef = normalizeFiniteNumber(attrs['magic_def']);
  const spd = normalizeFiniteNumber(attrs['spd']);
  const critRate = normalizeFiniteNumber(attrs['crit_rate']);
  const critDmg = normalizeFiniteNumber(attrs['crit_dmg']);

  return Math.floor(
    maxHp * 0.5 +
    (atk + magicAtk) * 2 +
    (def + magicDef) * 1.5 +
    spd * 10 +
    critRate * critDmg * 100 +
    level * 50,
  );
};
