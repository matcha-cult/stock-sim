/**
 * 灵兽培育服务
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：处理灵兽培育——消耗培育物品、计算资质加成增量、更新 aptitude_bonus 乘数。
 * 2. 不做什么：不处理 HTTP 参数。
 *
 * 数据流 / 状态流：
 * route -> beastCultivationService -> beastCultivationRules + SQL -> DTO。
 *
 * 关键边界条件与坑点：
 * 1) 培育物品消耗需要在事务中处理（暂不实现物品系统对接）。
 * 2) cultivation_count 在每次培育后递增，影响衰减系数。
 * 3) 培育直接增加 aptitude_bonus（全局属性乘数），不再操作 6 维独立资质字段。
 */
import { query, withTransaction } from '../../config/database.js';
import { getBeastDefinitionById } from './beastConfigLoader.js';
import {
  calcCultivationIncrease,
  calcBatchCultivationIncrease,
} from './shared/beastCultivationRules.js';
import { loadSingleBeastRow, type BeastRow } from './shared/beastView.js';

interface ServiceResult<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
}

// ==================== 培育物品配置 ====================

/**
 * 培育物品基础增加量配置（暂用内存常量）。
 * baseIncrease 通过 / 1000 换算为 aptitude_bonus 增量。
 */
const CULTIVATION_ITEMS: Record<string, { baseIncrease: number; name: string }> = {
  'cultivation-pill-basic': { baseIncrease: 5, name: '初级培育丹' },
  'cultivation-pill-medium': { baseIncrease: 10, name: '中级培育丹' },
  'cultivation-pill-advanced': { baseIncrease: 20, name: '高级培育丹' },
  'spirit-fruit-cultivation': { baseIncrease: 15, name: '灵果' },
};

/** 培育物品 baseIncrease → aptitude_bonus 增量换算分母 */
const BONUS_DIVISOR = 1000;

// ==================== 查询片段 ====================

const BEAST_LOCK_SELECT = `
  SELECT id, character_id, beast_def_id, level::bigint AS level, progress_exp::bigint AS progress_exp,
         template_id, aptitude_bonus,
         cultivation_count, beast_tier, is_transformed, is_active,
         nickname, description, avatar, obtained_from, obtained_ref_id,
         EXTRACT(EPOCH FROM created_at)::bigint AS created_at,
         EXTRACT(EPOCH FROM updated_at)::bigint AS updated_at
  FROM character_beast
`;

// ==================== 单次培育 ====================

export interface CultivationResultDto {
  bonusIncrease: number;
  newAptitudeBonus: number;
  newCultivationCount: number;
  decayCoefficient: number;
}

/**
 * 单次培育。
 * 消耗 1 个培育物品，增加 aptitude_bonus 乘数。
 */
export const cultivate = async (
  characterId: number,
  beastId: number,
  itemId: string,
): Promise<ServiceResult<CultivationResultDto>> => {
  const item = CULTIVATION_ITEMS[itemId];
  if (!item) {
    return { success: false, message: '培育物品不存在' };
  }

  return withTransaction(async () => {
    const beastResult = await query<BeastRow>(
      `${BEAST_LOCK_SELECT}
       WHERE id = $1 AND character_id = $2
       FOR UPDATE`,
      [beastId, characterId],
    );
    const beastRow = beastResult.rows[0];
    if (!beastRow) {
      return { success: false, message: '灵兽不存在' };
    }

    const def = getBeastDefinitionById(beastRow.beast_def_id);
    if (!def) {
      return { success: false, message: '灵兽模板不存在' };
    }

    // 计算 aptitude_bonus 增量（受衰减系数影响）
    const bonusIncrease = calcCultivationIncrease(
      item.baseIncrease / BONUS_DIVISOR,
      beastRow.cultivation_count,
      def.cultivation_decay_rate,
    );
    const decayCoefficient = 1 / (1 + beastRow.cultivation_count * def.cultivation_decay_rate);

    // 原子更新：aptitude_bonus 增量 + 培育次数递增
    await query(
      `UPDATE character_beast
       SET aptitude_bonus = aptitude_bonus + $1,
           cultivation_count = cultivation_count + 1,
           updated_at = NOW()
       WHERE id = $2`,
      [bonusIncrease, beastId],
    );

    return {
      success: true,
      data: {
        bonusIncrease,
        newAptitudeBonus: beastRow.aptitude_bonus + bonusIncrease,
        newCultivationCount: beastRow.cultivation_count + 1,
        decayCoefficient,
      },
    };
  });
};

// ==================== 批量培育 ====================

export interface BatchCultivationResultDto {
  totalBonusIncrease: number;
  newAptitudeBonus: number;
  newCultivationCount: number;
  batchCount: number;
}

/**
 * 批量培育。
 */
export const batchCultivate = async (
  characterId: number,
  beastId: number,
  itemId: string,
  batchCount: number,
): Promise<ServiceResult<BatchCultivationResultDto>> => {
  const item = CULTIVATION_ITEMS[itemId];
  if (!item) {
    return { success: false, message: '培育物品不存在' };
  }

  if (batchCount <= 0 || batchCount > 100) {
    return { success: false, message: '批量培育次数须在 1~100 之间' };
  }

  return withTransaction(async () => {
    const beastResult = await query<BeastRow>(
      `${BEAST_LOCK_SELECT}
       WHERE id = $1 AND character_id = $2
       FOR UPDATE`,
      [beastId, characterId],
    );
    const beastRow = beastResult.rows[0];
    if (!beastRow) {
      return { success: false, message: '灵兽不存在' };
    }

    const def = getBeastDefinitionById(beastRow.beast_def_id);
    if (!def) {
      return { success: false, message: '灵兽模板不存在' };
    }

    const totalBonusIncrease = calcBatchCultivationIncrease(
      item.baseIncrease / BONUS_DIVISOR,
      beastRow.cultivation_count,
      def.cultivation_decay_rate,
      batchCount,
    );

    await query(
      `UPDATE character_beast
       SET aptitude_bonus = aptitude_bonus + $1,
           cultivation_count = cultivation_count + $2,
           updated_at = NOW()
       WHERE id = $3`,
      [totalBonusIncrease, batchCount, beastId],
    );

    return {
      success: true,
      data: {
        totalBonusIncrease,
        newAptitudeBonus: beastRow.aptitude_bonus + totalBonusIncrease,
        newCultivationCount: beastRow.cultivation_count + batchCount,
        batchCount,
      },
    };
  });
};

// ==================== 培育预览 ====================

export interface CultivationPreviewDto {
  bonusIncreasePerTime: number;
  totalBonusIncrease: number;
  decayCoefficient: number;
  currentCultivationCount: number;
  projectedCultivationCount: number;
}

/**
 * 培育预览（不消耗物品，不修改数据）。
 */
export const getCultivationPreview = async (
  beastId: number,
  itemId: string,
  count: number,
): Promise<ServiceResult<CultivationPreviewDto>> => {
  const item = CULTIVATION_ITEMS[itemId];
  if (!item) {
    return { success: false, message: '培育物品不存在' };
  }

  const beastRow = await loadSingleBeastRow(beastId);
  if (!beastRow) {
    return { success: false, message: '灵兽不存在' };
  }

  const def = getBeastDefinitionById(beastRow.beast_def_id);
  if (!def) {
    return { success: false, message: '灵兽模板不存在' };
  }

  const basePerTime = item.baseIncrease / BONUS_DIVISOR;
  const bonusIncreasePerTime = count === 1
    ? calcCultivationIncrease(basePerTime, beastRow.cultivation_count, def.cultivation_decay_rate)
    : calcBatchCultivationIncrease(basePerTime, beastRow.cultivation_count, def.cultivation_decay_rate, count);
  const totalBonusIncrease = count === 1
    ? bonusIncreasePerTime
    : bonusIncreasePerTime;
  const decayCoefficient = 1 / (1 + beastRow.cultivation_count * def.cultivation_decay_rate);

  return {
    success: true,
    data: {
      bonusIncreasePerTime,
      totalBonusIncrease,
      decayCoefficient,
      currentCultivationCount: beastRow.cultivation_count,
      projectedCultivationCount: beastRow.cultivation_count + count,
    },
  };
};
