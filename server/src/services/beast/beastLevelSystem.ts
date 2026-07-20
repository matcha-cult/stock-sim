/**
 * 灵兽升级计算系统
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：计算升级所需经验、处理升级逻辑、计算属性成长
 * 2. 不做什么：不处理经验获取（由战斗结算负责）、不处理升级动画（前端负责）
 *
 * 数据流 / 状态流：
 * 战斗胜利 → 获得经验 → 累加到 progress_exp → 检查升级 → 更新等级和属性
 *
 * 关键边界条件与坑点：
 * 1. 经验值使用 BigInt，避免大数精度问题
 * 2. 升级可能连升多级（一次性获得大量经验）
 * 3. 属性成长使用线性递增，避免指数爆炸
 */

// ==================== 升级常量 ====================

const LEVEL_PARAMS = {
  BASE_EXP: 100,        // 基础经验值
  EXPONENT: 2.2,        // 指数（控制曲线陡峭程度）
  MAX_LEVEL: 100,       // 最大等级（可选限制）
  GROWTH_RATE: 0.02,    // 属性成长递增率（每级 +2%）
} as const;

// ==================== 经验计算 ====================

/**
 * 计算指定等级升级所需经验
 *
 * 公式：baseExp × level^exponent
 *
 * @param level - 当前等级
 * @returns 升级所需经验
 */
export const calculateLevelUpExp = (level: number): bigint => {
  if (level <= 0) return BigInt(0);
  if (level >= LEVEL_PARAMS.MAX_LEVEL) return BigInt(Number.MAX_SAFE_INTEGER);

  const requiredExp = Math.floor(
    LEVEL_PARAMS.BASE_EXP * Math.pow(level, LEVEL_PARAMS.EXPONENT),
  );

  return BigInt(requiredExp);
};

/**
 * 计算从 1 级到目标等级的累计经验
 *
 * @param targetLevel - 目标等级
 * @returns 累计经验
 */
export const calculateCumulativeExp = (targetLevel: number): bigint => {
  if (targetLevel <= 1) return BigInt(0);

  let total = BigInt(0);
  for (let lvl = 1; lvl < targetLevel; lvl++) {
    total += calculateLevelUpExp(lvl);
  }
  return total;
};

// ==================== 升级处理 ====================

export interface LevelUpResult {
  newLevel: number;
  remainingExp: bigint;
  leveledUp: boolean;
  levelsGained: number;
}

/**
 * 处理升级逻辑
 *
 * 检查当前经验是否足够升级，可能连升多级。
 *
 * @param currentLevel - 当前等级
 * @param currentExp - 当前经验（未升级部分）
 * @param maxLevel - 等级上限（默认 MAX_LEVEL）
 * @returns 升级结果
 */
export const processLevelUp = (
  currentLevel: number,
  currentExp: bigint,
  maxLevel: number = LEVEL_PARAMS.MAX_LEVEL,
): LevelUpResult => {
  let level = currentLevel;
  let exp = currentExp;
  const startLevel = currentLevel;
  const effectiveMaxLevel = Math.min(maxLevel, LEVEL_PARAMS.MAX_LEVEL);

  // 循环检查升级，支持连升多级
  while (level < effectiveMaxLevel) {
    const requiredExp = calculateLevelUpExp(level);
    if (exp < requiredExp) break;

    exp -= requiredExp;
    level++;
  }

  return {
    newLevel: level,
    remainingExp: exp,
    leveledUp: level > startLevel,
    levelsGained: level - startLevel,
  };
};

// ==================== 属性成长 ====================

/**
 * 计算指定等级的属性成长值
 *
 * 公式：baseGain × (1 + (level - 1) × growthRate)
 *
 * 每级比前一级多 growthRate（默认 2%）的成长。
 * 例如：
 * - 1 级：baseGain × 1.00
 * - 2 级：baseGain × 1.02
 * - 10 级：baseGain × 1.18
 * - 50 级：baseGain × 1.98
 * - 100 级：baseGain × 2.98
 *
 * @param baseGain - 基础成长值（来自模板）
 * @param level - 等级
 * @returns 成长值（向下取整）
 */
export const calculateLevelAttrGain = (
  baseGain: number,
  level: number,
): number => {
  if (level <= 0) return 0;

  const multiplier = 1 + (level - 1) * LEVEL_PARAMS.GROWTH_RATE;
  return Math.floor(baseGain * multiplier);
};

/**
 * 计算从 1 级到目标等级的总属性成长
 *
 * @param baseGain - 基础成长值
 * @param targetLevel - 目标等级
 * @returns 总成长值
 */
export const calculateTotalAttrGain = (
  baseGain: number,
  targetLevel: number,
): number => {
  if (targetLevel <= 1) return 0;

  let total = 0;
  for (let lvl = 1; lvl <= targetLevel; lvl++) {
    total += calculateLevelAttrGain(baseGain, lvl);
  }
  return total;
};

// ==================== 升级预览 ====================

export interface LevelPreviewData {
  currentLevel: number;
  currentExp: bigint;
  nextLevelExp: bigint;
  progressPercent: number;
  estimatedBattles: number;
}

/**
 * 计算升级预览数据
 *
 * @param currentLevel - 当前等级
 * @param currentExp - 当前经验
 * @param expPerBattle - 每场战斗平均经验
 * @returns 预览数据
 */
export const calculateLevelPreview = (
  currentLevel: number,
  currentExp: bigint,
  expPerBattle: number,
): LevelPreviewData => {
  const nextLevelExp = calculateLevelUpExp(currentLevel);
  const remainingExp = nextLevelExp - currentExp;
  const progressPercent = Number((currentExp * BigInt(100)) / nextLevelExp);
  const estimatedBattles = expPerBattle > 0
    ? Math.ceil(Number(remainingExp) / expPerBattle)
    : 0;

  return {
    currentLevel,
    currentExp,
    nextLevelExp,
    progressPercent,
    estimatedBattles,
  };
};

// ==================== 数据库操作 ====================

import { query } from '../../config/database.js';
import { resolveBeastTierLevelLimit } from './shared/beastTierLevelLimit.js';

/**
 * 增加灵兽经验并检查升级
 *
 * 使用事务保证原子性：
 * 1. 累加经验
 * 2. 读取最新数据
 * 3. 检查升级
 * 4. 更新等级和经验
 *
 * @param beastId - 灵兽 ID
 * @param exp - 增加的经验
 * @returns 升级结果
 */
export const addBeastExperienceAndLevelUp = async (
  beastId: number,
  exp: bigint,
): Promise<LevelUpResult & { success: boolean }> => {
  if (exp <= BigInt(0)) {
    return {
      newLevel: 0,
      remainingExp: BigInt(0),
      leveledUp: false,
      levelsGained: 0,
      success: false,
    };
  }

  // 0. 获取灵兽品阶，确定等级上限
  const beastInfoResult = await query<{ beast_tier: string }>(
    `SELECT beast_tier FROM character_beast WHERE id = $1`,
    [beastId],
  );
  if (beastInfoResult.rows.length === 0) {
    return {
      newLevel: 0,
      remainingExp: BigInt(0),
      leveledUp: false,
      levelsGained: 0,
      success: false,
    };
  }
  const tierMaxLevel = resolveBeastTierLevelLimit(beastInfoResult.rows[0].beast_tier);

  // 1. 累加经验
  const updateResult = await query<{
    level: number;
    progress_exp: bigint | string;
  }>(
    `UPDATE character_beast
     SET progress_exp = progress_exp + $1,
         total_exp = total_exp + $1,
         updated_at = NOW()
     WHERE id = $2
     RETURNING level::bigint AS level, progress_exp::bigint AS progress_exp`,
    [exp.toString(), beastId],
  );

  if (updateResult.rows.length === 0) {
    return {
      newLevel: 0,
      remainingExp: BigInt(0),
      leveledUp: false,
      levelsGained: 0,
      success: false,
    };
  }

  const currentLevel = Number(updateResult.rows[0].level);
  const currentExp = BigInt(updateResult.rows[0].progress_exp);

  // 2. 检查升级（受品阶等级上限限制）
  const levelUpResult = processLevelUp(currentLevel, currentExp, tierMaxLevel);

  // 3. 如果升级了，更新等级和经验
  if (levelUpResult.leveledUp) {
    await query(
      `UPDATE character_beast
       SET level = $1,
           progress_exp = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [levelUpResult.newLevel, levelUpResult.remainingExp.toString(), beastId],
    );
  }

  return {
    ...levelUpResult,
    success: true,
  };
};

/**
 * 获取灵兽升级进度
 *
 * @param beastId - 灵兽 ID
 * @returns 升级进度数据
 */
export const getBeastLevelProgress = async (
  beastId: number,
): Promise<{
  level: number;
  currentExp: bigint;
  nextLevelExp: bigint;
  progressPercent: number;
} | null> => {
  const result = await query<{
    level: number;
    progress_exp: bigint | string;
  }>(
    `SELECT level::bigint AS level, progress_exp::bigint AS progress_exp
     FROM character_beast
     WHERE id = $1`,
    [beastId],
  );

  if (result.rows.length === 0) return null;

  const level = Number(result.rows[0].level);
  const currentExp = BigInt(result.rows[0].progress_exp);
  const nextLevelExp = calculateLevelUpExp(level);
  const progressPercent = Number((currentExp * BigInt(100)) / nextLevelExp);

  return {
    level,
    currentExp,
    nextLevelExp,
    progressPercent,
  };
};
