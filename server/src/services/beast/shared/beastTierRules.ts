/**
 * 灵兽品阶提升规则（纯函数）
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：定义升阶条件检查、升阶消耗。
 * 2. 不做什么：不操作数据库，不消耗物品。
 *
 * 关键边界条件与坑点：
 * 1) 升阶条件中的资质要求均为废案，待实际数据验证后补充。
 * 2) 化形功能待后期实装，当前升阶不要求化形。
 * 3) 升阶后 cultivation_count 重置为 0。
 */

// ==================== 升阶条件定义 ====================

export interface TierUpRequirement {
  minLevel: number;
  /** 废案：资质要求待实际数据验证后补充，当前不校验 */
  minAptitudeAll: number;
  consumeItem: string;
  consumeItemCount: number;
  consumeSpiritStones: number;
}

/**
 * 各品阶升阶条件表。
 * key 为目标品阶。
 * minLevel 表示当前品阶需要达到的等级上限（达到即可升阶）。
 * 注意：minAptitudeAll 均为废案，当前 checkTierUpConditions 不校验资质。
 */
export const TIER_UP_REQUIREMENTS: Record<string, TierUpRequirement> = {
  xuan: {
    minLevel: 10,  // 黄阶上限 10 级，达到即可升玄
    minAptitudeAll: 150,
    consumeItem: 'tier-up-pill',
    consumeItemCount: 1,
    consumeSpiritStones: 5000,
  },
  di: {
    minLevel: 20,  // 玄阶上限 20 级，达到即可升地
    minAptitudeAll: 300,
    consumeItem: 'tier-up-pill',
    consumeItemCount: 1,
    consumeSpiritStones: 50000,
  },
  tian: {
    minLevel: 35,  // 地阶上限 35 级，达到即可升天
    minAptitudeAll: 500,
    consumeItem: 'tier-up-pill',
    consumeItemCount: 1,
    consumeSpiritStones: 100000,
  },
};

/**
 * 品阶升级路径顺序。
 */
const TIER_ORDER = ['huang', 'xuan', 'di', 'tian'] as const;

/**
 * 获取下一品阶。
 */
export const getNextTier = (currentTier: string): string | null => {
  const idx = TIER_ORDER.indexOf(currentTier as (typeof TIER_ORDER)[number]);
  if (idx < 0 || idx >= TIER_ORDER.length - 1) return null;
  return TIER_ORDER[idx + 1];
};

// ==================== 化形条件 ====================

export interface TransformRequirement {
  minLevel: number;
  requiredTier: string;
  consumeItem: string;
  consumeItemCount: number;
  consumeSpiritStones: number;
}

export const TRANSFORM_REQUIREMENT: TransformRequirement = {
  minLevel: 50,
  requiredTier: 'xuan',
  consumeItem: 'transform-pill',
  consumeItemCount: 1,
  consumeSpiritStones: 10000,
};

// ==================== 条件检查 ====================

export interface TierUpCheckResult {
  canTierUp: boolean;
  failedReasons: string[];
  requirement: TierUpRequirement | null;
  nextTier: string | null;
}

/**
 * 检查是否满足升阶条件。
 * 当前仅校验等级，资质要求为废案待补充。
 * 化形功能待后期实装，当前不校验化形状态。
 */
export const checkTierUpConditions = (params: {
  level: number;
  beastTier: string;
}): TierUpCheckResult => {
  const nextTier = getNextTier(params.beastTier);
  if (!nextTier) {
    return { canTierUp: false, failedReasons: ['已达最高品阶'], requirement: null, nextTier: null };
  }

  const requirement = TIER_UP_REQUIREMENTS[nextTier];
  if (!requirement) {
    return { canTierUp: false, failedReasons: ['品阶配置异常'], requirement: null, nextTier };
  }

  const failedReasons: string[] = [];

  if (params.level < requirement.minLevel) {
    failedReasons.push(`等级不足（需要 ≥${requirement.minLevel}，当前 ${params.level}）`);
  }

  return {
    canTierUp: failedReasons.length === 0,
    failedReasons,
    requirement,
    nextTier,
  };
};

export interface TransformCheckResult {
  canTransform: boolean;
  failedReasons: string[];
}

/**
 * 检查是否满足化形条件。
 */
export const checkTransformConditions = (params: {
  level: number;
  beastTier: string;
  isTransformed: boolean;
}): TransformCheckResult => {
  const failedReasons: string[] = [];

  if (params.isTransformed) {
    failedReasons.push('已经化形');
    return { canTransform: false, failedReasons };
  }

  if (params.beastTier !== TRANSFORM_REQUIREMENT.requiredTier) {
    failedReasons.push(`品阶不符（需要 ${TRANSFORM_REQUIREMENT.requiredTier}，当前 ${params.beastTier}）`);
  }

  if (params.level < TRANSFORM_REQUIREMENT.minLevel) {
    failedReasons.push(`等级不足（需要 ≥${TRANSFORM_REQUIREMENT.minLevel}，当前 ${params.level}）`);
  }

  return {
    canTransform: failedReasons.length === 0,
    failedReasons,
  };
};
